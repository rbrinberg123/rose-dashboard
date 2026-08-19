import { test } from "node:test"
import assert from "node:assert/strict"

import {
  applyBatch,
  buildBatchUrl,
  describeProgress,
  describeResult,
  initialProgress,
  isComplete,
  shouldContinue,
  DEFAULT_BATCH_SIZE,
  type RefreshBatchResponse,
} from "./client-summary-refresh.ts"
import { hasCronBearer } from "./cron-auth.ts"

// --- the request the browser makes ------------------------------------------

test("each batch call is forced, windowed, and limited", () => {
  const url = buildBatchUrl("2026-08-19T12:00:00.000Z")
  const qs = new URLSearchParams(url.split("?")[1])
  assert.ok(url.startsWith("/api/client-summary/refresh-all?"))
  assert.equal(qs.get("force"), "1")
  assert.equal(qs.get("before"), "2026-08-19T12:00:00.000Z")
  // A limit is what keeps each request short enough to never hit a timeout.
  assert.equal(qs.get("limit"), String(DEFAULT_BATCH_SIZE))
})

test("the campaign timestamp is passed through verbatim (it is the resume key)", () => {
  const before = "2026-01-02T03:04:05.678Z"
  assert.equal(new URLSearchParams(buildBatchUrl(before, 5).split("?")[1]).get("before"), before)
})

// --- folding batch responses into progress ----------------------------------

const batch = (o: Partial<RefreshBatchResponse>): RefreshBatchResponse => ({
  active: 108,
  succeeded: 0,
  failed: 0,
  remaining: 0,
  failures: [],
  ...o,
})

test("progress accumulates across passes and tracks the remaining count", () => {
  let p = initialProgress()
  assert.equal(p.remaining, -1) // not started
  assert.equal(isComplete(p), false)

  p = applyBatch(p, batch({ succeeded: 15, remaining: 93 }))
  assert.deepEqual(
    { total: p.total, done: p.done, failed: p.failed, remaining: p.remaining, passes: p.passes },
    { total: 108, done: 15, failed: 0, remaining: 93, passes: 1 },
  )

  p = applyBatch(p, batch({ succeeded: 15, remaining: 78 }))
  assert.equal(p.done, 30)
  assert.equal(p.passes, 2)
  assert.equal(isComplete(p), false)
})

test("a full run over 108 clients completes in ceil(108/15) passes and stops", () => {
  let p = initialProgress()
  let remaining = 108
  let passes = 0
  while (remaining > 0) {
    const succeeded = Math.min(DEFAULT_BATCH_SIZE, remaining)
    remaining -= succeeded
    const body = batch({ succeeded, remaining })
    p = applyBatch(p, body)
    passes++
    if (!shouldContinue(p, body)) break
    assert.ok(passes < 50, "loop must terminate")
  }
  assert.equal(p.done, 108)
  assert.equal(p.remaining, 0)
  assert.equal(p.passes, Math.ceil(108 / DEFAULT_BATCH_SIZE))
  assert.equal(isComplete(p), true)
  assert.equal(describeResult(p), "Done — 108 summaries regenerated.")
})

test("failures are tallied and carried, and do not stop a run that is progressing", () => {
  let p = initialProgress()
  const body = batch({
    succeeded: 14,
    failed: 1,
    remaining: 94,
    failures: [{ account_id: "acc-1", error: "Anthropic API error 429: rate limited" }],
  })
  p = applyBatch(p, body)
  assert.equal(p.failed, 1)
  assert.equal(p.failures.length, 1)
  assert.equal(p.failures[0].account_id, "acc-1")
  // 14 succeeded, so there is forward progress — keep going.
  assert.equal(shouldContinue(p, body), true)
})

test("a pass where NOBODY succeeded stops the loop instead of spinning forever", () => {
  // The systemic-failure case: bad API key / exhausted quota. Without this
  // guard the driver would re-request the same failing clients indefinitely.
  let p = initialProgress()
  const body = batch({ succeeded: 0, failed: 15, remaining: 108 })
  p = applyBatch(p, body)
  assert.equal(shouldContinue(p, body), false)
  assert.equal(isComplete(p), false) // stopped, NOT finished
})

test("a completed run stops even if the final pass regenerated nobody", () => {
  // remaining === 0 wins over the no-progress guard, so a trailing empty batch
  // reports Done rather than an error.
  let p = initialProgress()
  p = applyBatch(p, batch({ succeeded: 0, remaining: 0 }))
  assert.equal(isComplete(p), true)
  assert.equal(shouldContinue(p, batch({ succeeded: 0, remaining: 0 })), false)
})

test("a resumed run reports only what THIS run regenerated", () => {
  // 90 were already done by an earlier interrupted run, so the route reports
  // 18 eligible; the UI counts this run's work, not the whole book.
  let p = initialProgress()
  p = applyBatch(p, batch({ succeeded: 15, remaining: 3 }))
  p = applyBatch(p, batch({ succeeded: 3, remaining: 0 }))
  assert.equal(p.done, 18)
  assert.equal(isComplete(p), true)
})

test("a missing field in the response never produces NaN progress", () => {
  const p = applyBatch(initialProgress(), {})
  assert.equal(p.done, 0)
  assert.equal(p.failed, 0)
  assert.equal(p.remaining, 0)
  assert.equal(Number.isNaN(p.total), false)
})

// --- the strings the user reads ---------------------------------------------

test("the running line reads 'Regenerating… X of N (F failed)'", () => {
  let p = initialProgress()
  assert.equal(describeProgress(p), "Starting…")
  p = applyBatch(p, batch({ succeeded: 45, failed: 0, remaining: 63 }))
  assert.equal(describeProgress(p), "Regenerating… 45 of 108 (0 failed)")
  p = applyBatch(p, batch({ active: 108, succeeded: 10, failed: 2, remaining: 51 }))
  assert.equal(describeProgress(p), "Regenerating… 55 of 108 (2 failed)")
})

test("the done line distinguishes a clean run from one with failures", () => {
  let clean = initialProgress()
  clean = applyBatch(clean, batch({ succeeded: 108, remaining: 0 }))
  assert.match(describeResult(clean), /^Done — 108 summaries regenerated\.$/)

  let messy = initialProgress()
  messy = applyBatch(messy, batch({ succeeded: 106, failed: 2, remaining: 2 }))
  assert.match(describeResult(messy), /106 summaries regenerated, 2 failed/)
  assert.match(describeResult(messy), /run it again to retry/i)
})

test("singular wording for a one-client run", () => {
  let p = initialProgress()
  p = applyBatch(p, batch({ active: 1, succeeded: 1, remaining: 0 }))
  assert.equal(describeResult(p), "Done — 1 summary regenerated.")
})

// --- auth: the button must not need the cron token --------------------------

test("cron bearer check matches only the exact token", () => {
  assert.equal(hasCronBearer("Bearer s3cret", "s3cret"), true)
  assert.equal(hasCronBearer("Bearer wrong", "s3cret"), false)
  assert.equal(hasCronBearer("s3cret", "s3cret"), false) // missing "Bearer "
  assert.equal(hasCronBearer("bearer s3cret", "s3cret"), false) // case-sensitive
})

test("cron bearer check fails CLOSED when the secret is unset", () => {
  // A misconfigured environment must not leave this paid route open.
  assert.equal(hasCronBearer("Bearer anything", undefined), false)
  assert.equal(hasCronBearer("Bearer anything", ""), false)
  assert.equal(hasCronBearer(null, undefined), false)
})

test("a browser request carries no bearer — it must fall through to the session check", () => {
  // The Admin button fetches with cookies and no Authorization header. The
  // header check must reject it so the route's requireSuperUser() path runs.
  assert.equal(hasCronBearer(null, "s3cret"), false)
  assert.equal(hasCronBearer(undefined, "s3cret"), false)
})

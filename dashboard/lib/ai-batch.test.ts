import { test } from "node:test"
import assert from "node:assert/strict"

import { AI_BATCH_CONFIG, backoffDelayMs, isRetryableUpstream, runThrottled, withBackoff } from "./ai-batch.ts"

const noSleep = async () => {}

test("backoff grows ×3 per attempt and jitter stays within [step/2, step]", () => {
  for (const [attempt, step] of [[0, 5000], [1, 15000], [2, 45000]] as const) {
    assert.equal(backoffDelayMs(attempt, 5000, () => 0), step / 2)
    assert.equal(backoffDelayMs(attempt, 5000, () => 1), step)
  }
})

test("only transient upstream statuses retry", () => {
  for (const s of [408, 429, 500, 502, 503, 529]) assert.equal(isRetryableUpstream(s), true)
  for (const s of [undefined, 400, 401, 404, 422]) assert.equal(isRetryableUpstream(s), false)
})

test("withBackoff retries a 429 up to MAX_RETRIES, then throws", async () => {
  let calls = 0
  const err = Object.assign(new Error("rate limited"), { status: 429 })
  await assert.rejects(
    withBackoff(async () => { calls++; throw err }, {
      label: "t",
      upstreamStatusOf: (e) => (e as { status?: number }).status,
      sleepFn: noSleep,
    }),
  )
  assert.equal(calls, AI_BATCH_CONFIG.MAX_RETRIES + 1)
})

test("withBackoff does not retry a non-transient error", async () => {
  let calls = 0
  await assert.rejects(
    withBackoff(async () => { calls++; throw new Error("bad") }, { label: "t", upstreamStatusOf: () => undefined, sleepFn: noSleep }),
  )
  assert.equal(calls, 1)
})

test("runThrottled never exceeds the concurrency cap and isolates failures", async () => {
  let inFlight = 0
  let peak = 0
  const ids = ["a", "b", "c", "d", "e"]
  const out = await runThrottled(
    ids,
    async (id) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      if (id === "c") throw new Error("boom")
      return id
    },
    { concurrency: 2, sleepFn: noSleep },
  )
  assert.equal(peak, 2)
  assert.deepEqual(out.map((o) => o.id), ids)
  assert.equal(out.filter((o) => o.result.status === "rejected").length, 1)
})

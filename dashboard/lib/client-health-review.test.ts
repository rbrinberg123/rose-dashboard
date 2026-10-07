import { test } from "node:test"
import assert from "node:assert/strict"

import { decideReview, isOverrideMode, type ReviewInput } from "./client-health-review.ts"

const base: ReviewInput = {
  hasOverride: true,
  overrideRating: "1",
  mode: "prefer",
  baselineAiRating: "2",
  freshAiRating: "2",
  newEvidence: false,
  current: { suggested: false, reason: null },
}
const run = (patch: Partial<ReviewInput>) => decideReview({ ...base, ...patch })

test("no override, or a pinned one, never flags", () => {
  assert.equal(run({ hasOverride: false, overrideRating: null, freshAiRating: "3", newEvidence: true }), null)
  assert.equal(run({ mode: "pin", freshAiRating: "3", newEvidence: true }), null)
})

test("an acknowledged, unchanged divergence does not re-flag", () => {
  // AI (2) disagrees with the override (1) but equals the baseline (2).
  assert.equal(run({}), null)
})

test("a NEW divergence flags", () => {
  assert.deepEqual(run({ freshAiRating: "3" }), { reason: "divergence", upgrade: false })
})

test("AI agreeing with the override is not divergence", () => {
  assert.equal(run({ freshAiRating: "1", baselineAiRating: "3" }), null)
})

test("new evidence alone flags, quieter reason", () => {
  assert.deepEqual(run({ newEvidence: true }), { reason: "new_evidence", upgrade: false })
})

test("divergence wins over new evidence", () => {
  assert.deepEqual(run({ freshAiRating: "3", newEvidence: true }), { reason: "divergence", upgrade: false })
})

test("note-only override: no divergence possible, new evidence still flags", () => {
  assert.equal(run({ overrideRating: null, freshAiRating: "3", baselineAiRating: null }), null)
  assert.deepEqual(run({ overrideRating: null, newEvidence: true }), { reason: "new_evidence", upgrade: false })
})

test("an open flag is never re-written, only upgraded new_evidence → divergence", () => {
  const open = (reason: "divergence" | "new_evidence") => ({ suggested: true, reason })
  assert.equal(run({ current: open("new_evidence"), newEvidence: true }), null)
  assert.equal(run({ current: open("divergence"), freshAiRating: "3" }), null)
  assert.equal(run({ current: open("divergence"), newEvidence: true }), null)
  assert.deepEqual(run({ current: open("new_evidence"), freshAiRating: "3" }), { reason: "divergence", upgrade: true })
})

test("a flag is sticky: re-alignment does not produce a clear", () => {
  // AI back in line with the override, flag open → decideReview has no "clear" outcome.
  assert.equal(run({ current: { suggested: true, reason: "divergence" }, freshAiRating: "1" }), null)
})

test("isOverrideMode", () => {
  assert.equal(isOverrideMode("prefer"), true)
  assert.equal(isOverrideMode("pin"), true)
  for (const bad of ["Pin", "lock", "", null, undefined]) assert.equal(isOverrideMode(bad), false)
})

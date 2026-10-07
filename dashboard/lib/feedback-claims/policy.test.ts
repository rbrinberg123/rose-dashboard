import { test } from "node:test"
import assert from "node:assert/strict"

import {
  FEEDBACK_CLAIMS_INCLUDE_DYNAMICS,
  decideClaim,
  decideClose,
  decideReassign,
  decideRelease,
  isClaimableOrigin,
  type ClaimActor,
  type ClaimTask,
} from "./policy.ts"

const task = (over: Partial<ClaimTask> = {}): ClaimTask => ({
  origin: "dashboard",
  stateLabel: "Open",
  subtypeLabel: "Feedback",
  receivedDate: "2026-10-01T00:00:00+00:00",
  ownerId: null,
  ...over,
})
const actor = (over: Partial<ClaimActor> = {}): ClaimActor => ({
  myIds: new Set(["me"]),
  isAdmin: false,
  hasCapability: true,
  ...over,
})

// ---- the pool / cutover switch -----------------------------------------------

test("today only dashboard-origin tasks are in the pool", () => {
  assert.equal(FEEDBACK_CLAIMS_INCLUDE_DYNAMICS, false)
  assert.equal(isClaimableOrigin("dashboard"), true)
  assert.equal(isClaimableOrigin("dynamics"), false)
  assert.equal(isClaimableOrigin(null), false)
})

test("a Dynamics-origin task is refused for every action pre-cutover (even for an admin)", () => {
  const t = task({ origin: "dynamics" })
  const admin = actor({ isAdmin: true })
  assert.match(decideClaim(t, admin) ?? "", /until cutover/)
  assert.match(decideClose(t, admin) ?? "", /until cutover/)
  assert.match(decideRelease(task({ origin: "dynamics", ownerId: "x" }), admin) ?? "", /until cutover/)
})

// ---- claim ---------------------------------------------------------------------

test("claim: needs the capability, an open unclaimed Feedback task with feedback received", () => {
  assert.equal(decideClaim(task(), actor()), null)
  assert.match(decideClaim(task(), actor({ hasCapability: false })) ?? "", /permission/)
  assert.match(decideClaim(task({ ownerId: "other" }), actor()) ?? "", /already claimed/)
  assert.match(decideClaim(task({ stateLabel: "Completed" }), actor()) ?? "", /closed/)
  assert.match(decideClaim(task({ receivedDate: null }), actor()) ?? "", /received/)
  assert.match(decideClaim(task({ subtypeLabel: "Feedback Report Sent" }), actor()) ?? "", /Only Feedback/)
})

test("claim: an admin can claim without the capability", () => {
  assert.equal(decideClaim(task(), actor({ isAdmin: true, hasCapability: false })), null)
})

// ---- release ---------------------------------------------------------------------

test("release: the owner or an admin, never someone else", () => {
  const claimed = task({ ownerId: "me" })
  assert.equal(decideRelease(claimed, actor()), null)
  assert.equal(decideRelease(task({ ownerId: "other" }), actor({ isAdmin: true })), null)
  assert.match(decideRelease(task({ ownerId: "other" }), actor()) ?? "", /owner or an admin/)
  assert.match(decideRelease(task(), actor()) ?? "", /isn't claimed/)
})

test("release: the owner check honours every one of the actor's duplicate ids", () => {
  assert.equal(decideRelease(task({ ownerId: "me-dup" }), actor({ myIds: new Set(["me", "me-dup"]) })), null)
})

// ---- reassign --------------------------------------------------------------------

test("reassign: admin only, to a different person", () => {
  assert.equal(decideReassign(task({ ownerId: "a" }), actor({ isAdmin: true }), "b"), null)
  assert.equal(decideReassign(task(), actor({ isAdmin: true }), "b"), null) // assign an unclaimed task
  assert.match(decideReassign(task({ ownerId: "a" }), actor(), "b") ?? "", /Only an admin/)
  assert.match(decideReassign(task({ ownerId: "b" }), actor({ isAdmin: true }), "b") ?? "", /already owns/)
  assert.match(decideReassign(task(), actor({ isAdmin: true }), null) ?? "", /Pick someone/)
})

// ---- close -----------------------------------------------------------------------

test("close: the owner any time; an admin even when unclaimed; nobody else", () => {
  assert.equal(decideClose(task({ ownerId: "me" }), actor()), null)
  assert.equal(decideClose(task(), actor({ isAdmin: true })), null)
  assert.match(decideClose(task({ ownerId: "other" }), actor()) ?? "", /owner or an admin/)
  assert.match(decideClose(task(), actor()) ?? "", /owner or an admin/)
  assert.match(decideClose(task({ ownerId: "me", stateLabel: "Completed" }), actor()) ?? "", /closed/)
})

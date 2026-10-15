import { test } from "node:test"
import assert from "node:assert/strict"

import {
  LIFECYCLE_STEPS,
  canAct,
  deriveStage,
  lifecycleNote,
  nextAction,
  stageIndex,
  type LifecycleSentTask,
} from "./lifecycle.ts"
import { decideSentClose } from "../feedback-claims/policy.ts"

const report = (p: Partial<Parameters<typeof deriveStage>[0]> = {}) => ({
  state: "Open",
  receivedDate: null,
  claimedById: null,
  claimedByName: null,
  closedByName: null,
  ...p,
})
const sent = (p: Partial<LifecycleSentTask> = {}): LifecycleSentTask => ({
  taskId: "s1",
  state: "Open",
  ownerId: "assoc",
  ownerName: "Ann Associate",
  closedAt: null,
  closedByName: null,
  sentAt: null,
  ...p,
})
const viewer = (p: Partial<Parameters<typeof canAct>[3]> = {}) => ({
  myIds: new Set<string>(),
  isAdmin: false,
  hasCapability: false,
  crmWriter: false,
  onClientTeam: false,
  ...p,
})

test("the strip reads Collection → Claimed → Review → Sent", () => {
  assert.deepEqual(
    LIFECYCLE_STEPS.map((s) => s.label),
    ["Collection", "Claimed", "Review", "Sent"],
  )
})

test("stage is derived from the two tasks", () => {
  assert.equal(deriveStage(report(), null), "collecting")
  assert.equal(deriveStage(report({ receivedDate: "2026-10-10" }), null), "feedback_in")
  assert.equal(deriveStage(report({ receivedDate: "2026-10-10", claimedById: "w" }), null), "claimed")
  // Sent task OPEN = Review; CLOSED = Sent (done).
  assert.equal(deriveStage(report({ state: "Completed" }), sent()), "review")
  assert.equal(deriveStage(report({ state: "Completed" }), sent({ state: "Completed" })), "sent")
  // Dynamics-style sidecar close also counts as sent.
  assert.equal(deriveStage(report({ state: "Completed" }), sent({ closedAt: "2026-10-12T00:00:00Z" })), "sent")
  assert.equal(deriveStage(report({ state: "Canceled" }), null), "closed")
  assert.equal(stageIndex("collecting"), 0)
  assert.equal(stageIndex("feedback_in"), 1)
  assert.equal(stageIndex("review"), 2)
  assert.equal(stageIndex("sent"), 3)
})

test("card actions: Mark all in, then ownership buttons (none here), then Send", () => {
  assert.equal(nextAction("collecting", null), "mark_in")
  // Claim … Close are the shared ClaimActions, not lifecycle actions.
  assert.equal(nextAction("feedback_in", null), null)
  assert.equal(nextAction("claimed", null), null)
  assert.equal(nextAction("review", sent()), "send")
  assert.equal(nextAction("review", null), null)
  assert.equal(nextAction("sent", sent()), null)
})

test("notes name the people", () => {
  assert.match(lifecycleNote("collecting", report(), null), /^Feedback not ready/)
  assert.equal(
    lifecycleNote("claimed", report({ claimedById: "w", claimedByName: "Wes Writer" }), null),
    "Claimed by Wes Writer · working",
  )
  assert.equal(
    lifecycleNote("review", report({ state: "Completed", claimedByName: "Wes Writer" }), sent()),
    "Worked by Wes Writer · in review by Ann Associate",
  )
  assert.match(lifecycleNote("sent", report(), sent({ closedByName: "Ann Associate", sentAt: "2026-10-14T15:00:00Z" })), /^Sent by Ann Associate · Oct 14$/)
})

test("Send on the card = the server's decideSentClose, for every combination", () => {
  for (const isOwner of [false, true])
    for (const onClientTeam of [false, true])
      for (const isAdmin of [false, true]) {
        const card = canAct("send", report(), sent(), viewer({ myIds: new Set(isOwner ? ["assoc"] : []), onClientTeam, isAdmin }))
        assert.equal(card === null, decideSentClose({ isOwner, onClientTeam, isAdmin }) === null)
      }
})

test("permissions: owner / team / admin send; CRM editors mark all in", () => {
  assert.equal(canAct("send", report(), sent(), viewer({ onClientTeam: true })), null)
  assert.equal(canAct("send", report(), sent(), viewer({ myIds: new Set(["assoc"]) })), null)
  assert.equal(canAct("send", report(), sent(), viewer({ isAdmin: true })), null)
  assert.notEqual(canAct("send", report(), sent(), viewer({ myIds: new Set(["w"]) })), null)

  assert.equal(canAct("mark_in", report(), null, viewer({ crmWriter: true })), null)
  assert.notEqual(canAct("mark_in", report(), null, viewer()), null)
})

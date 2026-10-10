import { test } from "node:test"
import assert from "node:assert/strict"

import {
  FEEDBACK_AUTOMATION_INCLUDES_DYNAMICS,
  decideAddReport,
  decideDeleteReport,
  isAutomationOrigin,
  isEligibleMeeting,
  reportLetter,
  validateAssignments,
} from "./policy.ts"

test("today only dashboard-origin events are automated", () => {
  assert.equal(FEEDBACK_AUTOMATION_INCLUDES_DYNAMICS, false)
  assert.equal(isAutomationOrigin("dashboard"), true)
  assert.equal(isAutomationOrigin("dynamics"), false)
})

test("report letters", () => {
  assert.deepEqual([1, 2, 3].map(reportLetter), ["A", "B", "C"])
})

test("cancelled and deactivated meetings are not eligible", () => {
  assert.equal(isEligibleMeeting("Confirmed", "Active"), true)
  assert.equal(isEligibleMeeting("Pending", null), true)
  assert.equal(isEligibleMeeting("Cancelled", "Active"), false)
  assert.equal(isEligibleMeeting("Confirmed", "Inactive"), false)
})

test("assignments: every eligible meeting exactly once, only to this event's reports", () => {
  const meetings = ["m1", "m2", "m3"]
  const reports = ["A", "B"]
  assert.equal(validateAssignments(meetings, reports, { m1: "A", m2: "A", m3: "B" }), null)
  assert.match(validateAssignments(meetings, reports, { m1: "A", m2: "B" }) ?? "", /1 unassigned/)
  assert.match(validateAssignments(meetings, reports, { m1: "A", m2: "A", m3: "Z" }) ?? "", /isn't on this event/)
  assert.match(
    validateAssignments(meetings, reports, { m1: "A", m2: "A", m3: "B", mX: "A" }) ?? "",
    /cancelled or unknown/,
  )
})

test("delete: never the last report, never a claimed or closed one", () => {
  const open = { taskId: "r", state: "Open", claimed: false }
  assert.equal(decideDeleteReport(open, 2), null)
  assert.match(decideDeleteReport(open, 1) ?? "", /at least one/)
  assert.match(decideDeleteReport({ ...open, claimed: true }, 2) ?? "", /claimed/)
  assert.match(decideDeleteReport({ ...open, state: "Completed" }, 2) ?? "", /open report/)
})

test("add: at most three reports per event", () => {
  assert.equal(decideAddReport(1), null)
  assert.equal(decideAddReport(2), null)
  assert.match(decideAddReport(3) ?? "", /at most 3/)
})

test("received date: today and past accepted; empty, impossible and future refused", async () => {
  const { validateReceivedDay } = await import("./policy.ts")
  const today = "2026-10-07"
  assert.equal(validateReceivedDay("2026-10-07", today), null) // today (Eastern)
  assert.equal(validateReceivedDay("2026-09-15", today), null) // past
  assert.equal(validateReceivedDay("2024-02-29", today), null) // real leap day
  assert.match(validateReceivedDay("", today) ?? "", /valid date/)
  assert.match(validateReceivedDay(null, today) ?? "", /valid date/)
  assert.match(validateReceivedDay("2026-02-30", today) ?? "", /valid date/)
  assert.match(validateReceivedDay("10/07/2026", today) ?? "", /valid date/)
  assert.match(validateReceivedDay("2026-10-08", today) ?? "", /future/)
})

// ---- Per-meeting flag + re-allocation locks (2026-10-10) -------------------
import { meetingFeedbackFlag, reportLock, checkReallocation, decideReallocation, deleteTarget } from "./policy.ts"

test("meetingFeedbackFlag maps the definitive field", () => {
  assert.equal(meetingFeedbackFlag(null).label, "Not in")
  assert.equal(meetingFeedbackFlag("Awaiting Additional").label, "Waiting")
  assert.equal(meetingFeedbackFlag("Closed - No Feedback").label, "No feedback")
  assert.equal(meetingFeedbackFlag("Closed - All in").label, "Feedback in")
  assert.equal(meetingFeedbackFlag("Closed – All In").key, "in")
})

const A = { taskId: "a", letter: "A", seq: 1, state: "Open", claimed: false, receivedDate: null }
const B = { taskId: "b", letter: "B", seq: 2, state: "Open", claimed: false, receivedDate: "2026-10-01" } // warm
const C = { taskId: "c", letter: "C", seq: 3, state: "Open", claimed: true, receivedDate: "2026-10-01" } // hard

test("reportLock: claimed / closed = hard, received-unclaimed = warm, else none", () => {
  assert.equal(reportLock(A), "none")
  assert.equal(reportLock(B), "warm")
  assert.equal(reportLock(C), "hard")
  assert.equal(reportLock({ ...A, state: "Completed" }), "hard")
})

test("untouched reports move freely", () => {
  const chk = checkReallocation([A, B, C], { m1: "a" }, { m1: "a" })
  assert.equal(decideReallocation(chk, { isAdmin: true }), null)
})

test("warm: allowed only with confirmation", () => {
  const chk = checkReallocation([A, B, C], { m1: "b" }, { m1: "a" })
  assert.deepEqual(chk.warmLetters, ["B"])
  assert.match(decideReallocation(chk, { isAdmin: true }) ?? "", /All feedback is in for Report B/)
  assert.equal(decideReallocation(chk, { isAdmin: true, confirmWarm: true }), null)
})

test("hard: no moving out, no adding in; admin override allowed", () => {
  const out = checkReallocation([A, B, C], { m1: "c" }, { m1: "a" })
  const into = checkReallocation([A, B, C], { m2: "a" }, { m2: "c" })
  assert.match(decideReallocation(out, { isAdmin: true }) ?? "", /claimed or closed/)
  assert.match(decideReallocation(into, { isAdmin: true }) ?? "", /claimed or closed/)
  assert.equal(decideReallocation(into, { isAdmin: true, overrideLock: true }), null)
  assert.match(decideReallocation(into, { isAdmin: false, overrideLock: true }) ?? "", /Only an admin/)
})

test("deleteTarget skips hard-locked reports, prefers not-yet-received", () => {
  assert.equal(deleteTarget([A, B, C], "b"), "a")
  assert.equal(deleteTarget([A, B, C], "a"), "b")
  assert.equal(deleteTarget([{ ...A, claimed: true }, C, B], "b"), null)
})

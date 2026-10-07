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

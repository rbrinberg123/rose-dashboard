import { test } from "node:test"
import assert from "node:assert/strict"

import {
  MEETING_FEEDBACK_STATUS_OPTIONS,
  decideSetMeetingFeedback,
  feedbackRepresentativeId,
  feedbackStatusByCode,
  isClosedFeedbackStatus,
  type FeedbackMeetingFacts,
} from "./policy.ts"

const meeting = (p: Partial<FeedbackMeetingFacts> = {}): FeedbackMeetingFacts => ({
  origin: "dashboard",
  meetingStatus: "Confirmed",
  state: "Active",
  feedbackId: "fb",
  hostId: "host",
  ...p,
})
const actor = (ids: string[] = [], isAdmin = false) => ({ myIds: new Set(ids), isAdmin })

test("the three stored statuses, exact labels", () => {
  assert.deepEqual(
    MEETING_FEEDBACK_STATUS_OPTIONS.map((o) => o.label),
    ["Awaiting Additional", "Closed - All in", "Closed - No Feedback"],
  )
  assert.equal(feedbackStatusByCode(755860002)?.label, "Closed - All in")
  assert.equal(feedbackStatusByCode(123), null)
  assert.equal(isClosedFeedbackStatus("Closed - No Feedback"), true)
  assert.equal(isClosedFeedbackStatus("Awaiting Additional"), false)
})

test("representative = feedback person, else host", () => {
  assert.equal(feedbackRepresentativeId({ feedbackId: "fb", hostId: "host" }), "fb")
  assert.equal(feedbackRepresentativeId({ feedbackId: null, hostId: "host" }), "host")
  assert.equal(feedbackRepresentativeId({ feedbackId: null, hostId: null }), null)
})

test("the representative or an admin may set it; nobody else", () => {
  assert.equal(decideSetMeetingFeedback(meeting(), actor(["fb"])), null)
  assert.equal(decideSetMeetingFeedback(meeting(), actor([], true)), null)
  assert.match(decideSetMeetingFeedback(meeting(), actor(["host"])) ?? "", /representative or an admin/)
  assert.equal(decideSetMeetingFeedback(meeting({ feedbackId: null }), actor(["host"])), null)
  assert.match(decideSetMeetingFeedback(meeting(), actor(["someone"])) ?? "", /representative or an admin/)
})

test("dashboard, confirmed, active meetings only — even for an admin", () => {
  assert.match(decideSetMeetingFeedback(meeting({ origin: "dynamics" }), actor([], true)) ?? "", /Dynamics until go-live/)
  assert.match(decideSetMeetingFeedback(meeting({ meetingStatus: "Cancelled" }), actor([], true)) ?? "", /confirmed, active/)
  assert.match(decideSetMeetingFeedback(meeting({ state: "Inactive" }), actor([], true)) ?? "", /confirmed, active/)
})

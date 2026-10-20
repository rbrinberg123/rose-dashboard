import { test } from "node:test"
import assert from "node:assert/strict"

import { MEETING_EVENT_STAGES, MEETING_TYPE_LIVE, nextProfileStage, validateMeetingRequired } from "./create.ts"

test("profile advance: New → Created/Under Review → Approved → Sent, then stop", () => {
  assert.equal(nextProfileStage("New"), "Created/Under Review")
  assert.equal(nextProfileStage("Created/Under Review"), "Approved")
  assert.equal(nextProfileStage("Approved"), "Sent")
  assert.equal(nextProfileStage("Sent"), null)
  assert.equal(nextProfileStage("Not Needed"), null)
  assert.equal(nextProfileStage(null), null)
})

test("required: client, type, institution, investor", () => {
  const ok = { clientAccountId: "a", typeCode: 755860000, institutionId: "i", investor: "J. Smith" }
  assert.deepEqual(validateMeetingRequired(ok), {})
  assert.deepEqual(
    Object.keys(validateMeetingRequired({ clientAccountId: null, typeCode: null, institutionId: null, investor: "  " })).sort(),
    ["clientAccountId", "institutionId", "investor", "typeCode"],
  )
  assert.ok(validateMeetingRequired({ ...ok, typeCode: 1 }).typeCode)
})

test("event picker stages exclude later stages and Pause", () => {
  assert.deepEqual([...MEETING_EVENT_STAGES], ["Pre-Launch", "Live Outreach", "Meetings Ongoing"])
  for (const s of ["Schedule Closed", "Preparing Feedback", "Complete", "Pause"]) {
    assert.ok(!(MEETING_EVENT_STAGES as readonly string[]).includes(s), s)
  }
})

test("city: required only for a Live meeting, optional for Virtual", () => {
  const base = { clientAccountId: "a", institutionId: "i", investor: "J. Smith" }
  assert.deepEqual(validateMeetingRequired({ ...base, typeCode: 755860000, cityName: null }), {})
  assert.deepEqual(validateMeetingRequired({ ...base, typeCode: 755860000, cityName: "  " }), {})
  assert.ok(validateMeetingRequired({ ...base, typeCode: MEETING_TYPE_LIVE, cityName: null }).cityName)
  assert.ok(validateMeetingRequired({ ...base, typeCode: MEETING_TYPE_LIVE, cityName: " " }).cityName)
  assert.deepEqual(validateMeetingRequired({ ...base, typeCode: MEETING_TYPE_LIVE, cityName: "Boston" }), {})
})

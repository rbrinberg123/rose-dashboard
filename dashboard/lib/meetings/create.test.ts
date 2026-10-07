import { test } from "node:test"
import assert from "node:assert/strict"

import { MEETING_EVENT_STAGES, validateMeetingRequired } from "./create.ts"

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

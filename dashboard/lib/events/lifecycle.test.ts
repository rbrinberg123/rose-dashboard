import { test } from "node:test"
import assert from "node:assert/strict"

import { EVENT_LIFECYCLE_STEPS, isPausedStage, lifecycleIndex, stepFromToggles } from "./lifecycle.ts"
import { EVENT_STATE_OPTIONS, buildEventName, validateEventRequired } from "./create.ts"

test("required: client, location, slots, urgency", () => {
  const ok = { clientAccountId: "a", location: "Virtual", slots: "8", urgencyCode: 755860000 }
  assert.deepEqual(validateEventRequired(ok), {})
  assert.deepEqual(Object.keys(validateEventRequired({ clientAccountId: null, location: " ", slots: "", urgencyCode: null })).sort(), [
    "clientAccountId",
    "location",
    "slots",
    "urgencyCode",
  ])
  assert.ok(validateEventRequired({ ...ok, slots: "2.5" }).slots)
  assert.ok(validateEventRequired({ ...ok, slots: "-1" }).slots)
  assert.deepEqual(validateEventRequired({ ...ok, slots: "0" }), {})
  assert.ok(validateEventRequired({ ...ok, urgencyCode: 1 }).urgencyCode)
})

test("every step is a real stored stage label", () => {
  const stored = new Set<string>(EVENT_STATE_OPTIONS.map((o) => o.label))
  for (const s of EVENT_LIFECYCLE_STEPS) assert.ok(stored.has(s), s)
  assert.ok(stored.has("Pause"))
})

test("lifecycle index", () => {
  assert.equal(lifecycleIndex("Pre-Launch"), 0)
  assert.equal(lifecycleIndex(" Complete "), 5)
  assert.equal(lifecycleIndex("Pause"), -1)
  assert.equal(lifecycleIndex(null), -1)
  assert.equal(isPausedStage("Pause"), true)
  assert.equal(isPausedStage("Complete"), false)
})

test("paused events sit where their toggles reach", () => {
  assert.equal(stepFromToggles(false, true), "Pre-Launch")
  assert.equal(stepFromToggles(true, false), "Live Outreach")
  assert.equal(stepFromToggles(true, true), "Schedule Closed")
})

test("event name: TICKER - Location - Dates, blanks dropped", () => {
  assert.equal(buildEventName("TCRM", "Virtual", "12/1, 12/2"), "TCRM - Virtual - 12/1, 12/2")
  assert.equal(buildEventName(" TCRM ", "  ", "12/1 "), "TCRM - 12/1")
  assert.equal(buildEventName("TCRM", null, undefined), "TCRM")
  assert.equal(buildEventName(null, "", ""), "")
})

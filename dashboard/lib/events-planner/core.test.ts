import { test } from "node:test"
import assert from "node:assert/strict"

import {
  crmMeetingStart,
  dualTime,
  enumerateDates,
  isoToZoned,
  mapCrmStatus,
  mapMeetingType,
  planCrmMeetings,
  proposeDateRange,
  zonedToIso,
  type CrmMeetingRow,
} from "./core.ts"

// ---- time zones -------------------------------------------------------------

test("Eastern wall clock → instant, summer and winter", () => {
  assert.equal(zonedToIso("2026-10-06", "10:00", "America/New_York"), "2026-10-06T14:00:00.000Z") // EDT
  assert.equal(zonedToIso("2026-12-07", "10:00", "America/New_York"), "2026-12-07T15:00:00.000Z") // EST
})

test("Chicago wall clock → instant, and back", () => {
  const iso = zonedToIso("2026-10-07", "09:30", "America/Chicago")
  assert.equal(iso, "2026-10-07T14:30:00.000Z")
  assert.deepEqual(isoToZoned(iso!, "America/Chicago"), { date: "2026-10-07", time: "09:30" })
  assert.deepEqual(isoToZoned(iso!, "America/New_York"), { date: "2026-10-07", time: "10:30" })
})

test("DST changeover days use the right offset on each side", () => {
  // Fall back (Nov 1): midday is EST (-5).
  assert.equal(zonedToIso("2026-11-01", "12:30", "America/New_York"), "2026-11-01T17:30:00.000Z")
  // Spring forward (Mar 8): 3:30 AM is EDT (-4).
  assert.equal(zonedToIso("2026-03-08", "03:30", "America/New_York"), "2026-03-08T07:30:00.000Z")
})

test("dualTime shows Eastern only when the clocks differ", () => {
  const ny = zonedToIso("2026-10-06", "10:00", "America/New_York")!
  assert.equal(dualTime(ny, "America/New_York"), "10:00 AM")
  // Toronto shares Eastern's clock — no second time.
  assert.equal(dualTime(ny, "America/Toronto"), "10:00 AM")
  const chi = zonedToIso("2026-10-07", "10:00", "America/Chicago")!
  assert.equal(dualTime(chi, "America/Chicago"), "10:00 AM CDT · 11:00 AM EDT")
})

test("enumerateDates is inclusive and rejects reversed ranges", () => {
  assert.deepEqual(enumerateDates("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"])
  assert.deepEqual(enumerateDates("2026-10-02", "2026-10-01"), [])
})

// ---- CRM import ---------------------------------------------------------------

const base: CrmMeetingRow = {
  meeting_id: "m1",
  meeting_date: "2026-10-06T10:00:00+00:00",
  origin: "dynamics",
  meeting_status_label: "Confirmed",
  meeting_type_label: "Live",
  is_in_person: true,
  group_meeting: false,
  hosted_in_hq: false,
  institution_id: "i1",
  institution_name: "Fidelity",
  investor_text: "Jane Doe",
  city_name: "Boston",
  state_region_name: "MA",
}

test("synced CRM time: the stored digits are the local wall clock", () => {
  // Stored 10:00+00 means a 10:00 meeting — on an Eastern day that is 14:00Z.
  assert.equal(crmMeetingStart(base, "America/New_York"), "2026-10-06T14:00:00.000Z")
  // The same digits on a Chicago day mean 10:00 Central.
  assert.equal(crmMeetingStart(base, "America/Chicago"), "2026-10-06T15:00:00.000Z")
})

test("dashboard-created CRM time is already a true instant", () => {
  const m = { ...base, origin: "dashboard", meeting_date: "2026-10-06T14:00:00+00:00" }
  assert.equal(crmMeetingStart(m, "America/New_York"), "2026-10-06T14:00:00.000Z")
})

test("status and type mapping", () => {
  assert.equal(mapCrmStatus("Confirmed"), "confirmed")
  assert.equal(mapCrmStatus("Pending"), "tentative")
  assert.equal(mapCrmStatus("TBR"), "tentative")
  assert.equal(mapCrmStatus("Cancelled"), "cancelled")
  assert.equal(mapMeetingType({ group_meeting: true, meeting_type_label: "Live", is_in_person: true }), "Group")
  assert.equal(mapMeetingType({ group_meeting: false, meeting_type_label: "Virtual", is_in_person: false }), "Video")
  assert.equal(mapMeetingType({ group_meeting: false, meeting_type_label: "Live", is_in_person: true }), "One-on-One")
})

test("planCrmMeetings: default length, range check, cancelled unticked, sorted", () => {
  const rows: CrmMeetingRow[] = [
    { ...base, meeting_id: "late", meeting_date: "2026-10-06T15:00:00+00:00" },
    { ...base, meeting_id: "early" },
    { ...base, meeting_id: "cxl", meeting_status_label: "Cancelled" },
    { ...base, meeting_id: "out", meeting_date: "2026-10-20T10:00:00+00:00" },
    { ...base, meeting_id: "notime", meeting_date: null },
  ]
  const plan = planCrmMeetings(rows, { startDate: "2026-10-06", endDate: "2026-10-07", meetingMinutes: 45 })
  const byId = Object.fromEntries(plan.map((p) => [p.crmMeetingId, p]))

  assert.equal(byId.early.localTime, "10:00")
  assert.equal(byId.early.endIso, "2026-10-06T14:45:00.000Z")
  assert.equal(byId.early.title, "Fidelity")
  assert.equal(byId.early.atInvestorOffice, true)
  assert.equal(byId.early.defaultSelected, true)

  assert.equal(byId.cxl.defaultSelected, false)
  assert.equal(byId.out.problem, "Outside the itinerary dates")
  assert.equal(byId.notime.problem, "No meeting time in the CRM")

  const order = plan.map((p) => p.crmMeetingId)
  assert.ok(order.indexOf("early") < order.indexOf("late"))
  assert.equal(plan[plan.length - 1].crmMeetingId, "notime") // no time sorts last
})

test("proposeDateRange: event dates win, else meeting span, else today", () => {
  assert.deepEqual(
    proposeDateRange({ event_start_actual: "2026-10-06T00:00:00+00:00", event_end_actual: "2026-10-08T00:00:00+00:00" }, [], "2026-10-02"),
    { startDate: "2026-10-06", endDate: "2026-10-08" },
  )
  assert.deepEqual(
    proposeDateRange({ event_start_actual: null, event_end_actual: null }, [base, { ...base, meeting_date: "2026-10-09T09:00:00+00:00" }], "2026-10-02"),
    { startDate: "2026-10-06", endDate: "2026-10-09" },
  )
  assert.deepEqual(proposeDateRange({ event_start_actual: null, event_end_actual: null }, [], "2026-10-02"), {
    startDate: "2026-10-02",
    endDate: "2026-10-02",
  })
})

import { test } from "node:test"
import assert from "node:assert/strict"

import { computeClientHours, resolveWindow, type MeetingIn } from "./hours.ts"

const now = new Date("2026-10-15T12:00:00Z")
const w = resolveWindow("12m", now)
const mtg = (type: "Live" | "Virtual", status: string, date = "2026-05-01T15:00:00Z"): MeetingIn => ({
  client_account_id: "a",
  meeting_date: date,
  meeting_type_label: type,
  is_in_person: type === "Live",
  meeting_status_label: status,
})

test("hours model: booking / hosting / feedback / reports / client management", () => {
  const { rows } = computeClientHours(
    [{ account_id: "a", client_name: "A", start_date: "2020-01-01", start_source: "original_start_date" }],
    [mtg("Virtual", "Confirmed"), mtg("Live", "Confirmed"), mtg("Live", "Cancelled"), mtg("Virtual", "TBR")],
    [{ client_account_id: "a" }, { client_account_id: "a" }],
    w,
    now,
  )
  const r = rows[0]
  assert.equal(r.booking, 1 + 1.5 + 1.5 + 1) // cancelled + TBR still booked
  assert.equal(r.bookingExclCancelled, 1 + 1.5 + 1)
  assert.equal(r.hosting, 1.5 + 3) // held = Confirmed + past only
  assert.equal(r.feedbackCollection, 2)
  assert.equal(r.reportPrep, 2)
  assert.equal(r.clientMgmt, 36)
  assert.equal(r.total, 5 + 4.5 + 2 + 2 + 36)
  assert.equal(r.totalExclCancelled, r.total - 1.5)
  assert.equal(r.lessThanOneYear, false)
})

test("a client under one year is flagged and client management is pro-rated", () => {
  const { rows } = computeClientHours(
    [{ account_id: "a", client_name: "A", start_date: "2026-04-15", start_source: "original_start_date" }],
    [],
    [],
    w,
    now,
  )
  assert.equal(rows[0].lessThanOneYear, true)
  assert.ok(Math.abs(rows[0].clientMgmt - 18) < 0.3, `~6 months → ~18 h, got ${rows[0].clientMgmt}`)
})

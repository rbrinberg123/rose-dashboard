import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildIcs,
  icsFold,
  inviteBlocker,
  invitePayload,
  isExternalEmail,
  planInvites,
  zonedToIso,
  type InviteAttendee,
  type InviteItem,
  type InviteRecord,
} from "./core.ts"

const NY = "America/New_York"
const CHI = "America/Chicago"

const meeting = (over: Partial<InviteItem> = {}): InviteItem => ({
  id: "11111111-1111-4111-8111-111111111111",
  item_type: "meeting",
  status: "confirmed",
  send_invite: true,
  title: "Fidelity",
  start_at: zonedToIso("2026-10-07", "10:00", CHI)!,
  end_at: zonedToIso("2026-10-07", "10:45", CHI)!,
  timezone: CHI,
  institution_name: "Fidelity",
  meeting_type_name: "One-on-One",
  venue_name: "Fidelity Chicago",
  address_line1: "1 N Wacker Dr",
  address_line2: null,
  city: "Chicago",
  state: "IL",
  postal_code: null,
  room_or_floor: "Floor 20",
  video_url: null,
  dial_in: null,
  dial_in_passcode: null,
  notes_external: "Ask for the 20th-floor reception, please; bring ID.",
  attendee_ids: ["ceo", "inv", "rose"],
  travel: null,
  ...over,
})

const people: InviteAttendee[] = [
  { id: "ceo", full_name: "Casey CEO", email: "casey@acme.com", phone: null, title: "CEO", company: "Acme Corp", side: "client", receives_full_itinerary: true },
  { id: "inv", full_name: "Ivy Investor", email: "ivy@fidelity.com", phone: null, title: "PM", company: "Fidelity", side: "external", receives_full_itinerary: false },
  { id: "rose", full_name: "Rob Rose", email: "rob@roseandco.com", phone: "212-555-0100", title: null, company: "Rose & Company", side: "internal", receives_full_itinerary: true },
  { id: "nomail", full_name: "No Mail", email: null, phone: null, title: null, company: null, side: "client", receives_full_itinerary: true },
]

const unfold = (ics: string) => ics.replace(/\r\n /g, "")

test("REQUEST: stable UID, SEQUENCE, TZID times with a VTIMEZONE, summary, organizer, one attendee", () => {
  const p = invitePayload(meeting(), people, "Acme Corp")
  const ics = buildIcs({ payload: p, method: "REQUEST", sequence: 0, recipient: { name: "Ivy Investor", email: "ivy@fidelity.com" }, now: new Date("2026-10-01T12:00:00Z") })
  const u = unfold(ics)
  assert.ok(u.includes("METHOD:REQUEST"))
  assert.ok(u.includes("UID:ep-11111111-1111-4111-8111-111111111111@roseandco.com"))
  assert.ok(u.includes("SEQUENCE:0"))
  assert.ok(u.includes("DTSTART;TZID=America/Chicago:20261007T100000"))
  assert.ok(u.includes("DTEND;TZID=America/Chicago:20261007T104500"))
  assert.ok(u.includes("BEGIN:VTIMEZONE\r\nTZID:America/Chicago"))
  assert.ok(u.includes("SUMMARY:Acme Corp × Fidelity — One-on-One"))
  assert.ok(u.includes("ORGANIZER;CN=Rose & Company:mailto:dashboards@roseandco.com"))
  assert.equal((u.match(/^ATTENDEE/gm) ?? []).length, 1) // only the recipient — no one sees other emails
  assert.ok(u.includes("STATUS:CONFIRMED"))
  assert.ok(u.includes("\\;") && u.includes("\\,"), "TEXT values are escaped")
  assert.ok(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75), "lines folded at 75 octets")
})

test("CANCEL: same UID, higher SEQUENCE, STATUS:CANCELLED", () => {
  const p = invitePayload(meeting(), people, "Acme Corp")
  const u = unfold(buildIcs({ payload: p, method: "CANCEL", sequence: 3, recipient: { name: "Ivy", email: "ivy@fidelity.com" } }))
  assert.ok(u.includes("METHOD:CANCEL"))
  assert.ok(u.includes("UID:ep-11111111-1111-4111-8111-111111111111@roseandco.com"))
  assert.ok(u.includes("SEQUENCE:3"))
  assert.ok(u.includes("STATUS:CANCELLED"))
})

test("never includes internal notes or confirmation numbers", () => {
  const item = {
    ...meeting(),
    notes_internal: "INTERNAL-SECRET fee",
    travel: {
      mode: "car_service",
      to_timezone: CHI,
      driver_name: "Dan",
      driver_phone: "555",
      transport_company: "Carmel",
      carrier: null,
      flight_or_train_number: null,
      pickup_instructions: null,
      confirmation_number: "CONF-12345",
    },
  } as InviteItem
  const ics = unfold(buildIcs({ payload: invitePayload(item, people, "Acme Corp"), method: "REQUEST", sequence: 0, recipient: null }))
  assert.ok(!ics.includes("INTERNAL-SECRET"))
  assert.ok(!ics.includes("CONF-12345"))
  assert.ok(ics.includes("Driver Dan 555"))
})

test("a cross-zone flight ends on the arrival zone's clock", () => {
  const f = meeting({
    item_type: "travel",
    title: "AA 123 to Chicago",
    timezone: NY,
    start_at: zonedToIso("2026-10-07", "08:00", NY)!,
    end_at: zonedToIso("2026-10-07", "09:30", CHI)!,
    travel: { mode: "flight", to_timezone: CHI, driver_name: null, driver_phone: null, transport_company: null, carrier: "AA", flight_or_train_number: "123", pickup_instructions: null },
  })
  const u = unfold(buildIcs({ payload: invitePayload(f, people, null), method: "REQUEST", sequence: 0, recipient: null }))
  assert.ok(u.includes("DTSTART;TZID=America/New_York:20261007T080000"))
  assert.ok(u.includes("DTEND;TZID=America/Chicago:20261007T093000"))
  assert.ok(u.includes("TZID:America/New_York") && u.includes("TZID:America/Chicago"))
})

test("folding keeps multi-byte characters whole", () => {
  const long = "SUMMARY:" + "Acme × Fidelity — ".repeat(10)
  const folded = icsFold(long)
  assert.equal(folded.replace(/\r\n /g, ""), long)
})

test("who gets an invite: travel only to the travelling party; no email / cancelled / invites off → none", () => {
  const travel = meeting({ item_type: "travel", travel: { mode: "car_service", to_timezone: null, driver_name: null, driver_phone: null, transport_company: null, carrier: null, flight_or_train_number: null, pickup_instructions: null } })
  assert.equal(inviteBlocker(travel, people[1]), "Travel goes only to the travelling party")
  assert.equal(inviteBlocker(travel, people[0]), null)
  assert.equal(inviteBlocker(meeting({ attendee_ids: ["nomail"] }), people[3]), "No email")
  assert.equal(inviteBlocker(meeting({ status: "cancelled" }), people[0]), "Item cancelled")
  assert.equal(inviteBlocker(meeting({ send_invite: false }), people[0]), "Invites off for this item")
})

test("plan: new → none → update on change → cancel when cancelled", () => {
  const item = meeting({ attendee_ids: ["inv"] })
  const first = planInvites({ items: [item], attendees: people, records: [], clientName: "Acme", live: true })
  assert.deepEqual(first.map((r) => [r.attendeeId, r.action, r.sequence]), [["inv", "new", 0]])

  const sent: InviteRecord = { item_id: item.id, attendee_id: "inv", status: "sent", sequence: 0, last_payload_hash: first[0].hash, dry_run: false }
  assert.equal(planInvites({ items: [item], attendees: people, records: [sent], clientName: "Acme", live: true })[0].action, "none")

  const moved = { ...item, start_at: zonedToIso("2026-10-07", "11:00", CHI)!, end_at: zonedToIso("2026-10-07", "11:45", CHI)! }
  const upd = planInvites({ items: [moved], attendees: people, records: [sent], clientName: "Acme", live: true })[0]
  assert.deepEqual([upd.action, upd.state, upd.sequence], ["update", "update_pending", 1])

  const cancelled = planInvites({ items: [{ ...item, status: "cancelled" }], attendees: people, records: [sent], clientName: "Acme", live: true })[0]
  assert.deepEqual([cancelled.action, cancelled.sequence], ["cancel", 1])

  // Removed from the item after being invited → cancel too.
  const removed = planInvites({ items: [{ ...item, attendee_ids: [] }], attendees: people, records: [sent], clientName: "Acme", live: true })[0]
  assert.equal(removed.action, "cancel")
})

test("plan: a dry-run send counts as sent in dry-run mode, but as never sent once live", () => {
  const item = meeting({ attendee_ids: ["inv"] })
  const hash = planInvites({ items: [item], attendees: people, records: [], clientName: null, live: false })[0].hash
  const dry: InviteRecord = { item_id: item.id, attendee_id: "inv", status: "sent", sequence: 0, last_payload_hash: hash, dry_run: true }
  assert.equal(planInvites({ items: [item], attendees: people, records: [dry], clientName: null, live: false })[0].action, "none")
  assert.equal(planInvites({ items: [item], attendees: people, records: [dry], clientName: null, live: true })[0].action, "new")
  // …and a dry-run-only invite on a cancelled item has nothing real to cancel.
  assert.equal(planInvites({ items: [{ ...item, status: "cancelled" }], attendees: people, records: [dry], clientName: null, live: true })[0].action, "none")
})

test("attendee list changes trigger an update", () => {
  const a = invitePayload(meeting({ attendee_ids: ["inv"] }), people, null)
  const b = invitePayload(meeting({ attendee_ids: ["inv", "ceo"] }), people, null)
  assert.notEqual(a.hash, b.hash)
})

test("external = anything not @roseandco.com", () => {
  assert.equal(isExternalEmail("rob@roseandco.com"), false)
  assert.equal(isExternalEmail("ivy@fidelity.com"), true)
})

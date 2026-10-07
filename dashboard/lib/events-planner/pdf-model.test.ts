import { test } from "node:test"
import assert from "node:assert/strict"

import { buildPdfModel, zonedToIso, type PdfOptions, type PdfSource } from "./core.ts"

// The PDF content filter. The renderer draws only what buildPdfModel returns,
// so these are the guarantees for what can reach a printed itinerary.

const NY = "America/New_York"
const CHI = "America/Chicago"
const at = (d: string, t: string, tz = NY) => zonedToIso(d, t, tz)!

const SECRET_ITIN = "ITIN-SECRET do not share"
const SECRET_ITEM = "ITEM-SECRET fee discussion"
const SECRET_BLOCK = "BLOCK-SECRET host is touchy"
const SECRET_CONF = "CONF-998877"

function source(): PdfSource {
  const travel = {
    mode: "car_service",
    buffer_minutes: 10,
    to_timezone: NY,
    transport_company: "Carmel",
    driver_name: "Dan Driver",
    driver_phone: "555-0100",
    vehicle_type: "SUV",
    pickup_instructions: null,
    carrier: null,
    flight_or_train_number: null,
    depart_terminal: null,
    arrive_terminal: null,
    confirmation_number: SECRET_CONF,
    print_confirmation_number: false,
    from_label: "Fidelity",
    to_label: "Wellington",
  }
  const baseItem = {
    availability_block_id: null,
    timezone: NY,
    send_invite: true,
    venue_name: null,
    address_line1: "245 Summer St",
    address_line2: null,
    city: "Boston",
    state: "MA",
    room_or_floor: null,
    video_url: null,
    dial_in: null,
    dial_in_passcode: null,
    include_in_pdf: true,
    institution_name: "Fidelity",
    meeting_type_id: "mt1",
    notes_external: "Bring the deck.",
    notes_internal: null as string | null,
    travel: null,
    hotel: null,
  }
  return {
    title: "Acme NDR",
    subtitle: null,
    client_name: "Acme Corp",
    start_date: "2026-10-06",
    end_date: "2026-10-07",
    status: "draft",
    version: 0,
    confidential: true,
    internal_notes: SECRET_ITIN,
    client_notes: "Dress code: business.",
    days: [
      { id: "d1", date: "2026-10-06", city: "Boston", timezone: NY, day_title: null, day_notes: null },
      { id: "d2", date: "2026-10-07", city: "Chicago", timezone: CHI, day_title: null, day_notes: null },
    ],
    items: [
      {
        ...baseItem,
        id: "m1",
        day_id: "d1",
        item_type: "meeting",
        status: "confirmed",
        title: "Fidelity",
        start_at: at("2026-10-06", "09:00"),
        end_at: at("2026-10-06", "09:45"),
        attendee_ids: ["ceo", "inv1"],
        notes_internal: SECRET_ITEM,
      },
      {
        ...baseItem,
        id: "t1",
        day_id: "d1",
        item_type: "travel",
        status: "confirmed",
        title: "To Wellington",
        start_at: at("2026-10-06", "09:45"),
        end_at: at("2026-10-06", "10:15"),
        attendee_ids: ["ceo"],
        address_line1: null,
        travel,
      },
      {
        ...baseItem,
        id: "m2",
        day_id: "d1",
        item_type: "meeting",
        status: "cancelled",
        title: "Wellington",
        institution_name: "Wellington",
        start_at: at("2026-10-06", "10:30"),
        end_at: at("2026-10-06", "11:15"),
        attendee_ids: ["ceo", "inv2"],
      },
      {
        ...baseItem,
        id: "m3",
        day_id: "d2",
        item_type: "meeting",
        status: "confirmed",
        title: "Northern Trust",
        institution_name: "Northern Trust",
        timezone: CHI,
        city: "Chicago",
        start_at: at("2026-10-07", "10:00", CHI),
        end_at: at("2026-10-07", "10:45", CHI),
        attendee_ids: ["ceo"],
      },
      {
        ...baseItem,
        id: "hidden",
        day_id: "d2",
        item_type: "hold",
        status: "confirmed",
        title: "Private hold",
        include_in_pdf: false,
        start_at: at("2026-10-07", "12:00", CHI),
        end_at: at("2026-10-07", "13:00", CHI),
        attendee_ids: ["ceo"],
      },
    ],
    attendees: [
      { id: "ceo", crm_contact_id: "c1", full_name: "Casey CEO", email: "c@acme.com", phone: null, title: "CEO", company: "Acme Corp", role: "client_executive", side: "client", receives_full_itinerary: true },
      { id: "inv1", crm_contact_id: "c2", full_name: "Ivy Investor", email: "i@fid.com", phone: null, title: "PM", company: "Fidelity", role: "investor", side: "external", receives_full_itinerary: false },
      { id: "inv2", crm_contact_id: "c3", full_name: "Will Welling", email: "w@well.com", phone: null, title: "Analyst", company: "Wellington", role: "investor", side: "external", receives_full_itinerary: false },
    ],
    blocks: [
      {
        id: "b1",
        day_id: "d1",
        start_at: at("2026-10-06", "09:00"),
        end_at: at("2026-10-06", "12:00"),
        default_slot_minutes: 30,
        default_buffer_minutes: 5,
        block_type: "hard",
        label: "Fidelity — AM",
        host_institution_name: "Fidelity",
        timezone: NY,
        notes_internal: SECRET_BLOCK,
      },
    ],
    meetingTypes: [{ id: "mt1", name: "One-on-One" }],
  }
}

const opts = (o: Partial<PdfOptions>): PdfOptions => ({
  audience: "client",
  attendeeId: null,
  includeCancelled: false,
  includeConfirmations: false,
  includeAppendix: false,
  showAvailability: false,
  ...o,
})

const text = (o: unknown) => JSON.stringify(o)
const rowTitles = (m: ReturnType<typeof buildPdfModel>) => m.days.flatMap((d) => d.rows.map((r) => r.title))

test("CLIENT pdf: no internal notes anywhere, even with every toggle on", () => {
  const m = buildPdfModel(source(), opts({ includeCancelled: true, includeConfirmations: true, includeAppendix: true, showAvailability: true }))
  const s = text(m)
  for (const secret of [SECRET_ITIN, SECRET_ITEM, SECRET_BLOCK]) assert.ok(!s.includes(secret), `leaked: ${secret}`)
  assert.equal(m.internal, null)
})

test("SINGLE-ATTENDEE pdf: no internal notes, only that person's items", () => {
  const m = buildPdfModel(source(), opts({ audience: "attendee", attendeeId: "inv1", includeConfirmations: true, showAvailability: true }))
  const s = text(m)
  for (const secret of [SECRET_ITIN, SECRET_ITEM, SECRET_BLOCK, SECRET_CONF]) assert.ok(!s.includes(secret), `leaked: ${secret}`)
  assert.deepEqual(rowTitles(m), ["Fidelity"])
})

test("availability blocks never appear in client or attendee PDFs; internal only with the toggle", () => {
  const kinds = (m: ReturnType<typeof buildPdfModel>) => m.days.flatMap((d) => d.rows.map((r) => r.kind))
  assert.ok(!kinds(buildPdfModel(source(), opts({ showAvailability: true }))).includes("block"))
  assert.ok(!kinds(buildPdfModel(source(), opts({ audience: "attendee", attendeeId: "ceo", showAvailability: true }))).includes("block"))
  assert.ok(!kinds(buildPdfModel(source(), opts({ audience: "internal" }))).includes("block"))
  const withBlocks = buildPdfModel(source(), opts({ audience: "internal", showAvailability: true }))
  const block = withBlocks.days[0].rows.find((r) => r.kind === "block")!
  assert.match(block.detail!, /slots? open/)
})

test("INTERNAL pdf: internal notes on their own section, block notes included", () => {
  const m = buildPdfModel(source(), opts({ audience: "internal" }))
  assert.equal(m.internal?.itineraryNotes, SECRET_ITIN)
  assert.ok(text(m.internal).includes(SECRET_ITEM))
  assert.ok(text(m.internal).includes(SECRET_BLOCK))
  // …but not inside the day rows themselves.
  assert.ok(!text(m.days).includes(SECRET_ITEM))
})

test("confirmation numbers: off by default; client needs the toggle AND the leg's print flag", () => {
  assert.ok(!text(buildPdfModel(source(), opts({}))).includes(SECRET_CONF))
  assert.ok(!text(buildPdfModel(source(), opts({ includeConfirmations: true }))).includes(SECRET_CONF))
  const flagged = source()
  ;(flagged.items[1].travel as { print_confirmation_number: boolean }).print_confirmation_number = true
  assert.ok(text(buildPdfModel(flagged, opts({ includeConfirmations: true }))).includes(SECRET_CONF))
  assert.ok(text(buildPdfModel(source(), opts({ audience: "internal", includeConfirmations: true }))).includes(SECRET_CONF))
})

test("cancelled items only on request; 'not in PDF' items never", () => {
  assert.ok(!rowTitles(buildPdfModel(source(), opts({}))).includes("Wellington"))
  assert.ok(rowTitles(buildPdfModel(source(), opts({ includeCancelled: true }))).includes("Wellington"))
  assert.ok(!rowTitles(buildPdfModel(source(), opts({ audience: "internal", includeCancelled: true }))).includes("Private hold"))
})

test("meeting rows list investor attendees; another zone's day shows ET alongside", () => {
  const m = buildPdfModel(source(), opts({}))
  const fid = m.days[0].rows.find((r) => r.title === "Fidelity")!
  assert.deepEqual(fid.people.map((p) => p.name), ["Ivy Investor"])
  assert.equal(fid.timeEt, null)
  const nt = m.days[1].rows.find((r) => r.title === "Northern Trust")!
  assert.equal(nt.time, "10:00 AM – 10:45 AM")
  assert.equal(nt.timeEt, "11:00 AM ET")
  assert.equal(m.days[1].zoneLabel, "Central Time")
})

test("draft flag, totals and travelling party", () => {
  const m = buildPdfModel(source(), opts({ includeAppendix: true }))
  assert.equal(m.draft, true)
  assert.equal(m.glance.totals.meetings, 2)
  assert.deepEqual(m.glance.party.map((p) => p.name), ["Casey CEO"])
  assert.deepEqual(m.appendix?.map((a) => a.institution), ["Fidelity"])
})

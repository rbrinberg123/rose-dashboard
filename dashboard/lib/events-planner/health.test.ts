import { test } from "node:test"
import assert from "node:assert/strict"

import {
  blockCapacity,
  capacityText,
  checkSchedule,
  defaultBufferFor,
  healthSummary,
  nextSlotInBlock,
  zonedToIso,
  type BlockLike,
  type HealthInput,
  type HealthItem,
} from "./core.ts"

const NY = "America/New_York"
const D = "2026-10-06"
const at = (hhmm: string) => zonedToIso(D, hhmm, NY)!

const block = (over: Partial<BlockLike> = {}): BlockLike => ({
  id: "b1",
  day_id: "d1",
  start_at: at("09:00"),
  end_at: at("12:00"),
  default_slot_minutes: 30,
  default_buffer_minutes: 5,
  block_type: "hard",
  label: "Fidelity — AM",
  host_institution_name: "Fidelity",
  ...over,
})

let seq = 0
const item = (start: string, end: string, over: Partial<HealthItem> = {}): HealthItem => ({
  id: over.id ?? `i${++seq}`,
  day_id: "d1",
  item_type: "meeting",
  status: "confirmed",
  start_at: at(start),
  end_at: at(end),
  availability_block_id: null,
  title: over.title ?? `Meeting ${start}`,
  timezone: NY,
  send_invite: true,
  attendee_ids: ["inv"],
  travel: null,
  venue_name: null,
  address_line1: "1 Main St",
  city: "Boston",
  video_url: null,
  dial_in: null,
  ...over,
})

const base = (over: Partial<HealthInput> = {}): HealthInput => ({
  days: [{ id: "d1", date: D, timezone: NY, city: "Boston" }],
  items: [],
  attendees: [
    { id: "inv", full_name: "Ivy Investor", email: "ivy@fund.com", side: "external", role: "investor" },
    { id: "ceo", full_name: "Casey CEO", email: "ceo@client.com", side: "client", role: "client_executive" },
  ],
  blocks: [],
  airportLeadMinutes: 90,
  ...over,
})

const codes = (input: HealthInput) => checkSchedule(input).map((i) => `${i.severity}:${i.code}`)

// ---- capacity -------------------------------------------------------------

test("block capacity: 180 min with 30+5 slots ≈ 5; booked meetings reduce it", () => {
  const b = block()
  assert.equal(blockCapacity(b, []).capacity, 5)
  const c = blockCapacity(b, [item("09:00", "09:30", { availability_block_id: "b1" }), item("09:35", "10:05")])
  assert.equal(c.bookedCount, 2)
  assert.equal(c.bookedMinutes, 60)
  assert.equal(c.freeMinutes, 180 - 60 - 10)
  assert.equal(c.remainingSlots, 3)
  assert.equal(c.overCapacity, false)
  assert.equal(capacityText(c), "Booked 2 · ~3 slots open · 110 min free")
})

test("cancelled meetings and non-meetings don't count against a block", () => {
  const c = blockCapacity(block(), [item("09:00", "09:30", { status: "cancelled" }), item("10:00", "10:30", { item_type: "meal" })])
  assert.equal(c.bookedCount, 0)
})

test("over capacity when meetings + buffers exceed the window", () => {
  const b = block({ end_at: at("10:00") }) // 60 min
  const c = blockCapacity(b, [item("09:00", "09:30"), item("09:30", "10:00", { availability_block_id: "b1" })])
  assert.equal(c.overCapacity, true) // 30 + 30 + 5 buffer > 60
})

// ---- slotting -------------------------------------------------------------

test("nextSlotInBlock: start of block, then after each booking + buffer, then full", () => {
  const b = block({ end_at: at("10:15") }) // room for two 30-min slots + buffer
  const s1 = nextSlotInBlock(b, [])!
  assert.equal(s1.startIso, at("09:00"))
  const s2 = nextSlotInBlock(b, [item("09:00", "09:30")])!
  assert.equal(s2.startIso, at("09:35"))
  assert.equal(nextSlotInBlock(b, [item("09:00", "09:30"), item("09:35", "10:05")]), null)
})

test("nextSlotInBlock fills a hole between bookings when it fits", () => {
  const b = block()
  const s = nextSlotInBlock(b, [item("09:00", "09:30"), item("10:30", "11:00")])!
  assert.equal(s.startIso, at("09:35"))
})

test("nextSlotInBlock steps around a non-meeting item (a call) inside the window", () => {
  const s = nextSlotInBlock(block(), [item("09:00", "09:20", { item_type: "hold" })])!
  assert.equal(s.startIso, at("09:25"))
})

// ---- health checks --------------------------------------------------------

test("a clean day has no errors or warnings", () => {
  const i = item("10:00", "10:45")
  assert.deepEqual(codes(base({ items: [i] })), [])
  assert.equal(healthSummary([]), "No issues")
})

test("error: one attendee in two items at once", () => {
  const out = codes(base({ items: [item("10:00", "11:00"), item("10:30", "11:30")] }))
  assert.ok(out.includes("error:attendee_overlap"))
})

test("error: an item starting on another date from its day", () => {
  const i = item("10:00", "10:45", { start_at: zonedToIso("2026-10-07", "10:00", NY)!, end_at: zonedToIso("2026-10-07", "10:45", NY)! })
  assert.ok(codes(base({ items: [i] })).includes("error:outside_day"))
})

test("warning: different places with no travel; tight travel with buffer", () => {
  const a = item("09:00", "09:45", { address_line1: "1 State St" })
  const b = item("10:00", "10:45", { address_line1: "200 Clarendon St" })
  assert.ok(codes(base({ items: [a, b] })).includes("warning:no_travel"))

  const leg = item("09:45", "10:00", { item_type: "travel", attendee_ids: [], address_line1: null, travel: { mode: "car_service", buffer_minutes: 10 } })
  assert.ok(codes(base({ items: [a, leg, b] })).includes("warning:tight_travel")) // 15 travel + 10 buffer > 15 gap

  const ok = item("09:45", "09:55", { item_type: "travel", attendee_ids: [], address_line1: null, travel: { mode: "car_service", buffer_minutes: 5 } })
  const out = codes(base({ items: [a, ok, b] }))
  assert.ok(!out.includes("warning:tight_travel") && !out.includes("warning:no_travel"))
})

test("warning: flight too soon after the previous commitment", () => {
  const m = item("08:00", "09:00")
  const f = item("09:30", "11:00", { item_type: "travel", attendee_ids: [], address_line1: null, travel: { mode: "flight", buffer_minutes: 90 } })
  assert.ok(codes(base({ items: [m, f] })).includes("warning:airport_lead"))
})

test("warnings: no location, no investor, no email for an invitee", () => {
  const i = item("10:00", "10:45", { address_line1: null, city: null, attendee_ids: ["ceo", "noemail"] })
  const out = codes(
    base({
      items: [i],
      attendees: [...base().attendees, { id: "noemail", full_name: "No Email", email: null, side: "client", role: "client_executive" }],
    }),
  )
  assert.ok(out.includes("warning:no_location"))
  assert.ok(out.includes("warning:no_investor"))
  assert.ok(out.includes("warning:no_email"))
})

test("warning: double-booked in another itinerary (from the server)", () => {
  const i = item("10:00", "10:45", { id: "mine" })
  const out = codes(base({ items: [i], crossBookings: [{ attendeeId: "inv", itemId: "mine", otherTitle: "Lunch", otherItinerary: "Other NDR" }] }))
  assert.ok(out.includes("warning:double_booked"))
})

test("blocks: outside-block warning, hard over capacity = error, soft = warning, underused = info", () => {
  const b = block({ end_at: at("10:00") })
  const outside = item("14:00", "14:30")
  assert.ok(codes(base({ blocks: [b], items: [outside] })).includes("warning:outside_block"))

  const full = [item("09:00", "09:30"), item("09:30", "10:00")]
  assert.ok(codes(base({ blocks: [b], items: full })).includes("error:block_over_capacity"))
  assert.ok(codes(base({ blocks: [{ ...b, block_type: "soft" }], items: full })).includes("warning:block_over_capacity"))

  assert.ok(codes(base({ blocks: [block()], items: [item("09:00", "09:30")] })).includes("info:block_underused"))
})

test("info: early start, late finish, more than eight meetings", () => {
  const out = codes(base({ items: [item("06:30", "07:00"), item("22:00", "22:30", { attendee_ids: ["ceo"] })] }))
  assert.ok(out.includes("info:early_start"))
  assert.ok(out.includes("info:late_end"))
  const many = Array.from({ length: 9 }, (_, k) => item(`${String(9 + k).padStart(2, "0")}:00`, `${String(9 + k).padStart(2, "0")}:30`))
  assert.ok(codes(base({ items: many })).includes("info:many_meetings"))
})

test("issues come back errors first", () => {
  const issues = checkSchedule(base({ blocks: [block()], items: [item("09:00", "09:30"), item("09:10", "09:40")] }))
  const order = issues.map((i) => i.severity)
  assert.deepEqual(order, [...order].sort((a, b) => ["error", "warning", "info"].indexOf(a) - ["error", "warning", "info"].indexOf(b)))
})

test("default buffers come from the itinerary's settings", () => {
  const s = { buffer_car_minutes: 10, buffer_walk_minutes: 15, airport_lead_minutes: 90 }
  assert.equal(defaultBufferFor("car_service", s), 10)
  assert.equal(defaultBufferFor("walk", s), 15)
  assert.equal(defaultBufferFor("flight", s), 90)
})

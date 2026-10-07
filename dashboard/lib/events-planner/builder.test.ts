import { test } from "node:test"
import assert from "node:assert/strict"

import {
  keepWallClock,
  layoutLanes,
  minutesIntoDay,
  resolveTimes,
  nextFreeSlot,
  travelGaps,
  travelSlot,
  zonedToIso,
  type LocatedItem,
} from "./core.ts"

const NY = "America/New_York"

test("minutesIntoDay counts from local midnight", () => {
  assert.equal(minutesIntoDay(zonedToIso("2026-10-06", "09:30", NY)!, "2026-10-06", NY), 570)
  assert.equal(minutesIntoDay(zonedToIso("2026-10-07", "09:30", "America/Chicago")!, "2026-10-07", "America/Chicago"), 570)
})

test("layoutLanes puts overlaps side by side and keeps separate clusters at one lane", () => {
  const lanes = layoutLanes([
    { id: "a", start: 540, end: 600 },
    { id: "b", start: 560, end: 620 },
    { id: "c", start: 700, end: 760 },
  ])
  assert.deepEqual(lanes.get("a"), { lane: 0, lanes: 2 })
  assert.deepEqual(lanes.get("b"), { lane: 1, lanes: 2 })
  assert.deepEqual(lanes.get("c"), { lane: 0, lanes: 1 })
})

test("layoutLanes: back-to-back blocks do not overlap", () => {
  const lanes = layoutLanes([
    { id: "a", start: 540, end: 600 },
    { id: "b", start: 600, end: 660 },
  ])
  assert.deepEqual(lanes.get("b"), { lane: 0, lanes: 1 })
})

const item = (id: string, start: string, end: string, extra: Partial<LocatedItem> = {}): LocatedItem => ({
  id,
  item_type: "meeting",
  status: "confirmed",
  start_at: zonedToIso("2026-10-06", start, NY)!,
  end_at: zonedToIso("2026-10-06", end, NY)!,
  venue_name: null,
  address_line1: null,
  city: null,
  video_url: null,
  dial_in: null,
  ...extra,
})

test("travelGaps: different addresses with nothing between → offer travel", () => {
  const a = item("a", "09:00", "09:45", { address_line1: "1 State St" })
  const b = item("b", "10:30", "11:15", { address_line1: "200 Clarendon St" })
  const c = item("c", "11:30", "12:15", { address_line1: "200 clarendon  st" }) // same place, different spacing
  const gaps = travelGaps([b, c, a])
  assert.deepEqual(gaps.map((g) => `${g.from.id}>${g.to.id}`), ["a>b"])
})

test("travelGaps: an existing travel block, a cancelled item or a missing place → no offer", () => {
  const a = item("a", "09:00", "09:45", { address_line1: "1 State St" })
  const t = item("t", "09:45", "10:15", { item_type: "travel" })
  const b = item("b", "10:30", "11:15", { address_line1: "200 Clarendon St" })
  assert.equal(travelGaps([a, t, b]).length, 0)
  const x = item("x", "10:00", "10:20", { address_line1: "9 Elm", status: "cancelled" })
  const y = item("y", "10:30", "11:00") // no place
  assert.equal(travelGaps([a, x, y]).length, 0)
})

test("travelSlot fills the gap, or gives 30 min when there is none", () => {
  const s = travelSlot("2026-10-06T13:45:00.000Z", "2026-10-06T14:30:00.000Z")
  assert.deepEqual(s, { startIso: "2026-10-06T13:45:00.000Z", endIso: "2026-10-06T14:30:00.000Z" })
  const t = travelSlot("2026-10-06T13:45:00.000Z", "2026-10-06T13:45:00.000Z")
  assert.equal(t.endIso, "2026-10-06T14:15:00.000Z")
})

test("nextFreeSlot: after the chosen item, else after the last, else 9 AM", () => {
  const a = item("a", "09:00", "09:45")
  const b = item("b", "13:00", "14:00")
  assert.equal(nextFreeSlot([a, b], "2026-10-06", NY, 45, a).startIso, a.end_at)
  assert.equal(nextFreeSlot([a, b], "2026-10-06", NY, 45).startIso, b.end_at)
  assert.equal(nextFreeSlot([], "2026-10-06", NY, 45).startIso, zonedToIso("2026-10-06", "09:00", NY))
})

test("keepWallClock: switching a day from Eastern to Central keeps 10:00 at 10:00", () => {
  const ny10 = zonedToIso("2026-10-07", "10:00", NY)!
  assert.equal(keepWallClock(ny10, NY, "America/Chicago"), zonedToIso("2026-10-07", "10:00", "America/Chicago"))
})

test("resolveTimes: same-zone, cross-zone flight, overnight, and bad order", () => {
  const r = resolveTimes({ dayDate: "2026-10-07", dayTz: NY, startTime: "09:00", endTime: "09:45" })
  assert.deepEqual(r, { ok: true, startIso: "2026-10-07T13:00:00.000Z", endIso: "2026-10-07T13:45:00.000Z" })
  // NYC 8:00 AM EDT → Chicago 9:30 AM CDT = 2.5 h in the air.
  const f = resolveTimes({ dayDate: "2026-10-07", dayTz: NY, startTime: "08:00", endTime: "09:30", endTz: "America/Chicago" })
  assert.ok(f.ok)
  if (f.ok) assert.equal((Date.parse(f.endIso) - Date.parse(f.startIso)) / 60_000, 150)
  // Late dinner running past midnight.
  const d = resolveTimes({ dayDate: "2026-10-07", dayTz: NY, startTime: "22:30", endTime: "00:30" })
  assert.ok(d.ok && d.endIso === "2026-10-08T04:30:00.000Z")
  // 14:00 → 09:00 is not an overnight, it's a mistake.
  assert.equal(resolveTimes({ dayDate: "2026-10-07", dayTz: NY, startTime: "14:00", endTime: "09:00" }).ok, false)
})

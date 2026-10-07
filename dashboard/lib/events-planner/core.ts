/**
 * Events Planner core — time-zone helpers + the CRM import rules. Pure (Intl
 * only, no imports, no library) so the browser, the server and the node:test
 * runner all share them.
 *
 * The model:
 *   - every moment is stored as ONE exact instant (timestamptz / ISO string);
 *   - each day has its city's IANA zone (default HOME_TZ, Eastern);
 *   - times are entered and shown in that zone, with Eastern alongside whenever
 *     the two clocks differ ("10:00 AM CDT · 11:00 AM EDT").
 */

export const HOME_TZ = "America/New_York"

/** Zones offered for a day's city. Eastern first; the rest roughly by offset. */
export const TIMEZONE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Toronto", label: "Toronto" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris / Frankfurt" },
  { value: "Europe/Zurich", label: "Zurich / Geneva" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Hong_Kong", label: "Hong Kong" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
] as const

/** Is `tz` a zone this runtime understands? */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>()
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    partsCache.set(tz, f)
  }
  return f
}

/** The wall clock in `tz` at `date`, read back as if it were UTC (ms). */
function wallAsUtcMs(date: Date, tz: string): number {
  const parts = partsFormatter(tz).formatToParts(date)
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  // hour12:false renders midnight as "24" in some engines; %24 normalises it.
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"))
}

/** Offset of `tz` from UTC at `date`, in ms (New York in summer → -4h). */
export function zoneOffsetMs(date: Date, tz: string): number {
  return wallAsUtcMs(date, tz) - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * A wall-clock time in `tz` → the exact instant (ISO). Accepts "YYYY-MM-DD" +
 * "HH:mm". Two passes, so a time next to a DST changeover lands correctly.
 * Returns null on bad input.
 */
export function zonedToIso(ymd: string, hhmm: string, tz: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd ?? "").trim())
  const t = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim())
  if (!d || !t) return null
  const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2])
  if (Number.isNaN(wall)) return null
  let ms = wall - zoneOffsetMs(new Date(wall), tz)
  ms = wall - zoneOffsetMs(new Date(ms), tz)
  return new Date(ms).toISOString()
}

/** An instant → its date ("YYYY-MM-DD") and time ("HH:mm") on the clock in `tz`. */
export function isoToZoned(iso: string, tz: string): { date: string; time: string } {
  const w = new Date(wallAsUtcMs(new Date(iso), tz))
  const p = (n: number) => String(n).padStart(2, "0")
  return {
    date: `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())}`,
    time: `${p(w.getUTCHours())}:${p(w.getUTCMinutes())}`,
  }
}

/** "10:00 AM" on the clock in `tz`. */
export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  )
}

/** Short zone name at that instant: "EDT", "CST", "GMT+1". */
export function zoneAbbrev(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(
    new Date(iso),
  )
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz
}

/** Do the clocks in `tz` and Eastern read differently at this instant? */
export function differsFromHome(iso: string, tz: string): boolean {
  const d = new Date(iso)
  return zoneOffsetMs(d, tz) !== zoneOffsetMs(d, HOME_TZ)
}

/**
 * The display used everywhere a time appears in the planner: local first, then
 * Eastern when the clocks differ.
 *   Eastern day:  "10:00 AM"
 *   Chicago day:  "10:00 AM CDT · 11:00 AM EDT"
 */
export function dualTime(iso: string, tz: string): string {
  if (!differsFromHome(iso, tz)) return formatTime(iso, tz)
  return `${formatTime(iso, tz)} ${zoneAbbrev(iso, tz)} · ${formatTime(iso, HOME_TZ)} ${zoneAbbrev(iso, HOME_TZ)}`
}

/** Every calendar date from start to end inclusive ("YYYY-MM-DD"). */
export function enumerateDates(start: string, end: string): string[] {
  const s = Date.parse(`${start}T00:00:00Z`)
  const e = Date.parse(`${end}T00:00:00Z`)
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return []
  const out: string[] = []
  for (let t = s; t <= e; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

/** Today's date on the Eastern clock. */
export function todayHome(now: Date = new Date()): string {
  return isoToZoned(now.toISOString(), HOME_TZ).date
}

/** "Mon, Oct 6" for a "YYYY-MM-DD" calendar date (no zone shift). */
export function formatDay(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${ymd}T00:00:00Z`))
}

/** "Oct 6 – 9, 2026" style range for two "YYYY-MM-DD" dates. */
export function formatDateRange(start: string, end: string): string {
  const f = (ymd: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(new Date(`${ymd}T00:00:00Z`))
  if (start === end) return f(start, { month: "short", day: "numeric", year: "numeric" })
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  const sameMonth = sameYear && start.slice(5, 7) === end.slice(5, 7)
  if (sameMonth) return `${f(start, { month: "short", day: "numeric" })} – ${f(end, { day: "numeric" })}, ${start.slice(0, 4)}`
  if (sameYear)
    return `${f(start, { month: "short", day: "numeric" })} – ${f(end, { month: "short", day: "numeric" })}, ${start.slice(0, 4)}`
  return `${f(start, { month: "short", day: "numeric", year: "numeric" })} – ${f(end, { month: "short", day: "numeric", year: "numeric" })}`
}

/* ============================================================================
 * IMPORT — CRM meetings → planner items
 * ========================================================================== */

/**
 * "From CRM event" — turning CRM meetings into planner items. Pure, so the
 * preview (browser) and the create action (server) use the SAME rules and the
 * rules are unit-tested.
 *
 * READING A CRM MEETING TIME
 *   meetings.meeting_date has two encodings (see sql/03_views.sql,
 *   v_scheduler_meetings):
 *     - origin 'dynamics' (synced): the clock digits are the meeting's LOCAL
 *       wall-clock time tagged +00. A 10:00 meeting is stored 10:00:00+00.
 *       So we read the digits as UTC and place them on the day's zone.
 *     - origin 'dashboard' (created in the dashboard): a true instant
 *       (easternLocalToIso). We keep the instant and read its date in the
 *       day's zone.
 *   CRM meetings have no end time; the itinerary's default meeting length
 *   (45 min unless changed) supplies it.
 */


/** The CRM meeting columns the import reads. */
export type CrmMeetingRow = {
  meeting_id: string
  meeting_date: string | null
  origin: string | null
  meeting_status_label: string | null
  meeting_type_label: string | null
  is_in_person: boolean | null
  group_meeting: boolean | null
  hosted_in_hq: boolean | null
  institution_id: string | null
  institution_name: string | null
  investor_text: string | null
  city_name: string | null
  state_region_name: string | null
}

export type ImportStatus = "tentative" | "confirmed" | "cancelled"

/** One CRM meeting as it would land on the itinerary. */
export type PlannedMeeting = {
  crmMeetingId: string
  /** Day it lands on ("YYYY-MM-DD", in the day's zone), or null if no time. */
  date: string | null
  startIso: string | null
  endIso: string | null
  /** "HH:mm" on the day's clock — for the preview. */
  localTime: string | null
  title: string
  institutionName: string | null
  institutionCrmId: string | null
  /** Name of the ep_meeting_types row to use. */
  meetingTypeName: string
  status: ImportStatus
  city: string | null
  state: string | null
  atInvestorOffice: boolean
  investorText: string | null
  crmStatusLabel: string | null
  /** Ticked by default in the preview? (not cancelled, has a time, in range) */
  defaultSelected: boolean
  /** Why it can't be imported, if it can't. */
  problem: string | null
}

export function mapCrmStatus(label: string | null): ImportStatus {
  const l = (label ?? "").trim().toLowerCase()
  if (l === "confirmed") return "confirmed"
  if (l === "cancelled" || l === "canceled") return "cancelled"
  return "tentative" // Pending, TBR, blank
}

export function mapMeetingType(m: Pick<CrmMeetingRow, "group_meeting" | "meeting_type_label" | "is_in_person">): string {
  if (m.group_meeting) return "Group"
  if ((m.meeting_type_label ?? "").trim().toLowerCase() === "virtual" || m.is_in_person === false) return "Video"
  return "One-on-One"
}

/**
 * Where a CRM meeting starts, as an exact instant, given the zone of the day it
 * lands on. Returns null when the meeting has no time.
 */
export function crmMeetingStart(
  m: Pick<CrmMeetingRow, "meeting_date" | "origin">,
  tz: string = HOME_TZ,
): string | null {
  if (!m.meeting_date) return null
  const t = Date.parse(m.meeting_date)
  if (Number.isNaN(t)) return null
  if (m.origin === "dashboard") return new Date(t).toISOString()
  // Synced: the UTC digits ARE the local wall clock.
  const iso = new Date(t).toISOString()
  return zonedToIso(iso.slice(0, 10), iso.slice(11, 16), tz)
}

export function planCrmMeetings(
  rows: readonly CrmMeetingRow[],
  opts: { startDate: string; endDate: string; meetingMinutes: number; tz?: string },
): PlannedMeeting[] {
  const tz = opts.tz ?? HOME_TZ
  const out = rows.map((m): PlannedMeeting => {
    const startIso = crmMeetingStart(m, tz)
    const local = startIso ? isoToZoned(startIso, tz) : null
    const endIso = startIso ? new Date(Date.parse(startIso) + opts.meetingMinutes * 60_000).toISOString() : null
    const status = mapCrmStatus(m.meeting_status_label)
    const inRange = !!local && local.date >= opts.startDate && local.date <= opts.endDate
    const problem = !startIso ? "No meeting time in the CRM" : !inRange ? "Outside the itinerary dates" : null
    const institution = m.institution_name?.trim() || null
    const investors = m.investor_text?.trim() || null
    return {
      crmMeetingId: m.meeting_id,
      date: local?.date ?? null,
      startIso,
      endIso,
      localTime: local?.time ?? null,
      title: institution ?? investors ?? "Meeting",
      institutionName: institution,
      institutionCrmId: m.institution_id,
      meetingTypeName: mapMeetingType(m),
      status,
      city: m.city_name?.trim() || null,
      state: m.state_region_name?.trim() || null,
      atInvestorOffice: m.is_in_person === true && m.hosted_in_hq !== true,
      investorText: investors,
      crmStatusLabel: m.meeting_status_label,
      defaultSelected: problem == null && status !== "cancelled",
      problem,
    }
  })
  return out.sort((a, b) => (a.startIso ?? "9").localeCompare(b.startIso ?? "9"))
}

/**
 * The itinerary's starting date range for a CRM event: the event's own
 * meeting dates when it has them, else the span of its meetings, else today.
 * Both CRM event dates are read the same digits-as-local way as meetings.
 */
export function proposeDateRange(
  event: { event_start_actual: string | null; event_end_actual: string | null },
  meetings: readonly Pick<CrmMeetingRow, "meeting_date" | "origin">[],
  today: string,
): { startDate: string; endDate: string } {
  const day = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString().slice(0, 10) : null)
  let start = day(event.event_start_actual)
  let end = day(event.event_end_actual)
  if (!start || !end) {
    const dates = meetings
      .map((m) => crmMeetingStart(m))
      .filter((v): v is string => !!v)
      .map((iso) => isoToZoned(iso, HOME_TZ).date)
      .sort()
    start = start ?? dates[0] ?? end ?? today
    end = end ?? dates[dates.length - 1] ?? start
  }
  if (end < start) end = start
  return { startDate: start, endDate: end }
}

/** Longest itinerary the create flow accepts, in days. */
export const MAX_ITINERARY_DAYS = 31

/* ============================================================================
 * BUILDER — timeline layout, travel gaps, slots, ripple
 * ========================================================================== */

/** The kinds of block on a schedule. */
export const ITEM_TYPES = ["meeting", "travel", "hotel", "meal", "break", "hold", "presentation", "other"] as const
export type ItemType = (typeof ITEM_TYPES)[number]

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  meeting: "Meeting",
  travel: "Travel",
  hotel: "Hotel",
  meal: "Meal",
  break: "Break",
  hold: "Hold",
  presentation: "Presentation",
  other: "Other",
}

/** Default length of a new block, in minutes (meetings use the itinerary's setting). */
export const DEFAULT_ITEM_MINUTES: Record<ItemType, number> = {
  meeting: 45,
  travel: 30,
  hotel: 15,
  meal: 60,
  break: 15,
  hold: 60,
  presentation: 60,
  other: 30,
}

export const TRAVEL_MODES = ["car_service", "taxi_rideshare", "walk", "flight", "train", "other"] as const
export type TravelMode = (typeof TRAVEL_MODES)[number]
export const TRAVEL_MODE_LABEL: Record<TravelMode, string> = {
  car_service: "Car service",
  taxi_rideshare: "Taxi / rideshare",
  walk: "Walk",
  flight: "Flight",
  train: "Train",
  other: "Other",
}

/** Minutes from the start of `dayDate` (in `tz`) to `iso`. Can exceed 1440 / go negative. */
export function minutesIntoDay(iso: string, dayDate: string, tz: string): number {
  const midnight = zonedToIso(dayDate, "00:00", tz)
  if (!midnight) return 0
  return Math.round((Date.parse(iso) - Date.parse(midnight)) / 60_000)
}

/**
 * Side-by-side lanes for overlapping blocks. Items that overlap (directly or
 * through a chain) form a cluster; each gets the first free lane, and every
 * item in a cluster shares the cluster's lane count.
 */
export function layoutLanes(
  items: readonly { id: string; start: number; end: number }[],
): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const out = new Map<string, { lane: number; lanes: number }>()
  let cluster: { id: string; lane: number }[] = []
  let laneEnds: number[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    for (const c of cluster) out.set(c.id, { lane: c.lane, lanes: laneEnds.length })
    cluster = []
    laneEnds = []
  }
  for (const it of sorted) {
    const end = Math.max(it.end, it.start + 1)
    if (it.start >= clusterEnd) flush()
    let lane = laneEnds.findIndex((e) => e <= it.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(end)
    } else laneEnds[lane] = end
    cluster.push({ id: it.id, lane })
    clusterEnd = Math.max(clusterEnd === -Infinity ? end : clusterEnd, end)
  }
  flush()
  return out
}

/** The location fields the travel logic compares. */
export type LocatedItem = {
  id: string
  item_type: string
  status: string
  start_at: string
  end_at: string
  venue_name: string | null
  address_line1: string | null
  city: string | null
  video_url: string | null
  dial_in: string | null
}

/** A comparable key for where an item happens, or null if it has no place. */
export function locationKey(i: Pick<LocatedItem, "venue_name" | "address_line1" | "city">): string | null {
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ")
  const addr = norm(i.address_line1)
  if (addr) return `a:${addr}`
  const venue = norm(i.venue_name)
  if (venue) return `v:${venue}|${norm(i.city)}`
  return null
}

/** One-line description of where an item happens. */
export function locationLabel(i: Pick<LocatedItem, "venue_name" | "address_line1" | "city">): string | null {
  return [i.venue_name, i.address_line1, i.city].map((s) => s?.trim()).filter(Boolean).join(", ") || null
}

/**
 * Pairs of back-to-back items (cancelled ignored) at DIFFERENT known places with
 * no travel between them — where the builder offers "+ Add travel".
 */
export function travelGaps<T extends LocatedItem>(items: readonly T[]): { from: T; to: T }[] {
  const live = items
    .filter((i) => i.status !== "cancelled")
    .sort((a, b) => a.start_at.localeCompare(b.start_at) || a.end_at.localeCompare(b.end_at))
  const out: { from: T; to: T }[] = []
  for (let k = 0; k + 1 < live.length; k++) {
    const a = live[k]
    const b = live[k + 1]
    if (a.item_type === "travel" || b.item_type === "travel") continue
    const ka = locationKey(a)
    const kb = locationKey(b)
    if (ka && kb && ka !== kb) out.push({ from: a, to: b })
  }
  return out
}

/**
 * Start/end for a travel block filling the gap between two items: the whole
 * gap when there is one of at least 5 minutes, else 30 minutes from the end of
 * the first.
 */
export function travelSlot(fromEndIso: string, toStartIso: string): { startIso: string; endIso: string } {
  const a = Date.parse(fromEndIso)
  const b = Date.parse(toStartIso)
  if (b - a >= 5 * 60_000) return { startIso: new Date(a).toISOString(), endIso: new Date(b).toISOString() }
  return { startIso: new Date(a).toISOString(), endIso: new Date(a + 30 * 60_000).toISOString() }
}

/**
 * Where a new block goes: right after `after` when given, else after the last
 * block of the day, else 9:00 AM on the day's clock.
 */
export function nextFreeSlot(
  dayItems: readonly { start_at: string; end_at: string; status: string }[],
  dayDate: string,
  tz: string,
  minutes: number,
  after?: { end_at: string } | null,
): { startIso: string; endIso: string } {
  const live = dayItems.filter((i) => i.status !== "cancelled")
  const startMs = after
    ? Date.parse(after.end_at)
    : live.length
      ? Math.max(...live.map((i) => Date.parse(i.end_at)))
      : Date.parse(zonedToIso(dayDate, "09:00", tz)!)
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(startMs + minutes * 60_000).toISOString() }
}

/** Same clock time, new zone: 10:00 in Eastern → 10:00 in Central. */
export function keepWallClock(iso: string, fromTz: string, toTz: string): string {
  if (fromTz === toTz) return iso
  const { date, time } = isoToZoned(iso, fromTz)
  return zonedToIso(date, time, toTz) ?? iso
}

/** Shift an instant by whole minutes. */
export function shiftIso(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString()
}

/**
 * A block's start/end from "HH:mm" entries on its day. The start is on the
 * day's clock; the end is on `endTz` when given (a flight landing in another
 * zone), else the day's clock. If the end reads earlier than the start on a
 * single clock it is taken as the next day (an overnight flight / late dinner).
 */
export function resolveTimes(p: {
  dayDate: string
  dayTz: string
  startTime: string
  endTime: string
  endTz?: string | null
}): { ok: true; startIso: string; endIso: string } | { ok: false; error: string } {
  const startIso = zonedToIso(p.dayDate, p.startTime, p.dayTz)
  if (!startIso) return { ok: false, error: "Enter a start time." }
  const endTz = p.endTz || p.dayTz
  let endIso = zonedToIso(p.dayDate, p.endTime, endTz)
  if (!endIso) return { ok: false, error: "Enter an end time." }
  if (Date.parse(endIso) < Date.parse(startIso)) {
    const nextDay = new Date(Date.parse(`${p.dayDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    endIso = zonedToIso(nextDay, p.endTime, endTz)!
    if (Date.parse(endIso) - Date.parse(startIso) > 16 * 3_600_000)
      return { ok: false, error: "The end time is before the start time." }
  }
  return { ok: true, startIso, endIso }
}

/* ============================================================================
 * AVAILABILITY BLOCKS — capacity + slotting (one source of truth for the
 * timeline readout and the health checks)
 * ========================================================================== */

export type BlockLike = {
  id: string
  day_id: string
  start_at: string
  end_at: string
  default_slot_minutes: number
  default_buffer_minutes: number
  block_type: string
  label: string | null
  host_institution_name: string | null
}

export type ScheduledLike = {
  id: string
  day_id: string
  item_type: string
  status: string
  start_at: string
  end_at: string
  availability_block_id?: string | null
}

const ms = (iso: string) => Date.parse(iso)
const mins = (a: number, b: number) => Math.round((b - a) / 60_000)

/** A block's name for messages: its label, else its host, else "Open block". */
export function blockName(b: Pick<BlockLike, "label" | "host_institution_name">): string {
  return b.label?.trim() || b.host_institution_name?.trim() || "Open block"
}

/**
 * The meetings counted against a block: those booked into it, plus any meeting
 * (not cancelled, not booked into another block) whose time falls inside it.
 */
export function blockMeetings<T extends ScheduledLike>(block: BlockLike, items: readonly T[]): T[] {
  const s = ms(block.start_at)
  const e = ms(block.end_at)
  return items
    .filter(
      (i) =>
        i.item_type === "meeting" &&
        i.status !== "cancelled" &&
        (i.availability_block_id === block.id ||
          (!i.availability_block_id && i.day_id === block.day_id && ms(i.start_at) >= s && ms(i.end_at) <= e)),
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
}

export type BlockCapacity = {
  blockMinutes: number
  /** floor(block / (slot + buffer)). */
  capacity: number
  bookedCount: number
  /** Meeting minutes inside the window. */
  bookedMinutes: number
  /** Window minus booked minutes minus a buffer per booked meeting. */
  freeMinutes: number
  /** floor(free / (slot + buffer)). */
  remainingSlots: number
  /** Meetings plus the buffers between them exceed the window. */
  overCapacity: boolean
}

export function blockCapacity(block: BlockLike, items: readonly ScheduledLike[]): BlockCapacity {
  const s = ms(block.start_at)
  const e = ms(block.end_at)
  const blockMinutes = Math.max(0, mins(s, e))
  const step = Math.max(1, block.default_slot_minutes + block.default_buffer_minutes)
  const booked = blockMeetings(block, items)
  const bookedMinutes = booked.reduce(
    (sum, i) => sum + Math.max(0, mins(Math.max(s, ms(i.start_at)), Math.min(e, ms(i.end_at)))),
    0,
  )
  const needed =
    booked.reduce((sum, i) => sum + Math.max(0, mins(ms(i.start_at), ms(i.end_at))), 0) +
    block.default_buffer_minutes * Math.max(0, booked.length - 1)
  const freeMinutes = Math.max(0, blockMinutes - bookedMinutes - block.default_buffer_minutes * booked.length)
  return {
    blockMinutes,
    capacity: Math.floor(blockMinutes / step),
    bookedCount: booked.length,
    bookedMinutes,
    freeMinutes,
    remainingSlots: Math.floor(freeMinutes / step),
    overCapacity: needed > blockMinutes,
  }
}

/** "Booked 2 · ~4 slots open · 90 min free" */
export function capacityText(c: BlockCapacity): string {
  return `Booked ${c.bookedCount} · ~${c.remainingSlots} slot${c.remainingSlots === 1 ? "" : "s"} open · ${c.freeMinutes} min free`
}

/**
 * The next free slot in a block: the earliest start, from the block's start,
 * where a `slotMinutes` meeting fits with the block's buffer clear of every
 * other block on the day (not only the block's own meetings, so a booking never
 * lands on top of something else). Null when the block is full.
 */
export function nextSlotInBlock(
  block: BlockLike,
  dayItems: readonly ScheduledLike[],
  slotMinutes: number = block.default_slot_minutes,
): { startIso: string; endIso: string } | null {
  const s = ms(block.start_at)
  const e = ms(block.end_at)
  const slot = slotMinutes * 60_000
  const buf = block.default_buffer_minutes * 60_000
  const busy = dayItems
    .filter((i) => i.status !== "cancelled" && i.item_type !== "hotel" && ms(i.end_at) > s && ms(i.start_at) < e)
    .map((i) => [ms(i.start_at), ms(i.end_at)] as const)
    .sort((a, b) => a[0] - b[0])
  // A slot clashes with a busy interval unless a full buffer separates them on
  // both sides. Step past each clash until nothing moves.
  let t = s
  let moved = true
  while (moved) {
    moved = false
    for (const [bs, be] of busy) {
      if (t < be + buf && t + slot + buf > bs) {
        t = be + buf
        moved = true
      }
    }
  }
  if (t + slot > e) return null
  return { startIso: new Date(t).toISOString(), endIso: new Date(t + slot).toISOString() }
}

/* ============================================================================
 * SCHEDULE HEALTH — every check, pure, so the builder (live, on every edit)
 * and Finalise (on the server) always agree
 * ========================================================================== */

export type IssueSeverity = "error" | "warning" | "info"

export type Issue = {
  severity: IssueSeverity
  code: string
  message: string
  itemId?: string
  blockId?: string
  dayId?: string
}

export type HealthItem = ScheduledLike &
  LocatedItem & {
    title: string
    timezone: string
    send_invite: boolean
    attendee_ids: readonly string[]
    travel: { mode: string; buffer_minutes: number } | null
  }

export type HealthInput = {
  days: readonly { id: string; date: string; timezone: string; city: string | null }[]
  items: readonly HealthItem[]
  attendees: readonly { id: string; full_name: string; email: string | null; side: string; role: string }[]
  blocks: readonly BlockLike[]
  /** "Be at the airport" lead before a flight. */
  airportLeadMinutes: number
  /** Our attendee is in another itinerary's item at the same time (computed on the server). */
  crossBookings?: readonly { attendeeId: string; itemId: string; otherTitle: string; otherItinerary: string }[]
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 }

export function checkSchedule(input: HealthInput): Issue[] {
  const out: Issue[] = []
  const live = input.items.filter((i) => i.status !== "cancelled")
  const dayById = new Map(input.days.map((d) => [d.id, d]))
  const att = new Map(input.attendees.map((a) => [a.id, a]))
  const q = (s: string) => `“${s}”`

  // ---- times ----
  for (const i of live) {
    if (ms(i.end_at) < ms(i.start_at)) {
      out.push({ severity: "error", code: "end_before_start", message: `${q(i.title)} ends before it starts.`, itemId: i.id, dayId: i.day_id })
      continue
    }
    const day = dayById.get(i.day_id)
    if (day && isoToZoned(i.start_at, day.timezone).date !== day.date)
      out.push({
        severity: "error",
        code: "outside_day",
        message: `${q(i.title)} starts on a different date from its day (${formatDay(day.date)}).`,
        itemId: i.id,
        dayId: i.day_id,
      })
  }

  // ---- one person, two places at once ----
  for (const a of input.attendees) {
    const mine = live.filter((i) => i.attendee_ids.includes(a.id)).sort((x, y) => x.start_at.localeCompare(y.start_at))
    let latest: (typeof mine)[number] | null = null
    for (const cur of mine) {
      if (latest && ms(cur.start_at) < ms(latest.end_at))
        out.push({
          severity: "error",
          code: "attendee_overlap",
          message: `${a.full_name} is in ${q(latest.title)} and ${q(cur.title)} at the same time (${formatTime(cur.start_at, cur.timezone)}).`,
          itemId: cur.id,
          dayId: cur.day_id,
        })
      if (!latest || ms(cur.end_at) > ms(latest.end_at)) latest = cur
    }
  }

  // ---- getting between places ----
  for (const day of input.days) {
    const seq = live.filter((i) => i.day_id === day.id).sort((x, y) => x.start_at.localeCompare(y.start_at))
    const stops = seq.filter((i) => i.item_type !== "travel" && i.item_type !== "hotel")
    for (let k = 1; k < stops.length; k++) {
      const a = stops[k - 1]
      const b = stops[k]
      const ka = locationKey(a)
      const kb = locationKey(b)
      if (!ka || !kb || ka === kb) continue
      const legs = seq.filter(
        (x) => x.item_type === "travel" && ms(x.start_at) >= ms(a.start_at) && ms(x.start_at) < ms(b.start_at),
      )
      const gap = mins(ms(a.end_at), ms(b.start_at))
      if (!legs.length) {
        out.push({
          severity: "warning",
          code: "no_travel",
          message: `No travel between ${q(a.title)} and ${q(b.title)} — different places, ${gap} min apart.`,
          itemId: b.id,
          dayId: day.id,
        })
        continue
      }
      const last = legs[legs.length - 1]
      const buffer = last.travel?.buffer_minutes ?? 0
      if (ms(legs[0].start_at) < ms(a.end_at) || ms(last.end_at) + buffer * 60_000 > ms(b.start_at))
        out.push({
          severity: "warning",
          code: "tight_travel",
          message: `Too tight from ${q(a.title)} to ${q(b.title)}: ${mins(ms(legs[0].start_at), ms(last.end_at))} min travel + ${buffer} min buffer in a ${gap} min gap.`,
          itemId: last.id,
          dayId: day.id,
        })
    }
    // Flights: be at the airport early.
    for (const f of seq.filter((x) => x.item_type === "travel" && x.travel?.mode === "flight")) {
      const before = seq.filter(
        (x) => x.id !== f.id && x.item_type !== "hotel" && x.item_type !== "travel" && ms(x.start_at) < ms(f.start_at),
      )
      const prev = before[before.length - 1]
      if (prev && ms(prev.end_at) > ms(f.start_at) - input.airportLeadMinutes * 60_000)
        out.push({
          severity: "warning",
          code: "airport_lead",
          message: `${q(prev.title)} ends ${mins(ms(prev.end_at), ms(f.start_at))} min before ${q(f.title)} departs — the airport lead time is ${input.airportLeadMinutes} min.`,
          itemId: f.id,
          dayId: day.id,
        })
    }
  }

  // ---- meetings ----
  for (const i of live.filter((x) => x.item_type === "meeting")) {
    if (!locationKey(i) && !i.city?.trim() && !i.video_url?.trim() && !i.dial_in?.trim())
      out.push({ severity: "warning", code: "no_location", message: `${q(i.title)} has no location, video link or dial-in.`, itemId: i.id, dayId: i.day_id })
    if (!i.attendee_ids.some((id) => att.get(id)?.side === "external"))
      out.push({ severity: "warning", code: "no_investor", message: `${q(i.title)} has no investor-side attendee.`, itemId: i.id, dayId: i.day_id })
  }

  // ---- invites with no email (one line per person) ----
  for (const a of input.attendees) {
    if (a.email?.trim()) continue
    const theirs = live.filter((i) => i.send_invite && i.attendee_ids.includes(a.id))
    if (theirs.length)
      out.push({
        severity: "warning",
        code: "no_email",
        message: `${a.full_name} has no email but is on ${theirs.length} item${theirs.length === 1 ? "" : "s"} that send invites.`,
        itemId: theirs[0].id,
        dayId: theirs[0].day_id,
      })
  }

  // ---- booked in another itinerary at the same time ----
  for (const c of input.crossBookings ?? []) {
    const a = att.get(c.attendeeId)
    const i = live.find((x) => x.id === c.itemId)
    if (!a || !i) continue
    out.push({
      severity: "warning",
      code: "double_booked",
      message: `${a.full_name} is also booked in ${q(c.otherTitle)} (${c.otherItinerary}) during ${q(i.title)}.`,
      itemId: i.id,
      dayId: i.day_id,
    })
  }

  // ---- availability blocks ----
  for (const day of input.days) {
    const blocks = input.blocks.filter((b) => b.day_id === day.id)
    if (!blocks.length) continue
    for (const m of live.filter((i) => i.day_id === day.id && i.item_type === "meeting")) {
      const inside = blocks.some((b) => ms(m.start_at) >= ms(b.start_at) && ms(m.end_at) <= ms(b.end_at))
      if (inside) continue
      const linked = blocks.find((b) => b.id === m.availability_block_id)
      out.push({
        severity: "warning",
        code: "outside_block",
        message: linked
          ? `${q(m.title)} is booked into ${blockName(linked)} but runs outside it.`
          : `${q(m.title)} falls outside every availability block on ${formatDay(day.date)}.`,
        itemId: m.id,
        dayId: day.id,
      })
    }
    for (const b of blocks) {
      const c = blockCapacity(b, live)
      if (c.overCapacity)
        out.push({
          severity: b.block_type === "hard" ? "error" : "warning",
          code: "block_over_capacity",
          message: `${blockName(b)} is over capacity: ${c.bookedCount} meetings plus buffers don't fit in ${c.blockMinutes} min.`,
          blockId: b.id,
          dayId: day.id,
        })
      else if (c.capacity > 0 && c.bookedCount < c.capacity / 2)
        out.push({
          severity: "info",
          code: "block_underused",
          message: `${blockName(b)} has only ${c.bookedCount} of ~${c.capacity} slots filled.`,
          blockId: b.id,
          dayId: day.id,
        })
    }
  }

  // ---- long or packed days ----
  for (const day of input.days) {
    const its = live.filter((i) => i.day_id === day.id && i.item_type !== "hotel")
    if (!its.length) continue
    const first = its.reduce((a, b) => (a.start_at < b.start_at ? a : b))
    const last = its.reduce((a, b) => (a.end_at > b.end_at ? a : b))
    if (minutesIntoDay(first.start_at, day.date, day.timezone) < 7 * 60)
      out.push({ severity: "info", code: "early_start", message: `${formatDay(day.date)} starts at ${formatTime(first.start_at, day.timezone)}, before 7:00 AM.`, itemId: first.id, dayId: day.id })
    if (minutesIntoDay(last.end_at, day.date, day.timezone) > 22 * 60)
      out.push({ severity: "info", code: "late_end", message: `${formatDay(day.date)} ends at ${formatTime(last.end_at, day.timezone)}, after 10:00 PM.`, itemId: last.id, dayId: day.id })
    const n = its.filter((i) => i.item_type === "meeting").length
    if (n > 8) out.push({ severity: "info", code: "many_meetings", message: `${formatDay(day.date)} has ${n} meetings.`, dayId: day.id })
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

/** "2 errors · 3 warnings · 1 note" */
export function healthSummary(issues: readonly Issue[]): string {
  const count = (s: IssueSeverity) => issues.filter((i) => i.severity === s).length
  const parts: string[] = []
  const e = count("error")
  const w = count("warning")
  const n = count("info")
  if (e) parts.push(`${e} error${e === 1 ? "" : "s"}`)
  if (w) parts.push(`${w} warning${w === 1 ? "" : "s"}`)
  if (n) parts.push(`${n} note${n === 1 ? "" : "s"}`)
  return parts.length ? parts.join(" · ") : "No issues"
}

/** The default buffer for a travel leg of `mode`, from the itinerary's settings. */
export function defaultBufferFor(
  mode: string,
  s: { buffer_car_minutes: number; buffer_walk_minutes: number; airport_lead_minutes: number },
): number {
  if (mode === "walk" || mode === "train") return s.buffer_walk_minutes
  if (mode === "flight") return s.airport_lead_minutes
  return s.buffer_car_minutes
}

/* ============================================================================
 * PDF MODEL — the ONLY place that decides what goes into a PDF.
 *
 * The renderer (lib/events-planner/pdf/) draws whatever this returns and reads
 * nothing else, so the audience rules are enforced here, in one pure function,
 * and unit-tested:
 *   - client / single-attendee: NO internal notes (itinerary, item or block),
 *     NO availability blocks or open capacity, confirmation numbers only when
 *     the export toggle is on AND the leg is marked to print it;
 *   - single-attendee: only that person's items;
 *   - Rose internal: everything, internal notes on a separate final page,
 *     availability blocks only with "Show open availability".
 * Items marked "not in PDF" never appear; cancelled ones only when asked.
 * ========================================================================== */

export type PdfAudience = "client" | "internal" | "attendee"

export type PdfOptions = {
  audience: PdfAudience
  /** Required when audience = "attendee". */
  attendeeId?: string | null
  includeCancelled: boolean
  includeConfirmations: boolean
  includeAppendix: boolean
  /** Rose internal only: show availability blocks with their open capacity. */
  showAvailability: boolean
}

export type PdfSource = {
  title: string
  subtitle: string | null
  client_name: string | null
  start_date: string
  end_date: string
  status: string
  version: number
  confidential: boolean
  internal_notes: string | null
  client_notes: string | null
  days: readonly { id: string; date: string; city: string | null; timezone: string; day_title: string | null; day_notes: string | null }[]
  items: readonly (HealthItem & {
    include_in_pdf: boolean
    institution_name: string | null
    meeting_type_id: string | null
    room_or_floor: string | null
    address_line2: string | null
    state: string | null
    dial_in_passcode: string | null
    notes_internal: string | null
    notes_external: string | null
    travel:
      | (HealthItem["travel"] & {
          mode: string
          to_timezone: string | null
          transport_company: string | null
          driver_name: string | null
          driver_phone: string | null
          vehicle_type: string | null
          pickup_instructions: string | null
          carrier: string | null
          flight_or_train_number: string | null
          depart_terminal: string | null
          arrive_terminal: string | null
          confirmation_number: string | null
          print_confirmation_number: boolean
          from_label: string | null
          to_label: string | null
        })
      | null
    hotel: {
      hotel_name: string | null
      address: string | null
      phone: string | null
      check_in_at: string | null
      check_out_at: string | null
      confirmation_number: string | null
    } | null
  })[]
  attendees: readonly {
    id: string
    crm_contact_id: string | null
    full_name: string
    email: string | null
    phone: string | null
    title: string | null
    company: string | null
    role: string
    side: string
    receives_full_itinerary: boolean
  }[]
  blocks: readonly (BlockLike & { timezone: string; notes_internal: string | null })[]
  meetingTypes: readonly { id: string; name: string }[]
}

export type PdfPerson = { name: string; title: string | null; company: string | null }

export type PdfRow = {
  kind: "meeting" | "travel" | "stay" | "other" | "block"
  /** Start instant — for ordering only. */
  at: string
  time: string
  /** Eastern time alongside, when the day's clock differs. */
  timeEt: string | null
  title: string
  subtitle: string | null
  location: string | null
  people: PdfPerson[]
  detail: string | null
  notes: string | null
  tentative: boolean
  cancelled: boolean
}

export type PdfDay = {
  label: string
  dateLong: string
  city: string | null
  zoneLabel: string
  notes: string | null
  rows: PdfRow[]
}

export type PdfModel = {
  audience: PdfAudience
  audienceLabel: string
  title: string
  subtitle: string | null
  clientName: string | null
  dateRange: string
  cities: string[]
  confidential: boolean
  draft: boolean
  version: number
  generatedOn: string
  clientNotes: string | null
  days: PdfDay[]
  glance: {
    days: { date: string; city: string | null; first: string | null; last: string | null; meetings: number }[]
    totals: { meetings: number; institutions: number; cities: number }
    party: PdfPerson[]
    hotels: { night: string; name: string; address: string | null; phone: string | null; confirmation: string | null }[]
  }
  logistics: {
    cars: { company: string | null; driver: string | null; phone: string | null; when: string }[]
    hotels: { name: string; phone: string | null; address: string | null }[]
    rose: { name: string; phone: string | null; email: string | null }[]
    clientAssistants: { name: string; title: string | null; phone: string | null; email: string | null }[]
  }
  appendix: { institution: string; people: PdfPerson[] }[] | null
  /** Rose internal only — printed on a final page marked "Internal — do not distribute". */
  internal: { itineraryNotes: string | null; notes: { when: string; title: string; note: string }[] } | null
}

const ZONE_LONG: Record<string, string> = {
  "America/New_York": "Eastern Time",
  "America/Toronto": "Eastern Time",
  "America/Chicago": "Central Time",
  "America/Denver": "Mountain Time",
  "America/Phoenix": "Mountain Time (Arizona)",
  "America/Los_Angeles": "Pacific Time",
  "Europe/London": "UK Time",
  "Europe/Paris": "Central European Time",
  "Europe/Zurich": "Central European Time",
}

function longDate(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(
    new Date(`${ymd}T00:00:00Z`),
  )
}

const clean = (s: string | null | undefined) => (s ?? "").trim() || null

export function buildPdfModel(src: PdfSource, opts: PdfOptions, now: Date = new Date()): PdfModel {
  const internal = opts.audience === "internal"
  const who = opts.audience === "attendee" ? src.attendees.find((a) => a.id === opts.attendeeId) ?? null : null
  const attById = new Map(src.attendees.map((a) => [a.id, a]))
  const mtName = (id: string | null) => src.meetingTypes.find((m) => m.id === id)?.name ?? null
  const person = (a: (typeof src.attendees)[number]): PdfPerson => ({ name: a.full_name, title: clean(a.title), company: clean(a.company) })
  const confirmationFor = (conf: string | null, printFlag: boolean) =>
    opts.includeConfirmations && (internal || printFlag) ? clean(conf) : null

  const items = src.items
    .filter((i) => i.include_in_pdf)
    .filter((i) => opts.includeCancelled || i.status !== "cancelled")
    .filter((i) => !who || i.attendee_ids.includes(who.id))
    .sort((a, b) => a.start_at.localeCompare(b.start_at))

  const days: PdfDay[] = src.days
    .map((d, idx) => {
      const tz = d.timezone
      const showEt = tz !== HOME_TZ
      const rows: PdfRow[] = items
        .filter((i) => i.day_id === d.id)
        .map((i): PdfRow => {
          const arrTz = i.travel?.to_timezone && i.travel.to_timezone !== i.timezone ? i.travel.to_timezone : null
          const time = arrTz
            ? `${formatTime(i.start_at, i.timezone)} ${zoneAbbrev(i.start_at, i.timezone)} – ${formatTime(i.end_at, arrTz)} ${zoneAbbrev(i.end_at, arrTz)}`
            : `${formatTime(i.start_at, i.timezone)} – ${formatTime(i.end_at, i.timezone)}`
          const timeEt = showEt && differsFromHome(i.start_at, i.timezone) ? `${formatTime(i.start_at, HOME_TZ)} ET` : null
          const people = i.attendee_ids.map((id) => attById.get(id)).filter((a): a is NonNullable<typeof a> => !!a)
          const loc = [clean(i.venue_name), clean(i.room_or_floor), clean(i.address_line1), clean(i.address_line2), clean(i.city)]
            .filter(Boolean)
            .join(", ")
          const virtual = [clean(i.video_url), clean(i.dial_in) ? `Dial-in ${i.dial_in}${i.dial_in_passcode ? ` · ${i.dial_in_passcode}` : ""}` : null]
            .filter(Boolean)
            .join(" · ")
          const base = {
            at: i.start_at,
            time,
            timeEt,
            tentative: i.status === "tentative",
            cancelled: i.status === "cancelled",
            notes: clean(i.notes_external),
          }
          if (i.item_type === "meeting" || i.item_type === "presentation") {
            return {
              ...base,
              kind: "meeting",
              title: i.title,
              subtitle: [clean(i.institution_name) !== i.title ? clean(i.institution_name) : null, mtName(i.meeting_type_id)].filter(Boolean).join(" · ") || null,
              location: [loc, virtual].filter(Boolean).join(" · ") || null,
              people: people.filter((a) => a.side === "external").map(person),
              detail: null,
            }
          }
          if (i.item_type === "travel") {
            const t = i.travel
            const mins = Math.round((Date.parse(i.end_at) - Date.parse(i.start_at)) / 60_000)
            const mode = t ? (TRAVEL_MODE_LABEL as Record<string, string>)[t.mode] ?? "Travel" : "Travel"
            const detail = [
              `${mode} · ${mins} min`,
              t?.carrier || t?.flight_or_train_number ? [t?.carrier, t?.flight_or_train_number].filter(Boolean).join(" ") : null,
              t?.depart_terminal ? `Departs ${t.depart_terminal}` : null,
              t?.arrive_terminal ? `Arrives ${t.arrive_terminal}` : null,
              t?.transport_company ?? null,
              t?.driver_name ? `Driver ${t.driver_name}${t.driver_phone ? ` ${t.driver_phone}` : ""}` : null,
              t?.vehicle_type ?? null,
              t?.pickup_instructions ? `Pickup: ${t.pickup_instructions}` : null,
              t ? (confirmationFor(t.confirmation_number, t.print_confirmation_number) ? `Conf. ${t.confirmation_number}` : null) : null,
            ]
              .filter(Boolean)
              .join(" · ")
            return {
              ...base,
              kind: "travel",
              title: i.title,
              subtitle: t?.from_label || t?.to_label ? [t?.from_label, t?.to_label].filter(Boolean).join(" to ") : null,
              location: null,
              people: [],
              detail,
            }
          }
          if (i.item_type === "hotel" || i.item_type === "meal" || i.item_type === "break") {
            const h = i.hotel
            return {
              ...base,
              kind: "stay",
              title: h?.hotel_name ? `${i.title} — ${h.hotel_name}` : i.title,
              subtitle: null,
              location: clean(h?.address) ?? (loc || null),
              people: [],
              detail: [h?.phone ? `Tel ${h.phone}` : null, h ? (confirmationFor(h.confirmation_number, true) ? `Conf. ${h.confirmation_number}` : null) : null]
                .filter(Boolean)
                .join(" · ") || null,
            }
          }
          return { ...base, kind: "other", title: i.title, subtitle: null, location: [loc, virtual].filter(Boolean).join(" · ") || null, people: [], detail: null }
        })

      // Availability: Rose internal + "Show open availability" only.
      if (internal && opts.showAvailability) {
        for (const b of src.blocks.filter((x) => x.day_id === d.id)) {
          const c = blockCapacity(b, src.items)
          rows.push({
            kind: "block",
            at: b.start_at,
            time: `${formatTime(b.start_at, b.timezone)} – ${formatTime(b.end_at, b.timezone)}`,
            timeEt: showEt ? `${formatTime(b.start_at, HOME_TZ)} ET` : null,
            title: `Open availability — ${blockName(b)}`,
            subtitle: b.block_type === "hard" ? "Hard block" : "Soft block",
            location: null,
            people: [],
            detail: capacityText(c),
            notes: null,
            tentative: false,
            cancelled: false,
          })
        }
        rows.sort((a, b) => a.at.localeCompare(b.at))
      }

      return {
        label: `DAY ${idx + 1}`,
        dateLong: longDate(d.date),
        city: clean(d.day_title) ?? clean(d.city),
        zoneLabel: ZONE_LONG[tz] ?? tz,
        notes: clean(d.day_notes),
        rows,
      }
    })
    .filter((d) => d.rows.length > 0 || !who)

  const liveMeetings = items.filter((i) => i.item_type === "meeting" && i.status !== "cancelled")
  const cities = [...new Set(src.days.map((d) => clean(d.city)).filter((c): c is string => !!c))]
  const hotelItems = items.filter((i) => i.item_type === "hotel")

  const party = src.attendees.filter((a) => a.receives_full_itinerary && (a.side === "client" || a.side === "internal")).map(person)

  const appendix =
    opts.includeAppendix
      ? Object.entries(
          liveMeetings.reduce<Record<string, PdfPerson[]>>((acc, m) => {
            const inst = clean(m.institution_name) ?? m.title
            const people = m.attendee_ids
              .map((id) => attById.get(id))
              .filter((a): a is NonNullable<typeof a> => !!a && a.side === "external" && !!a.crm_contact_id)
              .map(person)
            acc[inst] = [...(acc[inst] ?? []), ...people.filter((p) => !(acc[inst] ?? []).some((x) => x.name === p.name))]
            return acc
          }, {}),
        )
          .filter(([, people]) => people.length)
          .map(([institution, people]) => ({ institution, people }))
          .sort((a, b) => a.institution.localeCompare(b.institution))
      : null

  const audienceLabel = internal ? "Rose internal" : who ? `For ${who.full_name}` : "Client itinerary"

  return {
    audience: opts.audience,
    audienceLabel,
    title: src.title,
    subtitle: clean(src.subtitle),
    clientName: clean(src.client_name),
    dateRange: formatDateRange(src.start_date, src.end_date),
    cities,
    confidential: src.confidential,
    draft: src.status !== "finalized" && src.status !== "invites_sent",
    version: src.version,
    generatedOn: new Intl.DateTimeFormat("en-US", { timeZone: HOME_TZ, month: "long", day: "numeric", year: "numeric" }).format(now),
    clientNotes: clean(src.client_notes),
    days,
    glance: {
      days: src.days
        .map((d) => {
          const its = items.filter((i) => i.day_id === d.id && i.status !== "cancelled" && i.item_type !== "hotel")
          return {
            date: formatDay(d.date),
            city: clean(d.city),
            first: its.length ? formatTime(its[0].start_at, its[0].timezone) : null,
            last: its.length ? formatTime(its[its.length - 1].end_at, its[its.length - 1].timezone) : null,
            meetings: its.filter((i) => i.item_type === "meeting").length,
          }
        })
        .filter((d) => !who || d.meetings > 0 || d.first),
      totals: {
        meetings: liveMeetings.length,
        institutions: new Set(liveMeetings.map((m) => clean(m.institution_name) ?? m.title)).size,
        cities: cities.length,
      },
      party,
      hotels: hotelItems.map((h) => ({
        night: formatDay(isoToZoned(h.start_at, h.timezone).date),
        name: clean(h.hotel?.hotel_name) ?? h.title,
        address: clean(h.hotel?.address),
        phone: clean(h.hotel?.phone),
        confirmation: h.hotel ? confirmationFor(h.hotel.confirmation_number, true) : null,
      })),
    },
    logistics: {
      cars: items
        .filter((i) => i.item_type === "travel" && i.travel && (i.travel.transport_company || i.travel.driver_name))
        .map((i) => ({
          company: clean(i.travel!.transport_company),
          driver: clean(i.travel!.driver_name),
          phone: clean(i.travel!.driver_phone),
          when: `${formatDay(isoToZoned(i.start_at, i.timezone).date)} ${formatTime(i.start_at, i.timezone)}`,
        })),
      hotels: hotelItems
        .filter((h) => h.hotel?.hotel_name)
        .map((h) => ({ name: h.hotel!.hotel_name!, phone: clean(h.hotel!.phone), address: clean(h.hotel!.address) }))
        .filter((h, k, all) => all.findIndex((x) => x.name === h.name) === k),
      rose: src.attendees.filter((a) => a.side === "internal").map((a) => ({ name: a.full_name, phone: clean(a.phone), email: clean(a.email) })),
      clientAssistants: src.attendees
        .filter((a) => a.side === "client" && /assistant|\bea\b|executive assistant|office manager/i.test(a.title ?? ""))
        .map((a) => ({ name: a.full_name, title: clean(a.title), phone: clean(a.phone), email: clean(a.email) })),
    },
    appendix,
    internal: internal
      ? {
          itineraryNotes: clean(src.internal_notes),
          notes: [
            ...items
              .filter((i) => clean(i.notes_internal))
              .map((i) => ({
                when: `${formatDay(isoToZoned(i.start_at, i.timezone).date)} ${formatTime(i.start_at, i.timezone)}`,
                title: i.title,
                note: i.notes_internal!.trim(),
              })),
            ...src.blocks
              .filter((b) => clean(b.notes_internal))
              .map((b) => ({
                when: `${formatDay(isoToZoned(b.start_at, b.timezone).date)} ${formatTime(b.start_at, b.timezone)}`,
                title: `Block: ${blockName(b)}`,
                note: b.notes_internal!.trim(),
              })),
          ],
        }
      : null,
  }
}

/* ============================================================================
 * CALENDAR INVITES — RFC 5545 iCalendar + who gets what.
 *
 * One VEVENT per item per recipient (each person gets their own copy, so no
 * one sees another recipient's email address). UID is stable for the life of
 * the item (ep-{itemId}@roseandco.com); SEQUENCE comes from ep_invites and goes
 * up on every update / cancellation. DTSTART/DTEND carry the day's TZID with a
 * matching VTIMEZONE, so Outlook shows each person the meeting in their own
 * zone. NEVER included: internal notes, confirmation numbers.
 * ========================================================================== */

export const INVITE_ORGANIZER = { name: "Rose & Company", email: "dashboards@roseandco.com" }
export const ROSE_DOMAIN = "roseandco.com"

type ZoneRule = { offset: string; name: string; month: number; byday: string; time: string }
type ZoneDef = { std: { offset: string; name: string }; dst?: { from: ZoneRule; to: ZoneRule } }

/** VTIMEZONE rules for the zones the planner offers (TIMEZONE_OPTIONS). */
const ZONES: Record<string, ZoneDef> = (() => {
  const us = (std: string, stdName: string, dst: string, dstName: string): ZoneDef => ({
    std: { offset: std, name: stdName },
    dst: {
      from: { offset: dst, name: dstName, month: 3, byday: "2SU", time: "020000" },
      to: { offset: std, name: stdName, month: 11, byday: "1SU", time: "020000" },
    },
  })
  const eu = (std: string, stdName: string, dst: string, dstName: string, startT: string, endT: string): ZoneDef => ({
    std: { offset: std, name: stdName },
    dst: {
      from: { offset: dst, name: dstName, month: 3, byday: "-1SU", time: startT },
      to: { offset: std, name: stdName, month: 10, byday: "-1SU", time: endT },
    },
  })
  return {
    "America/New_York": us("-0500", "EST", "-0400", "EDT"),
    "America/Toronto": us("-0500", "EST", "-0400", "EDT"),
    "America/Chicago": us("-0600", "CST", "-0500", "CDT"),
    "America/Denver": us("-0700", "MST", "-0600", "MDT"),
    "America/Los_Angeles": us("-0800", "PST", "-0700", "PDT"),
    "America/Phoenix": { std: { offset: "-0700", name: "MST" } },
    "Europe/London": eu("+0000", "GMT", "+0100", "BST", "010000", "020000"),
    "Europe/Paris": eu("+0100", "CET", "+0200", "CEST", "020000", "030000"),
    "Europe/Zurich": eu("+0100", "CET", "+0200", "CEST", "020000", "030000"),
    "Asia/Dubai": { std: { offset: "+0400", name: "+04" } },
    "Asia/Singapore": { std: { offset: "+0800", name: "+08" } },
    "Asia/Hong_Kong": { std: { offset: "+0800", name: "HKT" } },
    "Asia/Tokyo": { std: { offset: "+0900", name: "JST" } },
    "Australia/Sydney": {
      std: { offset: "+1000", name: "AEST" },
      dst: {
        from: { offset: "+1100", name: "AEDT", month: 10, byday: "1SU", time: "020000" },
        to: { offset: "+1000", name: "AEST", month: 4, byday: "1SU", time: "030000" },
      },
    },
  }
})()

function vtimezone(tz: string): string[] {
  const z = ZONES[tz]
  if (!z) return []
  const pad = (n: number) => String(n).padStart(2, "0")
  // DTSTART dates in 1970 that fall on a matching Sunday are not required by
  // the RRULE; any date in the right month works for clients in practice.
  if (!z.dst)
    return [
      "BEGIN:VTIMEZONE",
      `TZID:${tz}`,
      "BEGIN:STANDARD",
      `TZOFFSETFROM:${z.std.offset}`,
      `TZOFFSETTO:${z.std.offset}`,
      `TZNAME:${z.std.name}`,
      "DTSTART:19700101T000000",
      "END:STANDARD",
      "END:VTIMEZONE",
    ]
  const { from, to } = z.dst
  return [
    "BEGIN:VTIMEZONE",
    `TZID:${tz}`,
    "BEGIN:DAYLIGHT",
    `TZOFFSETFROM:${to.offset}`,
    `TZOFFSETTO:${from.offset}`,
    `TZNAME:${from.name}`,
    `DTSTART:1970${pad(from.month)}01T${from.time}`,
    `RRULE:FREQ=YEARLY;BYMONTH=${from.month};BYDAY=${from.byday}`,
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    `TZOFFSETFROM:${from.offset}`,
    `TZOFFSETTO:${to.offset}`,
    `TZNAME:${to.name}`,
    `DTSTART:1970${pad(to.month)}01T${to.time}`,
    `RRULE:FREQ=YEARLY;BYMONTH=${to.month};BYDAY=${to.byday}`,
    "END:STANDARD",
    "END:VTIMEZONE",
  ]
}

/** RFC 5545 TEXT escaping. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")
}

/** Fold a content line at 75 octets (continuations start with a space). */
export function icsFold(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ""
  let bytes = 0
  for (const ch of line) {
    const b = enc.encode(ch).length
    const limit = out.length === 0 ? 75 : 74 // continuation lines lose one octet to the leading space
    if (bytes + b > limit) {
      out.push(cur)
      cur = ""
      bytes = 0
    }
    cur += ch
    bytes += b
  }
  out.push(cur)
  return out.join("\r\n ")
}

/** 20261006T090000 on `tz`'s clock (TZID form), or 20261006T130000Z when the zone is unknown. */
function icsTime(iso: string, tz: string): { param: string; value: string } {
  if (ZONES[tz]) {
    const { date, time } = isoToZoned(iso, tz)
    return { param: `;TZID=${tz}`, value: `${date.replace(/-/g, "")}T${time.replace(":", "")}00` }
  }
  return { param: "", value: new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "") }
}

/** djb2 → hex. Stable, dependency-free change detection for invite payloads. */
export function hashText(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, "0")
}

export type InviteItem = {
  id: string
  item_type: string
  status: string
  send_invite: boolean
  title: string
  start_at: string
  end_at: string
  timezone: string
  institution_name: string | null
  meeting_type_name: string | null
  venue_name: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  room_or_floor: string | null
  video_url: string | null
  dial_in: string | null
  dial_in_passcode: string | null
  notes_external: string | null
  attendee_ids: readonly string[]
  travel: {
    mode: string
    to_timezone: string | null
    driver_name: string | null
    driver_phone: string | null
    transport_company: string | null
    carrier: string | null
    flight_or_train_number: string | null
    pickup_instructions: string | null
  } | null
}

export type InviteAttendee = {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  title: string | null
  company: string | null
  side: string
  receives_full_itinerary: boolean
}

/** The content of one invite — everything that, if changed, needs an update. */
export type InvitePayload = {
  uid: string
  summary: string
  location: string
  description: string
  start: { param: string; value: string }
  end: { param: string; value: string }
  zones: string[]
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED"
  hash: string
}

export function invitePayload(
  item: InviteItem,
  attendees: readonly InviteAttendee[],
  clientName: string | null,
): InvitePayload {
  const t = (s: string | null | undefined) => (s ?? "").trim()
  const people = item.attendee_ids.map((id) => attendees.find((a) => a.id === id)).filter((a): a is InviteAttendee => !!a)
  const isMeeting = item.item_type === "meeting" || item.item_type === "presentation"
  const counterpart = t(item.institution_name) || item.title
  const summary = isMeeting
    ? [clientName ? `${clientName} × ${counterpart}` : counterpart, t(item.meeting_type_name)].filter(Boolean).join(" — ")
    : clientName
      ? `${clientName} — ${item.title}`
      : item.title

  const place = [t(item.venue_name), t(item.room_or_floor), t(item.address_line1), t(item.address_line2), [t(item.city), t(item.state), t(item.postal_code)].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ")
  const location = place || t(item.video_url) || (t(item.dial_in) ? `Dial-in ${t(item.dial_in)}` : "")

  const lines: string[] = []
  if (t(item.notes_external)) lines.push(t(item.notes_external), "")
  if (t(item.video_url)) lines.push(`Video: ${t(item.video_url)}`)
  if (t(item.dial_in)) lines.push(`Dial-in: ${t(item.dial_in)}${t(item.dial_in_passcode) ? ` (passcode ${t(item.dial_in_passcode)})` : ""}`)
  const tr = item.travel
  if (tr) {
    const parts = [
      t(tr.transport_company),
      t(tr.driver_name) ? `Driver ${t(tr.driver_name)}${t(tr.driver_phone) ? ` ${t(tr.driver_phone)}` : ""}` : "",
      [t(tr.carrier), t(tr.flight_or_train_number)].filter(Boolean).join(" "),
      t(tr.pickup_instructions) ? `Pickup: ${t(tr.pickup_instructions)}` : "",
    ].filter(Boolean)
    if (parts.length) lines.push(parts.join(" · "))
  }
  if (people.length) {
    lines.push("", "Attendees:")
    for (const p of people) lines.push(`- ${p.full_name}${[t(p.title), t(p.company)].filter(Boolean).length ? ` (${[t(p.title), t(p.company)].filter(Boolean).join(", ")})` : ""}`)
  }
  const rose = people.filter((p) => p.side === "internal")
  const contact = rose[0] ?? attendees.find((a) => a.side === "internal")
  if (contact) lines.push("", `Rose & Company contact: ${contact.full_name}${t(contact.phone) ? ` · ${t(contact.phone)}` : ""}${t(contact.email) ? ` · ${t(contact.email)}` : ""}`)
  const description = lines.join("\n").trim()

  const endTz = tr?.to_timezone && tr.to_timezone !== item.timezone ? tr.to_timezone : item.timezone
  const start = icsTime(item.start_at, item.timezone)
  const end = icsTime(item.end_at, endTz)
  const zones = [...new Set([item.timezone, endTz])].filter((z) => ZONES[z])
  const status = item.status === "cancelled" ? "CANCELLED" : item.status === "tentative" ? "TENTATIVE" : "CONFIRMED"
  const hash = hashText(JSON.stringify([summary, location, description, start, end, status]))
  return { uid: `ep-${item.id}@roseandco.com`, summary, location, description, start, end, zones, status, hash }
}

/**
 * The .ics text. `method` REQUEST for a new / updated invite, CANCEL to
 * withdraw it (same UID, higher SEQUENCE), PUBLISH for a plain download.
 */
export function buildIcs(p: {
  payload: InvitePayload
  method: "REQUEST" | "CANCEL" | "PUBLISH"
  sequence: number
  recipient: { name: string; email: string } | null
  now?: Date
}): string {
  const stamp = (p.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
  const x = p.payload
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Rose & Company//Events Planner//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${p.method}`,
    ...x.zones.flatMap(vtimezone),
    "BEGIN:VEVENT",
    `UID:${x.uid}`,
    `SEQUENCE:${p.sequence}`,
    `DTSTAMP:${stamp}`,
    `DTSTART${x.start.param}:${x.start.value}`,
    `DTEND${x.end.param}:${x.end.value}`,
    `SUMMARY:${icsEscape(x.summary)}`,
    ...(x.location ? [`LOCATION:${icsEscape(x.location)}`] : []),
    ...(x.description ? [`DESCRIPTION:${icsEscape(x.description)}`] : []),
    `ORGANIZER;CN=${icsEscape(INVITE_ORGANIZER.name)}:mailto:${INVITE_ORGANIZER.email}`,
    ...(p.recipient
      ? [
          `ATTENDEE;CN=${icsEscape(p.recipient.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${p.recipient.email}`,
        ]
      : []),
    `STATUS:${p.method === "CANCEL" ? "CANCELLED" : x.status}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
  return lines.map(icsFold).join("\r\n") + "\r\n"
}

/* ---- who gets what ------------------------------------------------------ */

export type InviteRecord = {
  item_id: string
  attendee_id: string
  status: string
  sequence: number
  last_payload_hash: string | null
  dry_run: boolean
}

export type InviteAction = "new" | "update" | "cancel" | "none"
export type InviteState =
  | "ineligible"
  | "not_sent"
  | "sent"
  | "updated"
  | "update_pending"
  | "cancel_pending"
  | "cancelled"
  | "failed"

export type InvitePlanRow = {
  itemId: string
  attendeeId: string
  action: InviteAction
  state: InviteState
  /** SEQUENCE to send with (current + 1 for updates / cancels). */
  sequence: number
  hash: string | null
  /** The last send was a dry run (nothing actually went out). */
  dryRun: boolean
  /** Why someone on the item gets no invite. */
  reason: string | null
}

/** Should this person get an invite for this item at all? Null = yes, else why not. */
export function inviteBlocker(item: InviteItem, a: InviteAttendee): string | null {
  if (!item.attendee_ids.includes(a.id)) return "Not on this item"
  if (item.status === "cancelled") return "Item cancelled"
  if (!item.send_invite) return "Invites off for this item"
  if (!a.email?.trim()) return "No email"
  if (item.item_type === "travel" && !a.receives_full_itinerary) return "Travel goes only to the travelling party"
  return null
}

const DELIVERED = new Set(["sent", "updated", "update_pending"])

/**
 * Work out, for every person on every item (and every past invite), whether to
 * send a new invite, an update, a cancellation, or nothing.
 *   - In LIVE mode a dry-run record counts as never sent.
 *   - Cancelled / removed / invite-off items with a delivered invite → cancel.
 */
export function planInvites(input: {
  items: readonly InviteItem[]
  attendees: readonly InviteAttendee[]
  records: readonly InviteRecord[]
  clientName: string | null
  live: boolean
}): InvitePlanRow[] {
  const recs = new Map(input.records.map((r) => [`${r.item_id}:${r.attendee_id}`, r]))
  const pairs = new Set<string>()
  for (const i of input.items) for (const a of i.attendee_ids) pairs.add(`${i.id}:${a}`)
  for (const r of input.records) pairs.add(`${r.item_id}:${r.attendee_id}`)
  const itemById = new Map(input.items.map((i) => [i.id, i]))
  const attById = new Map(input.attendees.map((a) => [a.id, a]))
  const payloads = new Map<string, InvitePayload>()

  const out: InvitePlanRow[] = []
  for (const key of pairs) {
    const [itemId, attendeeId] = key.split(":")
    const item = itemById.get(itemId)
    const att = attById.get(attendeeId)
    if (!item || !att) continue // deleted item / person (deletes are refused once delivered)
    const rec = recs.get(key)
    const delivered = !!rec && DELIVERED.has(rec.status) && (!input.live || !rec.dry_run)
    const blocker = inviteBlocker(item, att)
    let p = payloads.get(itemId)
    if (!p) {
      p = invitePayload(item, input.attendees, input.clientName)
      payloads.set(itemId, p)
    }
    const base = { itemId, attendeeId, dryRun: !!rec?.dry_run, reason: blocker }
    if (!blocker) {
      if (!delivered)
        out.push({ ...base, action: "new", state: rec?.status === "failed" ? "failed" : "not_sent", sequence: rec ? rec.sequence + 1 : 0, hash: p.hash })
      else if (rec!.last_payload_hash !== p.hash)
        out.push({ ...base, action: "update", state: "update_pending", sequence: rec!.sequence + 1, hash: p.hash })
      else out.push({ ...base, action: "none", state: rec!.status === "updated" ? "updated" : "sent", sequence: rec!.sequence, hash: p.hash })
    } else if (delivered) {
      out.push({ ...base, action: "cancel", state: "cancel_pending", sequence: rec!.sequence + 1, hash: rec!.last_payload_hash })
    } else {
      const state: InviteState = rec?.status === "cancelled" ? "cancelled" : rec?.status === "failed" ? "failed" : "ineligible"
      out.push({ ...base, action: "none", state, sequence: rec?.sequence ?? 0, hash: null })
    }
  }
  return out
}

/** Is this an outside (non-Rose) address? */
export function isExternalEmail(email: string | null | undefined): boolean {
  return !!email && !email.trim().toLowerCase().endsWith(`@${ROSE_DOMAIN}`)
}

/**
 * OOO Summary — the per-person / per-year / per-category time-off tally.
 *
 * The full rule set, its evidence, and its known gaps live in
 * content/docs/11-ooo-summary.md. The short version:
 *   • four categories, Time Off being the catch-all
 *   • a day counts only if it is Mon–Fri AND not an NYSE holiday
 *   • a request whose submitter comment says "half day" counts 0.5 in total
 *   • every request counts as approved (Dynamics never populates a status)
 *
 * Computed in TypeScript rather than as a `v_ooo_summary` view: the source
 * table is ~450 rows (well under the PostgREST 1,000-row cap), the half-day
 * rule is a text heuristic that wants unit tests, and this needs no DDL against
 * the live database. lib/time-off/load.ts does its date math the same way.
 *
 * SELF-CONTAINED BY DESIGN: no imports, matching every other unit-tested module
 * in lib/ — that is what lets `node --test` type-strip and run it directly.
 */

// ---------------------------------------------------------------------------
// NYSE market-holiday calendar — the "business day" basis for the tally
// ---------------------------------------------------------------------------
//
// The firm's working year follows the market, not the federal calendar. The two
// differ in both directions and it matters here:
//   • Good Friday is an NYSE holiday but NOT federal  → does not count as worked
//   • Columbus Day / Veterans Day are federal but the market is OPEN → they DO count
//
// Computed, not table-driven, so the calendar is correct for any year without
// maintenance. Known gaps (see the doc): the market's early closes are full
// working days here, and unscheduled closures are not modelled.

/** A date-only key, 'YYYY-MM-DD'. */
export type Ymd = string

const pad = (n: number) => String(n).padStart(2, "0")

/** Build a 'YYYY-MM-DD' key from Y/M/D (month is 1-based). */
export function ymd(y: number, m: number, d: number): Ymd {
  return `${y}-${pad(m)}-${pad(d)}`
}

/** UTC-midnight Date for a date-only key. UTC throughout: no local-tz drift. */
export function parseYmd(s: Ymd): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** Date → 'YYYY-MM-DD' (reads UTC fields, matching parseYmd). */
export function toYmd(d: Date): Ymd {
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(s: Ymd): number {
  return parseYmd(s).getUTCDay()
}

/** True for Saturday/Sunday. */
export function isWeekend(s: Ymd): boolean {
  const d = dayOfWeek(s)
  return d === 0 || d === 6
}

/** The date of the `nth` `weekday` in a month (nth is 1-based). */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): Ymd {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const offset = (weekday - firstDow + 7) % 7
  return ymd(year, month, 1 + offset + (nth - 1) * 7)
}

/** The date of the LAST `weekday` in a month. */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): Ymd {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const lastDow = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay()
  return ymd(year, month, lastDay - ((lastDow - weekday + 7) % 7))
}

/**
 * Easter Sunday (Gregorian) via the Anonymous/Meeus algorithm. Needed only to
 * derive Good Friday, which is Easter minus two days.
 */
function easterSunday(year: number): Ymd {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return ymd(year, month, day)
}

function addDays(s: Ymd, n: number): Ymd {
  const d = parseYmd(s)
  d.setUTCDate(d.getUTCDate() + n)
  return toYmd(d)
}

/**
 * Apply the market's weekend-shift rule to a fixed-date holiday:
 *   Saturday → observed the preceding Friday
 *   Sunday   → observed the following Monday
 *
 * `allowSaturdayShift` exists for New Year's Day: when Jan 1 lands on a
 * Saturday the NYSE does NOT close the preceding Friday, because that Friday is
 * the last session of the PRIOR year (Dec 31, 2021 traded normally ahead of
 * Sat Jan 1, 2022). Sunday still shifts forward to the Monday.
 */
function observed(s: Ymd, allowSaturdayShift = true): Ymd | null {
  const dow = dayOfWeek(s)
  if (dow === 6) return allowSaturdayShift ? addDays(s, -1) : null
  if (dow === 0) return addDays(s, 1)
  return s
}

/**
 * Juneteenth became an NYSE holiday in 2022. Earlier years must not treat it as
 * a closure — relevant only if historic time-off data is ever backfilled.
 */
const JUNETEENTH_FIRST_YEAR = 2022

/**
 * Every NYSE holiday observed in `year`, as date-only keys.
 *
 * Note this returns holidays *observed* within the year. A New Year's Day that
 * falls on a Sunday is observed on Monday Jan 2 of the same year, so no holiday
 * ever leaks across a year boundary here.
 */
export function nyseHolidays(year: number): Set<Ymd> {
  const out = new Set<Ymd>()
  const add = (d: Ymd | null) => {
    if (d) out.add(d)
  }

  add(observed(ymd(year, 1, 1), false)) // New Year's Day (no Saturday shift)
  add(nthWeekdayOfMonth(year, 1, 1, 3)) // MLK Jr. Day — 3rd Monday in January
  add(nthWeekdayOfMonth(year, 2, 1, 3)) // Washington's Birthday — 3rd Monday in February
  add(addDays(easterSunday(year), -2)) // Good Friday — always a Friday, no shift
  add(lastWeekdayOfMonth(year, 5, 1)) // Memorial Day — last Monday in May
  if (year >= JUNETEENTH_FIRST_YEAR) add(observed(ymd(year, 6, 19))) // Juneteenth
  add(observed(ymd(year, 7, 4))) // Independence Day
  add(nthWeekdayOfMonth(year, 9, 1, 1)) // Labor Day — 1st Monday in September
  add(nthWeekdayOfMonth(year, 11, 4, 4)) // Thanksgiving — 4th Thursday in November
  add(observed(ymd(year, 12, 25))) // Christmas Day

  return out
}

/** Memoized per-year lookup — a tally walks the same years thousands of times. */
const holidayCache = new Map<number, Set<Ymd>>()

export function isNyseHoliday(s: Ymd): boolean {
  const year = Number(s.slice(0, 4))
  let set = holidayCache.get(year)
  if (!set) {
    set = nyseHolidays(year)
    holidayCache.set(year, set)
  }
  return set.has(s)
}

/** A day counts toward a time-off tally only if it is a weekday and not a holiday. */
export function isBusinessDay(s: Ymd): boolean {
  return !isWeekend(s) && !isNyseHoliday(s)
}

// ---------------------------------------------------------------------------
// Categories, half-days, and the tally itself
// ---------------------------------------------------------------------------

/** The four buckets. Order is display order. */
export const CATEGORIES = ["Time Off", "Remote", "Sick", "Jury Duty"] as const
export type Category = (typeof CATEGORIES)[number]

/**
 * Dynamics `request_type_label` → category. Anything NOT listed here falls
 * through to "Time Off" — a deliberate catch-all so a new request type is never
 * silently dropped from someone's total. The trade-off: a genuinely different
 * kind of absence (parental leave, bereavement) looks like vacation until it is
 * added here. Review whenever Dynamics gains a request type.
 */
const TYPE_TO_CATEGORY: Record<string, Category> = {
  "Remote Work": "Remote",
  "Sick Leave": "Sick",
  "Jury Duty": "Jury Duty",
  // Vacation / Personal / Other → "Time Off" via the fallback below.
}

export function categorize(requestTypeLabel: string | null): Category {
  if (!requestTypeLabel) return "Time Off"
  return TYPE_TO_CATEGORY[requestTypeLabel.trim()] ?? "Time Off"
}

/**
 * Half-day detection over the submitter's free-text comment.
 *
 * Matches a bare "half", "half day"/"half-day", "half a day", or "1/2 day",
 * case-insensitive — the agreed rule.
 *
 * NOTE: the bare `\bhalf\b` arm is wider than a half-day phrase and DOES
 * over-match in the live data — "…for half marathon on Saturday" is counted as
 * a half day. That is one request out of 450. Narrowing to the phrase forms is
 * a one-line change: drop the `\bhalf\b` alternative below.
 *
 * Known to under-detect regardless: plainly partial days that never say "half"
 * ("available until 10:00 AM") count as full days, and no regex fixes that.
 * Known to over-detect: hedged asks ("could also do a half day") record what
 * was requested, not what was granted.
 */
const HALF_DAY_RE = /\bhalf\b|\b1\/2\s*day\b/i

export function isHalfDay(comment: string | null): boolean {
  return !!comment && HALF_DAY_RE.test(comment)
}

/** The shape this module needs out of the `new_vacationrequest` mirror. */
export type OooRequest = {
  ooo_id: string
  requested_by_id: string | null
  requested_by_name: string | null
  start_date: string | null
  end_date: string | null
  request_type_label: string | null
  description_comments: string | null
}

/** One output row: person × year × category. */
export type OooSummaryRow = {
  person_id: string
  person: string
  year: number
  category: Category
  days: number
}

/** Normalize a timestamp-or-date column to a date-only key. */
function dateKey(v: string | null): Ymd | null {
  if (!v) return null
  const s = v.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/**
 * Every business day a request covers, in order. Weekends and NYSE holidays are
 * dropped here, so downstream code never has to re-check them — in particular
 * "the last day" always means the last BUSINESS day, never a weekend/holiday.
 */
export function businessDaysList(start: Ymd, end: Ymd): Ymd[] {
  const out: Ymd[] = []
  if (end < start) return out
  const cursor = parseYmd(start)
  const last = parseYmd(end)
  while (cursor <= last) {
    const key = toYmd(cursor)
    if (isBusinessDay(key)) out.push(key)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

/**
 * The business days a request covers, bucketed by the calendar year of EACH
 * day — not the year of the start date. A request straddling New Year must
 * split across both years (one such row exists live: 2025-12-29 .. 2026-01-02).
 */
export function businessDaysByYear(start: Ymd, end: Ymd): Map<number, number> {
  const out = new Map<number, number>()
  for (const day of businessDaysList(start, end)) {
    const year = Number(day.slice(0, 4))
    out.set(year, (out.get(year) ?? 0) + 1)
  }
  return out
}

/**
 * The half-day rule: when the comment indicates a half day, the LAST BUSINESS
 * DAY of the range counts 0.5 and every other business day counts a full 1.0.
 *
 *   total = (business days − 1) + 0.5
 *
 * A single-business-day request therefore counts 0.5, which also covers a
 * multi-CALENDAR-day request that happens to contain only one business day
 * (Fri–Mon over a holiday weekend). The half never lands on a weekend or a
 * holiday because `businessDaysList` has already removed them.
 *
 * Per-year splitting falls out for free: each day is attributed to its own
 * calendar year, so a half-day request straddling New Year puts the 0.5 in the
 * year of its last business day and the full days in whichever year they fall.
 */
function requestDays(req: OooRequest, start: Ymd, end: Ymd): Map<number, number> {
  const days = businessDaysList(start, end)
  const half = isHalfDay(req.description_comments)
  const out = new Map<number, number>()
  days.forEach((day, i) => {
    const value = half && i === days.length - 1 ? 0.5 : 1
    const year = Number(day.slice(0, 4))
    out.set(year, (out.get(year) ?? 0) + value)
  })
  return out
}

/**
 * One individual request, as the click-to-detail side pane renders it. This is
 * the per-request view of the same arithmetic the tally aggregates, so the pane
 * and the table can never disagree.
 */
export type OooRequestDetail = {
  ooo_id: string
  person_id: string
  person: string
  start_date: Ymd
  end_date: Ymd
  category: Category
  /** Days this request contributes in total (across years, if it straddles). */
  days: number
  /** True when the half-day rule applied — the pane shows the ½. */
  isHalf: boolean
  /** The submitter's comment, verbatim. Null when they left it blank. */
  comment: string | null
  /** Calendar year of the start date — the pane's grouping key. */
  year: number
}

export type OooSummaryResult = {
  rows: OooSummaryRow[]
  /** Every year present, ascending — drives the year filter. */
  years: number[]
  /** Every request, for the detail pane. Most-recent first. */
  details: OooRequestDetail[]
  /** Requests skipped because a date was missing or unparseable. */
  skipped: number
}

/** Roll raw mirror rows into the person × year × category tally. */
export function computeOooSummary(requests: readonly OooRequest[]): OooSummaryResult {
  const acc = new Map<string, OooSummaryRow>()
  const years = new Set<number>()
  const details: OooRequestDetail[] = []
  let skipped = 0

  for (const req of requests) {
    const start = dateKey(req.start_date)
    const end = dateKey(req.end_date)
    if (!start || !end || end < start) {
      skipped++
      continue
    }

    const category = categorize(req.request_type_label)
    // Group by id so a renamed person does not split into two rows; fall back
    // to the name when the id is missing (no live rows lack one today).
    const personId = req.requested_by_id ?? req.requested_by_name ?? "unknown"
    const person = req.requested_by_name ?? "Unknown"

    const perYear = requestDays(req, start, end)
    const requestTotal = [...perYear.values()].reduce((a, b) => a + b, 0)

    // A request whose days are ALL weekend/holiday contributes nothing and is
    // not worth a pane row either.
    if (requestTotal > 0) {
      details.push({
        ooo_id: req.ooo_id,
        person_id: personId,
        person,
        start_date: start,
        end_date: end,
        category,
        days: requestTotal,
        isHalf: isHalfDay(req.description_comments),
        comment: req.description_comments,
        year: Number(start.slice(0, 4)),
      })
    }

    for (const [year, days] of perYear) {
      if (days === 0) continue
      years.add(year)
      const key = `${personId}|${year}|${category}`
      const existing = acc.get(key)
      if (existing) existing.days += days
      else acc.set(key, { person_id: personId, person, year, category, days })
    }
  }

  const rows = [...acc.values()].sort(
    (a, b) =>
      a.person.localeCompare(b.person) ||
      a.year - b.year ||
      CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category),
  )

  // Most-recent first, so the pane opens on what someone just took.
  details.sort(
    (a, b) => b.start_date.localeCompare(a.start_date) || a.end_date.localeCompare(b.end_date),
  )

  return { rows, years: [...years].sort((a, b) => a - b), details, skipped }
}

/** One person's requests, newest first, grouped into year sections for the pane. */
export function detailsForPerson(
  details: readonly OooRequestDetail[],
  personId: string,
): { year: number; requests: OooRequestDetail[] }[] {
  const byYear = new Map<number, OooRequestDetail[]>()
  for (const d of details) {
    if (d.person_id !== personId) continue
    const list = byYear.get(d.year)
    if (list) list.push(d)
    else byYear.set(d.year, [d])
  }
  // `details` is already newest-first, so each year's list keeps that order.
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, requests]) => ({ year, requests }))
}

/** One person's row in the rendered table: a cell per category, for one year. */
export type OooPersonTotals = {
  person_id: string
  person: string
  byCategory: Record<Category, number>
  /** Time Off + Sick + Jury Duty. Remote is NOT absence and is excluded. */
  totalAway: number
}

/** Pivot the tally to one row per person for a single year. */
export function pivotByPerson(rows: readonly OooSummaryRow[], year: number): OooPersonTotals[] {
  const out = new Map<string, OooPersonTotals>()
  for (const r of rows) {
    if (r.year !== year) continue
    let p = out.get(r.person_id)
    if (!p) {
      p = {
        person_id: r.person_id,
        person: r.person,
        byCategory: { "Time Off": 0, Remote: 0, Sick: 0, "Jury Duty": 0 },
        totalAway: 0,
      }
      out.set(r.person_id, p)
    }
    p.byCategory[r.category] += r.days
    if (r.category !== "Remote") p.totalAway += r.days
  }
  return [...out.values()].sort((a, b) => a.person.localeCompare(b.person))
}

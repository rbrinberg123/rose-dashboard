// Server-side loader for the weekly "Time Off" digest email.
//
// Reads the SAME data as the Time Off page (v_time_off / TimeOffRow) and rolls
// it up into the two windows the email renders:
//   • the current business week (Mon–Fri), and
//   • the current calendar month (a Monday-first, Mon–Fri grid),
// both anchored to Eastern "today" so the digest is correct for the 8:00 AM ET
// Monday send regardless of server locale.
//
// Reuses the page's OOO/Remote typing and its per-day sort (OOO before Remote,
// then by person name), so the email and the page never disagree on ordering.
// Pure date arithmetic + one Supabase read — the email builder stays free of any
// date logic (it just renders this shape).

import { getSupabaseServer } from "@/lib/supabase"
import type { TimeOffRow } from "@/lib/types"

const NY_TZ = "America/New_York"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
// Business-week grid: Monday–Friday only (no weekend columns) — same as the page.
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"]

// ---- date helpers (local, date-only) --------------------------------------
function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/** Eastern "today" as a local date-only anchor. We read the Eastern calendar
 *  Y/M/D and rebuild a plain local-midnight Date from it, so all downstream date
 *  math (weekday, month grid) reflects the Eastern day the digest is sent on. */
function easternToday(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0")
  return new Date(get("year"), get("month") - 1, get("day"))
}

/** OOO before Remote, then by person name — the page's exact day ordering. */
function sortDayEntries(arr: TimeOffRow[]): void {
  arr.sort(
    (a, b) =>
      (a.time_off_type === b.time_off_type ? 0 : a.time_off_type === "OOO" ? -1 : 1) ||
      a.person.localeCompare(b.person),
  )
}

// ---- shapes the email builder consumes -------------------------------------

/** One weekday in the "This Week" card (Mon–Fri). */
export type TimeOffDay = {
  label: string // "Mon 3"
  entries: TimeOffRow[] // OOO first, then Remote, then by name
}

/** One cell in the full-month grid (Mon–Fri only). */
export type TimeOffMonthCell = {
  day: number // day-of-month number
  inMonth: boolean // false for trailing next-/prev-month days (dimmed)
  isToday: boolean
  entries: TimeOffRow[]
}

export type TimeOffEmailData = {
  todayLabel: string // "Mon Aug 3"
  todayEntries: TimeOffRow[]
  mondayLabel: string // "Aug 3" — the "Week of …" anchor
  weekDays: TimeOffDay[] // exactly 5 (Mon–Fri)
  monthLabel: string // "August 2026"
  monthWeeks: TimeOffMonthCell[][] // rows of 5 (Mon–Fri)
  // Header summary — DISTINCT people across the Mon–Fri week.
  outThisWeek: number // people with any entry this week
  oooThisWeek: number // people with an OOO entry this week
  remoteThisWeek: number // people with a Remote entry this week
}

/**
 * Load v_time_off and roll it into the digest's week + month windows. `now`
 * defaults to real time; it is injectable so a test can pin the window.
 */
export async function loadTimeOffData(now: Date = new Date()): Promise<{
  data: TimeOffEmailData | null
  error: string | null
}> {
  const sb = getSupabaseServer()

  // ~400 approved rows — under the PostgREST 1,000-row cap, so a single fetch is
  // enough (same read as the page).
  const { data, error } = await sb.from("v_time_off").select("*")
  if (error) return { data: null, error: error.message }

  const rows = (data ?? []) as TimeOffRow[]
  const parsed = rows.map((e) => ({ e, start: parseYmd(e.start_date), end: parseYmd(e.end_date) }))

  /** Entries active on a given day (start ≤ day ≤ end), sorted like the page. */
  const activeOn = (day: Date): TimeOffRow[] => {
    const out = parsed.filter((p) => p.start <= day && day <= p.end).map((p) => p.e)
    sortDayEntries(out)
    return out
  }

  const today = easternToday(now)

  // ---- This Week (Mon–Fri) --------------------------------------------------
  const monday = addDays(today, -((today.getDay() + 6) % 7))
  const weekDays: TimeOffDay[] = WEEKDAY_LABELS.map((label, i) => {
    const d = addDays(monday, i)
    return { label: `${label} ${d.getDate()}`, entries: activeOn(d) }
  })
  const mondayLabel = `${MONTHS[monday.getMonth()].slice(0, 3)} ${monday.getDate()}`

  const todayEntries = activeOn(today)
  const todayLabel = `${DOW_SHORT[today.getDay()]} ${MONTHS[today.getMonth()].slice(0, 3)} ${today.getDate()}`

  // Header summary: DISTINCT people this week, split by type they appear under.
  const weekPeople = new Set<string>()
  const oooPeople = new Set<string>()
  const remotePeople = new Set<string>()
  for (const d of weekDays) {
    for (const e of d.entries) {
      weekPeople.add(e.person)
      if (e.time_off_type === "Remote") remotePeople.add(e.person)
      else oooPeople.add(e.person)
    }
  }

  // ---- Full month grid (Monday-first, Mon–Fri only) -------------------------
  const year = today.getFullYear()
  const month = today.getMonth()
  const first = new Date(year, month, 1)
  const daysFromMonday = (first.getDay() + 6) % 7
  const gridStart = addDays(first, -daysFromMonday)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const nWeeks = Math.ceil((daysFromMonday + daysInMonth) / 7)
  const monthWeeks: TimeOffMonthCell[][] = []
  for (let w = 0; w < nWeeks; w++) {
    const weekStart = addDays(gridStart, w * 7)
    const cells: TimeOffMonthCell[] = WEEKDAY_LABELS.map((_, i) => {
      const d = addDays(weekStart, i)
      return {
        day: d.getDate(),
        inMonth: d.getMonth() === month,
        isToday: d.getTime() === today.getTime(),
        entries: activeOn(d),
      }
    })
    monthWeeks.push(cells)
  }
  const monthLabel = `${MONTHS[month]} ${year}`

  return {
    data: {
      todayLabel,
      todayEntries,
      mondayLabel,
      weekDays,
      monthLabel,
      monthWeeks,
      outThisWeek: weekPeople.size,
      oooThisWeek: oooPeople.size,
      remoteThisWeek: remotePeople.size,
    },
    error: null,
  }
}

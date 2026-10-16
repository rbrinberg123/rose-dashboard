/**
 * Client Margin — PHASE 1: the KNOWN-HOURS model (no cost, no margin yet).
 *
 * Pure and import-free (no "@/" paths, no Supabase) so the page loader, the
 * unit tests and one-off node scripts all run the exact same arithmetic.
 * See content/docs/30-client-margin.md for the model and field mappings.
 *
 * Per client, over the selected window:
 *   Booking              virtual 1.0 h · live 1.5 h   per meeting in the window
 *   Hosting              virtual 1.5 h · live 3.0 h   per HELD meeting
 *   Feedback collection  1.0 h                        per HELD meeting
 *   Report preparation   1.0 h                        per completed feedback report
 *   Client management    3.0 h / month as a client in the window (36 h / full year)
 *
 * CANCELLED meetings (meeting_status_label = 'Cancelled') — default: they still
 * count their BOOKING hours (the effort was spent) but never hosting or
 * feedback. `includeCancelledBooking` turns that off; both figures are kept
 * on every row so the page can show the two totals side by side.
 */

export const HOURS = {
  bookVirtual: 1.0,
  bookLive: 1.5,
  hostVirtual: 1.5,
  hostLive: 3.0,
  feedbackCollection: 1.0,
  reportPrep: 1.0,
  clientMgmtPerMonth: 3.0,
} as const

const DAY_MS = 86_400_000
/** Days in the "one year" used for the < 1 year flag and the month pro-rate. */
const YEAR_DAYS = 365

/* ---------------------------------------------------------------- window -- */

export type WindowKey = "12m" | "6m" | "3m" | "ytd" | "py"

export const WINDOW_OPTIONS: readonly { key: WindowKey; label: string }[] = [
  { key: "12m", label: "Trailing 12 months" },
  { key: "6m", label: "Trailing 6 months" },
  { key: "3m", label: "Trailing 3 months" },
  { key: "ytd", label: "Year to date" },
  { key: "py", label: "Prior calendar year" },
]

export function isWindowKey(v: unknown): v is WindowKey {
  return WINDOW_OPTIONS.some((o) => o.key === v)
}

/** [start, end) as Date instants. `now` is injectable for tests. */
export function resolveWindow(key: WindowKey, now: Date = new Date()): { start: Date; end: Date } {
  const y = now.getUTCFullYear()
  const back = (months: number) => {
    const d = new Date(now)
    d.setUTCMonth(d.getUTCMonth() - months)
    return d
  }
  switch (key) {
    case "6m":
      return { start: back(6), end: now }
    case "3m":
      return { start: back(3), end: now }
    case "ytd":
      return { start: new Date(Date.UTC(y, 0, 1)), end: now }
    case "py":
      return { start: new Date(Date.UTC(y - 1, 0, 1)), end: new Date(Date.UTC(y, 0, 1)) }
    case "12m":
    default:
      return { start: back(12), end: now }
  }
}

/* ----------------------------------------------------------------- inputs -- */

/** One meeting row, as read from public.meetings. */
export type MeetingIn = {
  client_account_id: string | null
  meeting_date: string | null
  /** 'Live' | 'Virtual' | null. */
  meeting_type_label: string | null
  is_in_person: boolean | null
  /** 'Confirmed' | 'Pending' | 'TBR' | 'Cancelled' | null. */
  meeting_status_label: string | null
}

/** One completed feedback-report task (tasks.bcs_task_subtype_label = 'Feedback'). */
export type ReportIn = { client_account_id: string | null }

export type ClientIn = {
  account_id: string
  client_name: string
  /** Client start date (YYYY-MM-DD or ISO), or null when none is recorded. */
  start_date: string | null
  /** Which field start_date came from — shown on hover. */
  start_source: "original_start_date" | "contract_start" | "first_meeting" | null
}

/* ---------------------------------------------------------------- outputs -- */

export type ClientHours = {
  account_id: string
  client_name: string
  start_date: string | null
  start_source: ClientIn["start_source"]
  /** Client for less than one year as of TODAY (or no start date at all). */
  lessThanOneYear: boolean
  /** Months as a client inside the window (drives client management). */
  monthsInWindow: number

  // Counts
  meetingsVirtual: number
  meetingsLive: number
  cancelledVirtual: number
  cancelledLive: number
  heldVirtual: number
  heldLive: number
  reports: number

  // Hours (booking includes cancelled meetings; see bookingExclCancelled)
  booking: number
  bookingExclCancelled: number
  hosting: number
  feedbackCollection: number
  reportPrep: number
  clientMgmt: number
  /** Default total (cancelled meetings' booking hours counted). */
  total: number
  /** Same total with cancelled meetings left out entirely. */
  totalExclCancelled: number
}

export type HoursResult = {
  rows: ClientHours[]
  /** Meetings whose type was blank — counted at the VIRTUAL rate. */
  unknownTypeMeetings: number
}

const isLive = (m: MeetingIn) => m.is_in_person === true || m.meeting_type_label === "Live"
const isCancelled = (m: MeetingIn) => m.meeting_status_label === "Cancelled"

/** Held = Confirmed and already happened (on or before the window end / now). */
function isHeld(m: MeetingIn, heldCutoff: number): boolean {
  if (m.meeting_status_label !== "Confirmed" || !m.meeting_date) return false
  return Date.parse(m.meeting_date) <= heldCutoff
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Tally every active client's known hours. `meetings` and `reports` must
 * already be limited to the window (the loader filters by date); clients with
 * no activity still get a row (client management alone).
 */
export function computeClientHours(
  clients: readonly ClientIn[],
  meetings: readonly MeetingIn[],
  reports: readonly ReportIn[],
  window: { start: Date; end: Date },
  now: Date = new Date(),
): HoursResult {
  const heldCutoff = Math.min(window.end.getTime(), now.getTime())
  const oneYearAgo = now.getTime() - YEAR_DAYS * DAY_MS

  const byClient = new Map<string, ClientHours>()
  for (const c of clients) {
    const startMs = c.start_date ? Date.parse(c.start_date) : NaN
    const from = Math.max(window.start.getTime(), Number.isNaN(startMs) ? window.start.getTime() : startMs)
    const overlapDays = Math.max(0, (window.end.getTime() - from) / DAY_MS)
    const monthsInWindow = (overlapDays * 12) / YEAR_DAYS
    byClient.set(c.account_id, {
      account_id: c.account_id,
      client_name: c.client_name,
      start_date: c.start_date,
      start_source: c.start_source,
      lessThanOneYear: Number.isNaN(startMs) || startMs > oneYearAgo,
      monthsInWindow: round1(monthsInWindow),
      meetingsVirtual: 0,
      meetingsLive: 0,
      cancelledVirtual: 0,
      cancelledLive: 0,
      heldVirtual: 0,
      heldLive: 0,
      reports: 0,
      booking: 0,
      bookingExclCancelled: 0,
      hosting: 0,
      feedbackCollection: 0,
      reportPrep: 0,
      clientMgmt: monthsInWindow * HOURS.clientMgmtPerMonth,
      total: 0,
      totalExclCancelled: 0,
    })
  }

  let unknownTypeMeetings = 0
  for (const m of meetings) {
    const row = m.client_account_id ? byClient.get(m.client_account_id) : undefined
    if (!row) continue
    if (!m.meeting_type_label && m.is_in_person == null) unknownTypeMeetings++
    const live = isLive(m)
    const book = live ? HOURS.bookLive : HOURS.bookVirtual
    if (live) row.meetingsLive++
    else row.meetingsVirtual++
    row.booking += book
    if (isCancelled(m)) {
      if (live) row.cancelledLive++
      else row.cancelledVirtual++
      continue // booking only — never hosting or feedback
    }
    row.bookingExclCancelled += book
    if (isHeld(m, heldCutoff)) {
      if (live) row.heldLive++
      else row.heldVirtual++
      row.hosting += live ? HOURS.hostLive : HOURS.hostVirtual
      row.feedbackCollection += HOURS.feedbackCollection
    }
  }

  for (const r of reports) {
    const row = r.client_account_id ? byClient.get(r.client_account_id) : undefined
    if (!row) continue
    row.reports++
    row.reportPrep += HOURS.reportPrep
  }

  const rows = [...byClient.values()].map((r) => {
    const rest = r.hosting + r.feedbackCollection + r.reportPrep + r.clientMgmt
    return {
      ...r,
      booking: round1(r.booking),
      bookingExclCancelled: round1(r.bookingExclCancelled),
      hosting: round1(r.hosting),
      feedbackCollection: round1(r.feedbackCollection),
      reportPrep: round1(r.reportPrep),
      clientMgmt: round1(r.clientMgmt),
      total: round1(r.booking + rest),
      totalExclCancelled: round1(r.bookingExclCancelled + rest),
    }
  })
  rows.sort((a, b) => b.total - a.total || a.client_name.localeCompare(b.client_name))
  return { rows, unknownTypeMeetings }
}

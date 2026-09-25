/**
 * Time Off requests — the shared, PURE definitions used by the form
 * (app/time-off-requests/time-off-form-dialog.tsx), the server actions
 * (app/time-off-requests/actions.ts) and the list page. Kept out of the
 * "use server" file, which may export only async functions.
 *
 * ── THE PER-DAY MODEL ──────────────────────────────────────────────────────
 * A request is a date range PLUS one `time_off_days` row per counted day, each
 * with a portion: Full (1 day), AM or PM (half a day). total_days is the sum.
 *
 * Which days of a range are counted is the OOO Summary's own rule
 * (isBusinessDay in lib/ooo-summary/compute.ts): Monday–Friday and not an NYSE
 * holiday. Weekends and market holidays inside a range are shown on the form
 * as "not counted" and get NO day row, so the Time Off total and the OOO
 * Summary tally can never disagree.
 *
 * Every date is an EASTERN calendar day, as a plain "YYYY-MM-DD" string —
 * never a Date or an instant, so nothing can shift it across a time zone.
 *
 * See content/docs/23-time-off.md.
 */

import {
  businessDaysList,
  isBusinessDay,
  isHalfDay,
  isNyseHoliday,
  isWeekend,
  parseYmd,
  toYmd,
} from "@/lib/ooo-summary/compute"

/**
 * Whether the form's "Test record" toggle starts ON. TEST PHASE: true.
 * Going live for real = false.
 */
export const NEW_TIME_OFF_TEST_DEFAULT = true

/** The six request types — the same values as the Dynamics Request Type choice. */
export const TIME_OFF_REQUEST_TYPES = [
  "Vacation",
  "Sick Leave",
  "Personal",
  "Jury Duty",
  "Remote Work",
  "Other",
] as const
export type TimeOffRequestType = (typeof TIME_OFF_REQUEST_TYPES)[number]

export const TIME_OFF_STATUSES = ["Pending", "Approved", "Denied"] as const
export type TimeOffStatus = (typeof TIME_OFF_STATUSES)[number]

export const TIME_OFF_PORTIONS = ["Full", "AM", "PM"] as const
export type TimeOffPortion = (typeof TIME_OFF_PORTIONS)[number]

/** The longest range the form will expand into day rows — a guard, not a policy. */
export const MAX_RANGE_DAYS = 366

export function isRequestType(v: unknown): v is TimeOffRequestType {
  return typeof v === "string" && (TIME_OFF_REQUEST_TYPES as readonly string[]).includes(v)
}

export function isPortion(v: unknown): v is TimeOffPortion {
  return typeof v === "string" && (TIME_OFF_PORTIONS as readonly string[]).includes(v)
}

export function isYmd(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    toYmd(parseYmd(v)) === v // rejects 2026-02-31
  )
}

/** One day of a request's range, as the form renders it. */
export type RangeDay = {
  date: string
  /** False for weekends and NYSE holidays — shown, but no day row, no total. */
  counted: boolean
  /** Why an uncounted day is skipped. */
  reason: "weekend" | "holiday" | null
}

/** Every calendar day from start to end inclusive, flagged counted or not. */
export function rangeDays(start: string, end: string): RangeDay[] {
  if (!isYmd(start) || !isYmd(end) || end < start) return []
  const out: RangeDay[] = []
  const cursor = parseYmd(start)
  const last = parseYmd(end)
  while (cursor <= last && out.length <= MAX_RANGE_DAYS) {
    const date = toYmd(cursor)
    const counted = isBusinessDay(date)
    out.push({
      date,
      counted,
      reason: counted ? null : isWeekend(date) ? "weekend" : isNyseHoliday(date) ? "holiday" : null,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

/** One persisted day. */
export type TimeOffDayInput = { date: string; portion: TimeOffPortion }

/**
 * The day rows for a range: every COUNTED day, carrying the portion chosen for
 * it (default Full). `portions` may hold dates outside the range (left over from
 * an earlier range) — they are simply ignored.
 */
export function buildDays(
  start: string,
  end: string,
  portions: Record<string, TimeOffPortion> = {},
): TimeOffDayInput[] {
  return rangeDays(start, end)
    .filter((d) => d.counted)
    .map((d) => ({ date: d.date, portion: portions[d.date] ?? "Full" }))
}

/** Full = 1, AM / PM = 0.5. Mirrors public.time_off_set_days(). */
export function totalDays(days: readonly { portion: string }[]): number {
  return days.reduce((sum, d) => sum + (d.portion === "Full" ? 1 : 0.5), 0)
}

/**
 * A DYNAMICS request's day count — exactly the OOO Summary's arithmetic
 * (business days, and the comment-driven half-day rule on the last one), so
 * the two pages show the same number for the same request. Dynamics has no
 * reliable day-count field of its own (`duration` is minutes, and 0 for a
 * one-day request).
 */
export function dynamicsTotalDays(
  start: string | null,
  end: string | null,
  description: string | null,
): number | null {
  if (!start || !end || !isYmd(start) || !isYmd(end) || end < start) return null
  const n = businessDaysList(start, end).length
  if (n === 0) return 0
  return isHalfDay(description) ? n - 0.5 : n
}

/** "2.5 days" / "1 day" / "½ day". */
export function formatDays(n: number | null | undefined): string {
  if (n == null) return "—"
  if (n === 0.5) return "½ day"
  return `${Number(n.toFixed(1))} day${n === 1 ? "" : "s"}`
}

/** The create / edit form's payload. */
export type TimeOffInput = {
  /** users.user_id — blank = you. */
  requestedById: string | null
  requestType: TimeOffRequestType | ""
  /** YYYY-MM-DD, Eastern. */
  startDate: string
  endDate: string
  /** Portion per COUNTED day; missing = Full. */
  portions: Record<string, TimeOffPortion>
  description: string
  comments: string
  isTest: boolean
}

/** One row of v_admin_time_off_all, as the list and drawer use it. */
export type TimeOffListRow = {
  id: string
  source: "Dynamics" | "Dashboard"
  requested_by_id: string | null
  requested_by_name: string | null
  start_date: string | null
  end_date: string | null
  request_type: string | null
  total_days: number | null
  status: string | null
  reviewing_team: string | null
  description: string | null
  comments: string | null
  reviewed_by_name: string | null
  reviewed_at: string | null
  review_comments: string | null
  is_test: boolean | null
  created_by_name: string | null
  created_on: string | null
}

/** The drawer's full record: the list row plus, for dashboard rows, its days. */
export type TimeOffRecord = TimeOffListRow & {
  days: TimeOffDayInput[]
  /** Reviewer names for the requester, live from time_off_reviewers. */
  reviewers: string[]
  /** True when the (real) viewer may approve / deny this request right now. */
  canReview: boolean
  /** Why they can't, when they can't — shown under the buttons. */
  reviewBlockedReason: string | null
  /** True when the viewer may edit / delete it (super_user, not in View as). */
  canEdit: boolean
}

/**
 * PURE rules for the Alerts page — no I/O, so every severity decision and every
 * ordering decision is unit-testable and lives in exactly one place.
 *
 * SEVERITY VOCABULARY (the whole page, all five sections):
 *   red    "Critical"        — past the threshold, or unconditionally critical
 *   yellow "Needs attention" — inside the threshold
 *   blue   "Informational"   — listed, not scored
 *
 * THE THRESHOLD IS TEN DAYS, and it is the same ten days everywhere it applies:
 * strictly MORE than 10 is red, 10 or fewer is yellow. Sections 4 and 5 are
 * informational by design and never take a colour.
 *
 * See content/docs/21-alerts.md.
 */

export type AlertSeverity = "red" | "yellow" | "blue"

/** The shared age threshold, in days. Displayed in each section's caption. */
export const CRITICAL_AFTER_DAYS = 10

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  red: "Critical",
  yellow: "Needs attention",
  blue: "Informational",
}

/**
 * Age-scored severity: > CRITICAL_AFTER_DAYS → red, otherwise yellow.
 *
 * A null age (the source date is missing) is YELLOW, not red — an unknown age
 * is not evidence of lateness, and flagging it critical would cry wolf on a
 * blank CRM field. It still shows as an alert, with no age badge.
 */
export function severityForDays(days: number | null | undefined): AlertSeverity {
  if (days == null) return "yellow"
  return days > CRITICAL_AFTER_DAYS ? "red" : "yellow"
}

/** "1 day" / "16 days"; null when the age is unknown. */
export function ageLabel(days: number | null | undefined): string | null {
  if (days == null) return null
  return `${days} ${Math.abs(days) === 1 ? "day" : "days"}`
}

/** One rendered alert row. Every section produces these, so the row renders once. */
export type AlertRow = {
  /** Stable React key (the source record's id). */
  key: string
  severity: AlertSeverity
  accountId: string | null
  ticker: string | null
  clientName: string | null
  /** The item itself — the headline of the row. */
  title: string
  /** Secondary facts: institution / investor / owner / dates. Blanks dropped. */
  meta: string[]
  /** Age in days driving the badge + sort. null on informational rows. */
  ageDays: number | null
  /** Ascending sort value for informational sections (epoch ms). */
  sortAt: number | null
}

/**
 * Section ordering: RED FIRST, then oldest first. Informational sections carry
 * no age, so they fall through to `sortAt` ascending (soonest first) — which is
 * exactly what Hosting wants.
 */
export function sortAlertRows(rows: readonly AlertRow[]): AlertRow[] {
  const rank = (s: AlertSeverity) => (s === "red" ? 0 : s === "yellow" ? 1 : 2)
  return [...rows].sort((a, b) => {
    if (rank(a.severity) !== rank(b.severity)) return rank(a.severity) - rank(b.severity)
    if (a.ageDays != null || b.ageDays != null) {
      return (b.ageDays ?? -Infinity) - (a.ageDays ?? -Infinity)
    }
    if (a.sortAt != null || b.sortAt != null) {
      return (a.sortAt ?? Infinity) - (b.sortAt ?? Infinity)
    }
    return (a.clientName ?? "").localeCompare(b.clientName ?? "")
  })
}

/** Per-section red / yellow / blue tallies, for the section header chips. */
export function countsBySeverity(rows: readonly AlertRow[]): Record<AlertSeverity, number> {
  const out: Record<AlertSeverity, number> = { red: 0, yellow: 0, blue: 0 }
  for (const r of rows) out[r.severity] += 1
  return out
}

// ---------------------------------------------------------------------------
// Dates — ONE basis for the whole page: the EASTERN calendar day
// ---------------------------------------------------------------------------
/**
 * Every age on this page is measured in whole EASTERN calendar days, because
 * that is the basis the page's own source already uses:
 * `v_feedback_outstanding.days_since` is
 *     (now() AT TIME ZONE 'America/New_York')::date
 *   - (meeting_date AT TIME ZONE 'America/New_York')::date
 * and Section 1 renders that number straight from the view rather than
 * recomputing it. Scoring the other sections on a different basis (UTC, or the
 * browser's zone) would let two rows on the same screen disagree about what
 * "today" is — and at the 10-day boundary that is the difference between a red
 * row and a yellow one. Rose is an Eastern-time firm, so this is also simply
 * the right answer.
 */
const EASTERN_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** Today as an Eastern YYYY-MM-DD calendar day — the page's single `today`. */
export function easternToday(now: Date = new Date()): string {
  return EASTERN_DAY.format(now)
}

/**
 * The CALENDAR DAY of a stored CRM timestamp, as YYYY-MM-DD.
 *
 * Deliberately a literal slice, NOT a timezone conversion. These columns hold a
 * wall clock written with a +00 offset (see the meeting_date note in
 * app/profiles/page.tsx), so the first ten characters ARE the day the business
 * means. A 09:00 meeting stored as `09:00+00` is on that same date in Eastern
 * too — the two readings only diverge before ~04:00, which no meeting time and
 * no CRM date field in this data hits.
 */
export function storedDay(iso: string | null | undefined): string | null {
  if (!iso || iso.length < 10) return null
  const day = iso.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

/** Whole days between two YYYY-MM-DD days. Positive = `day` is before `today`. */
export function daysBetween(day: string | null, today: string): number | null {
  if (!day) return null
  const a = Date.parse(`${today}T00:00:00Z`)
  const b = Date.parse(`${day}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((a - b) / 86_400_000)
}

/** Days elapsed since a stored CRM timestamp. Positive = in the past. */
export function daysSince(iso: string | null | undefined, today: string): number | null {
  return daysBetween(storedDay(iso), today)
}

/** `today` shifted by whole days, as YYYY-MM-DD. Bounds the Hosting window. */
export function addDays(today: string, delta: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/**
 * The same ten-day rule expressed as a DATE CUTOFF instead of an age: a stored
 * day STRICTLY BEFORE this one is critical, on-or-after it is not.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The Alerts page scores severity in TypeScript, row by row, with
 * `severityForDays(daysSince(...))`. The nav badge cannot do that — it must
 * count in the database without fetching rows — so it needs the same rule as a
 * `WHERE received_date < cutoff` predicate.
 *
 * Two expressions of one rule is exactly how a badge and its page drift apart,
 * so the cutoff is derived here rather than open-coded in the query, and
 * `alerts-policy.test.ts` asserts the two agree on every day across the
 * boundary. Change CRITICAL_AFTER_DAYS and both move together.
 */
export function criticalCutoffDay(today: string): string {
  return addDays(today, -CRITICAL_AFTER_DAYS)
}

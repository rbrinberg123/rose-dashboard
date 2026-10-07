/**
 * PURE rules for My Dashboard — no I/O and no imports, so every bucketing,
 * ordering and colouring decision is unit-testable (see policy.test.ts) and
 * lives in exactly one place.
 *
 * All days are Eastern YYYY-MM-DD calendar days — the same single basis the
 * Alerts page uses (see easternToday / storedDay in
 * app/clients/alerts/alerts-policy.ts). The loader converts every source date
 * to that form before it reaches anything here.
 *
 * See content/docs/26-my-dashboard.md.
 */

/** The three My To-Do urgency buckets, in display order. */
export type Urgency = "overdue" | "week" | "later"

export const URGENCY_ORDER: readonly Urgency[] = ["overdue", "week", "later"]

/** How far ahead "This week" reaches, in days (inclusive). */
export const WEEK_DAYS = 7

/** Whole days from `today` to `day`. Positive = `day` is in the future. */
export function daysUntil(day: string | null, today: string): number | null {
  if (!day) return null
  const a = Date.parse(`${today}T00:00:00Z`)
  const b = Date.parse(`${day}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

/** `day` shifted by whole days, as YYYY-MM-DD. */
export function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10)
}

/**
 * THE URGENCY RULE — an item sorts by its OWN date:
 *   - already past (before today)       → overdue
 *   - today through today + 7 days      → week
 *   - further out, or no date at all    → later
 * So a dated item (a PTO approval for next week, a host meeting) floats up into
 * "This week" as its date approaches; only genuinely dateless items stay in
 * "Later".
 */
export function urgencyFor(day: string | null, today: string): Urgency {
  const d = daysUntil(day, today)
  if (d == null) return "later"
  if (d < 0) return "overdue"
  if (d <= WEEK_DAYS) return "week"
  return "later"
}

/** Due-date colour on a task / to-do line: past → over, within 7 days → soon. */
export type DueTone = "over" | "soon" | "plain"

export function dueTone(day: string | null, today: string): DueTone {
  const u = urgencyFor(day, today)
  return u === "overdue" ? "over" : u === "week" ? "soon" : "plain"
}

/**
 * Sort items into buckets: overdue first (oldest first), then this week
 * (soonest first), then later (dated soonest first, dateless last).
 */
export function sortByDue<T extends { due: string | null }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.due == null && b.due == null) return 0
    if (a.due == null) return 1
    if (b.due == null) return -1
    return a.due < b.due ? -1 : a.due > b.due ? 1 : 0
  })
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/** "Expiring soon" window, in days. */
export const CONTRACT_WINDOW_DAYS = 90

/**
 * The date a contract is counted against: its NOTICE date when that is still
 * ahead (that is the decision deadline), otherwise its TERM END. Null when
 * neither falls inside today .. today + 90 days.
 */
export function contractKeyDay(
  noticeDay: string | null,
  termEndDay: string | null,
  today: string,
): string | null {
  const inWindow = (d: string | null) => {
    const n = daysUntil(d, today)
    return n != null && n >= 0 && n <= CONTRACT_WINDOW_DAYS
  }
  if (inWindow(noticeDay)) return noticeDay
  if (inWindow(termEndDay)) return termEndDay
  return null
}

// ---------------------------------------------------------------------------
// Feedback collection
// ---------------------------------------------------------------------------

/**
 * Feedback collection has no due-date field: the source rows are concluded
 * meetings still missing feedback. The firm's existing rule (Alerts) is that it
 * turns critical MORE than 10 days after the meeting, so the item is treated as
 * DUE on meeting day + 10. That places a fresh one in "This week" and a stale
 * one in "Overdue" — the same line the Alerts page draws between yellow and red.
 */
export const FEEDBACK_DUE_AFTER_DAYS = 10

export function feedbackDueDay(meetingDay: string | null): string | null {
  return meetingDay ? shiftDay(meetingDay, FEEDBACK_DUE_AFTER_DAYS) : null
}

/**
 * Feedback to collect is ALREADY due (the meeting has happened), so it never
 * waits in "Later": past its day-10 line it is overdue, otherwise this week.
 */
export function feedbackUrgency(meetingDay: string | null, today: string): Urgency {
  return urgencyFor(feedbackDueDay(meetingDay), today) === "overdue" ? "overdue" : "week"
}

/**
 * PURE rules for the event's auto-created MARKETING MEMO task. No I/O; the
 * writes are lib/events/marketing-memo-server.ts.
 *
 * When a dashboard event is created — the same moment the database creates its
 * Feedback report (trg_events_auto_feedback_report) — the app also creates ONE
 * task of the existing type Outreach / sub-type Marketing Memo (lib/tasks/
 * create.ts), owned by the client's teaser (accounts.teaser_id; memo = teaser,
 * lib/account-teams/roles.ts), due 7 days before the event's Launch Week.
 *
 * See content/docs/27-feedback-reports.md → "Marketing Memo task".
 */

export const MARKETING_MEMO_TASK = {
  typeCode: 755860003,
  typeLabel: "Outreach",
  subtypeCode: 755860014,
  subtypeLabel: "Marketing Memo",
} as const

/** created_by_name of the automation's rows — the same stamp as the Feedback report. */
export const MARKETING_MEMO_CREATED_BY = "System (automation)"

/** Days before the Launch Week date the memo is due. */
export const MARKETING_MEMO_LEAD_DAYS = 7

/** "Marketing Memo – <event>", the same shape as "Feedback Report – <event>". */
export function marketingMemoSubject(eventName: string | null | undefined): string {
  return `Marketing Memo – ${(eventName ?? "").trim() || "(Unnamed event)"}`
}

/**
 * The due DAY (YYYY-MM-DD, Eastern) for a Launch Week day (YYYY-MM-DD, Eastern):
 * 7 calendar days earlier. Null when there is no (valid) launch week — the memo
 * then has no due date until one is set.
 */
export function marketingMemoDueDay(launchWeekDay: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((launchWeekDay ?? "").trim())
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3] - MARKETING_MEMO_LEAD_DAYS)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

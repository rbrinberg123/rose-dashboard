/**
 * Shared definitions for "Add New Note" — the second dashboard-authored record
 * type and the first one the reconciliation sweep covers. Used by the form
 * (app/notes/new-note-dialog.tsx) and createNote (app/notes/actions.ts); kept
 * out of the "use server" file, which may export only async functions.
 *
 * See content/docs/22-cutover-ownership-boundary.md.
 */

/**
 * Whether the form's "Test record" toggle starts ON. TEST PHASE: true.
 * Going live for real = false (and NEW_CONTACT_TEST_DEFAULT likewise).
 */
export const NEW_NOTE_TEST_DEFAULT = true

/**
 * Health status choices. status_text is FREE TEXT in Dynamics; these are the
 * five values downstream views recognise (v_client_portfolio / v_live_outreach
 * normalise by prefix to exactly these). Blank = "no status change" — the
 * portfolio flag carries the last non-blank status forward.
 */
export const NOTE_STATUS_OPTIONS = ["Stable", "At Risk", "New Client", "Lost", "Strong"] as const

/** Suggestions for the free-text risk driver — the most-used live values (2026-09-23). */
export const NOTE_RISK_SUGGESTIONS = [
  "None",
  "Execution/Meeting Volume",
  "Mining",
  "IR/Leadership Turnover",
  "Engagement/Availability",
  "Company Performance/Strategic Shift",
  "SG Transition",
  "Budget Pressure",
  "Limited C-suite Access",
] as const

/** "Client Review September 2026" — the current Dynamics naming for a cycle. */
export function defaultReviewCycle(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ""
  const month = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" })
  return `Client Review ${month} ${d.getUTCFullYear()}`
}

export type NewNoteInput = {
  /** accounts.account_id — REQUIRED (notes are per-client reviews). */
  clientAccountId: string | null
  /** YYYY-MM-DD */
  noteDate: string
  /** The review cycle (client_notes.name). */
  reviewCycle?: string
  body: string
  statusText?: string
  primaryRiskDriver?: string
  actionStep?: string
  /** Initials, as Dynamics stores them. */
  actionOwner?: string
  /** YYYY-MM-DD or empty. */
  actionDeadline?: string
  /** users.user_id — the note's author/owner; blank = you. */
  ownerId?: string | null
  isTest: boolean
}

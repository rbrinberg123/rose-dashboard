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

// (NOTE_STATUS_OPTIONS — the note "Status" choices — was removed 2026-10-15.
// A client's status is now its Client Health rating; client_notes.status_text
// is kept as read-only history and is no longer collected.)

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

export type NoteFieldErrors = Partial<Record<"clientAccountId" | "noteDate" | "reviewCycle" | "body", string>>

/**
 * REQUIRED fields (2026-10-12) — Client, Date and Title. A note has no title
 * column of its own: its "title" is the REVIEW CYCLE, client_notes.name (the
 * Dynamics primary name). The note body was already required and still is.
 * Pure: the form calls it to block submit and mark the fields; createNote /
 * updateNote call it again server-side. Empty object = valid.
 */
export function validateNoteRequired(
  input: Pick<NewNoteInput, "clientAccountId" | "noteDate" | "reviewCycle" | "body">,
): NoteFieldErrors {
  const errors: NoteFieldErrors = {}
  if (!(input.clientAccountId ?? "").trim()) errors.clientAccountId = "Pick a client."
  if (!/^\d{4}-\d{2}-\d{2}$/.test((input.noteDate ?? "").trim())) errors.noteDate = "Enter a note date."
  if (!(input.reviewCycle ?? "").trim()) errors.reviewCycle = "Enter a title (review cycle)."
  if (!(input.body ?? "").trim()) errors.body = "Write the note."
  return errors
}

export type NewNoteInput = {
  /** accounts.account_id — REQUIRED (notes are per-client reviews). ACTIVE
   *  clients only in the picker (loadActiveAccountOptions). */
  clientAccountId: string | null
  /** REQUIRED — YYYY-MM-DD */
  noteDate: string
  /** REQUIRED — the note's TITLE: the review cycle (client_notes.name).
   *  Prefilled from the date ("Client Review October 2026"), editable. */
  reviewCycle?: string
  /** REQUIRED (unchanged). */
  body: string
  primaryRiskDriver?: string
  actionStep?: string
  /** Initials, as Dynamics stores them. */
  actionOwner?: string
  /** YYYY-MM-DD or empty. */
  actionDeadline?: string
  /** users.user_id — the note's author/owner; blank = you. Active Rose & Co
   *  personnel only (loadPersonnelOptions); a stored owner may stay. */
  ownerId?: string | null
  isTest: boolean
}

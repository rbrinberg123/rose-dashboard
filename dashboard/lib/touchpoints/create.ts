/**
 * Shared definitions for "Add New Touch" — the third dashboard-authored record
 * type (after Contacts and Notes), and the second one the reconciliation sweep
 * covers. Used by the form (app/touchpoints/new-touch-dialog.tsx) and
 * createTouch (app/touchpoints/actions.ts); kept out of the "use server" file.
 *
 * See content/docs/22-cutover-ownership-boundary.md.
 */

/** Whether the form's "Test record" toggle starts ON. TEST PHASE: true. */
export const NEW_TOUCH_TEST_DEFAULT = true

/**
 * Touch Type — Dynamics `bcs_type` option-set values in use (codes + labels
 * read from the mirror, 2026-09-23). Stored as text (the live column is text).
 */
export const TOUCH_TYPE_OPTIONS = [
  { code: "755860000", label: "Virtual" },
  { code: "755860001", label: "In-Person" },
  { code: "755860004", label: "Email" },
  { code: "755860003", label: "Social" },
  { code: "755860005", label: "Onboarding Call" },
  { code: "755860006", label: "Teach-in" },
] as const

/**
 * Contact Type — Dynamics `bcs_contacttype` on phonecall. MULTI-SELECT: codes
 * are comma-joined ("755860001,755860002") and labels semicolon-joined
 * ("CFO; IRO"), exactly as the sync stores them. A ROLE, never a person.
 */
export const TOUCH_CONTACT_TYPE_OPTIONS = [
  { code: "755860000", label: "CEO" },
  { code: "755860001", label: "CFO" },
  { code: "755860002", label: "IRO" },
  { code: "755860003", label: "Other" },
] as const

/**
 * Status — the statecode/statuscode pairs live touches carry (2026-09-23):
 * Open/Open (96%), Completed/Made, Completed/Received.
 */
export const TOUCH_STATUS_OPTIONS = [
  { key: "open", state: 0, stateLabel: "Open", status: 1, statusLabel: "Open" },
  { key: "made", state: 1, stateLabel: "Completed", status: 2, statusLabel: "Made" },
  { key: "received", state: 1, stateLabel: "Completed", status: 4, statusLabel: "Received" },
] as const

export type NewTouchInput = {
  /** accounts.account_id — REQUIRED. */
  clientAccountId: string | null
  subject: string
  description?: string
  /** One of TOUCH_TYPE_OPTIONS[].code. */
  typeCode: string
  /** Any of TOUCH_CONTACT_TYPE_OPTIONS[].code. */
  contactTypeCodes: string[]
  /** true = Outgoing (every live touch is), false = Incoming. */
  outgoing: boolean
  /** Eastern wall clock, "YYYY-MM-DDTHH:mm" (datetime-local). */
  start: string
  /** Minutes; blank = none. */
  durationMinutes?: string
  statusKey: (typeof TOUCH_STATUS_OPTIONS)[number]["key"]
  isTest: boolean
}

/**
 * Shared definitions for "Add New Meeting" — a dashboard-authored record in
 * public.meetings (swept nightly). Used by app/meetings/new-meeting-dialog.tsx
 * and createMeeting in app/meetings/actions.ts; kept out of the "use server"
 * file.
 *
 * Option sets are the Dynamics values in use, read from the mirror 2026-09-23.
 * See content/docs/22-cutover-ownership-boundary.md.
 */

/** Whether the form's "Test record" toggle starts ON. TEST PHASE: true. */
export const NEW_MEETING_TEST_DEFAULT = true

/** bcs_meetingtype. "Live" is what makes is_in_person true (see mapMeeting). */
export const MEETING_TYPE_OPTIONS = [
  { code: 755860000, label: "Virtual" },
  { code: 755860001, label: "Live" },
] as const

/** bcs_meetingstatus. */
export const MEETING_STATUS_OPTIONS = [
  { code: 755860000, label: "Confirmed" },
  { code: 755860001, label: "Pending" },
  { code: 755860002, label: "TBR" },
  { code: 755860003, label: "Cancelled" },
] as const

/**
 * The event STAGES a meeting may be linked to from the form — events still
 * taking meetings. Later stages (Schedule Closed, Preparing Feedback,
 * Complete) and Pause are hidden. Filters the stored event_state_label. An
 * edited meeting keeps its current event even if that event has moved on.
 */
export const MEETING_EVENT_STAGES = ["Pre-Launch", "Live Outreach", "Meetings Ongoing"] as const

export type MeetingFieldErrors = Partial<Record<"clientAccountId" | "typeCode" | "institutionId" | "investor", string>>

/**
 * REQUIRED fields — Client, Type, Institution, Investor. Pure: the form calls
 * it to block submit and mark the fields; createMeeting / updateMeeting call it
 * again server-side. Empty object = valid.
 */
export function validateMeetingRequired(
  input: Pick<NewMeetingInput, "clientAccountId" | "typeCode" | "institutionId" | "investor">,
): MeetingFieldErrors {
  const errors: MeetingFieldErrors = {}
  if (!(input.clientAccountId ?? "").trim()) errors.clientAccountId = "Pick a client."
  if (input.typeCode == null || !MEETING_TYPE_OPTIONS.some((t) => t.code === input.typeCode)) {
    errors.typeCode = "Pick Live or Virtual."
  }
  if (!(input.institutionId ?? "").trim()) errors.institutionId = "Pick an institution."
  if (!(input.investor ?? "").trim()) errors.investor = "Enter the investor."
  return errors
}

export type NewMeetingInput = {
  /** accounts.account_id — REQUIRED (FK). */
  clientAccountId: string | null
  /** REQUIRED — starts blank in the form so it is a deliberate choice. */
  typeCode: number | null
  statusCode: number
  /** Eastern wall clock "YYYY-MM-DDTHH:mm". */
  start: string
  /** events.event_id of the same client, or empty. */
  eventId?: string | null
  /** An institution already seen on meetings (not a synced table). */
  institutionId?: string | null
  institutionName?: string | null
  investor?: string
  hostId?: string | null
  bookerId?: string | null
  generalNotes?: string

  // ---- the rest of the drawer's fields ("form field set = drawer field set") ----
  // Overview
  /** A city/state already seen on meetings (no cities table is synced). */
  cityName?: string | null
  stateRegionName?: string | null
  groupMeeting: boolean
  hostedInHq: boolean
  // Representatives
  onBehalfOfId?: string | null
  host2Id?: string | null
  feedbackId?: string | null
  clientBooked: boolean
  /** Choice fields: the Dynamics option code (label is looked up server-side). */
  hostNotesCode?: number | null
  // Planning
  calendarCode?: number | null
  profileCode?: number | null
  // Feedback
  /**
   * Feedback Status (bcs_feedbackstatus) — THE field that closes meeting-level
   * feedback: v_feedback_outstanding lists a meeting while it is blank or
   * "Awaiting Additional". FB in BDA and FB Rec'd are informational only.
   */
  feedbackStatusCode?: number | null
  feedbackBdaCode?: number | null
  /** YYYY-MM-DD */
  fbReceivedDate?: string
  feedbackNotes?: string
  // Logistics
  sent: boolean
  confirm: boolean
  driver: boolean
  foodOrder?: string
  logisticsNotes?: string
  // Cancellation (2026-10-07h flattened columns)
  /** cancelled_code — MEETING_CANCELLED_OPTIONS code, or null. */
  cancelledCode?: number | null
  cancellationNotes?: string
  /** contact_radar — Yes/No. */
  contactRadar: boolean
  // Rescheduling
  /** rescheduled — Yes/No ("Rescheduled Meeting"). */
  rescheduled: boolean
  rescheduledNotes?: string
  isTest: boolean
}

/** bcs_cancelled — a CHOICE, not a flag (codes confirmed against the mirror 2026-10-07). */
export const MEETING_CANCELLED_OPTIONS = [
  { code: 755860000, label: "All Cancelled" },
  { code: 755860001, label: "iPlanner Cancelled" },
  { code: 755860002, label: "Outlook Cancelled" },
] as const

/** One choice option (code + label) as the form's dropdowns use them. */
export type ChoiceOption = { code: number; label: string }

/**
 * The option lists for the meeting form's choice / lookup dropdowns — the
 * DISTINCT values already on meetings (Dynamics option-set metadata is not
 * reachable from here, and no cities / regions table is synced).
 */
export type MeetingChoiceOptions = {
  hostNotes: ChoiceOption[]
  calendar: ChoiceOption[]
  profile: ChoiceOption[]
  feedbackBda: ChoiceOption[]
  feedbackStatus: ChoiceOption[]
  cities: { id: string | null; name: string }[]
  states: { id: string | null; name: string }[]
}

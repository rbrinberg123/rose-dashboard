/**
 * Shared definitions for "Add New Event" — a dashboard-authored record in
 * public.events (swept nightly). Used by app/events/new-event-dialog.tsx and
 * createEvent in app/events/actions.ts; kept out of the "use server" file.
 *
 * Option sets are the Dynamics values in use, read from the mirror 2026-09-23.
 * See content/docs/22-cutover-ownership-boundary.md.
 */

/** Whether the form's "Test record" toggle starts ON. TEST PHASE: true. */
export const NEW_EVENT_TEST_DEFAULT = true

/**
 * bcs_eventstate — the stage. NOTE: "Live Outreach" puts the event on the Live
 * Outreach page AND in its daily email (v_live_outreach filters on this label).
 */
export const EVENT_STATE_OPTIONS = [
  { code: 755860000, label: "Pre-Launch" },
  { code: 755860001, label: "Live Outreach" },
  { code: 755860004, label: "Meetings Ongoing" },
  { code: 755860003, label: "Schedule Closed" },
  { code: 755860005, label: "Preparing Feedback" },
  { code: 755860002, label: "Complete" },
  { code: 755860006, label: "Pause" },
] as const

/** bcs_marketingstate. */
export const EVENT_MARKETING_OPTIONS = [
  { code: 755860001, label: "Marketing" },
  { code: 755860000, label: "Not Marketing" },
] as const

/** bcs_urgency. */
export const EVENT_URGENCY_OPTIONS = [
  { code: 755860000, label: "Standard" },
  { code: 755860001, label: "High" },
] as const

/**
 * bcs_leads — MULTI-SELECT of initials. Only the codes whose label occurs in
 * the mirror (2026-09-23) are known; codes are comma-joined, labels
 * semicolon-joined, exactly as the sync stores them.
 */
export const EVENT_LEAD_OPTIONS = [
  { code: "755860000", label: "AS" },
  { code: "755860001", label: "LW" },
  { code: "755860002", label: "SP" },
  { code: "755860003", label: "LJ" },
  { code: "755860006", label: "JB" },
  { code: "755860007", label: "JV" },
  { code: "755860008", label: "DO" },
  { code: "755860011", label: "JJ" },
  { code: "755860012", label: "JL" },
  { code: "755860013", label: "EM" },
  { code: "755860014", label: "MJ" },
  { code: "755860015", label: "NM" },
] as const

/** Feedback Team — the one Dynamics team events point at (53% of live events). */
export const EVENT_FEEDBACK_TEAMS = [
  { id: "64f65d2e-c46f-f011-bec2-6045bdd8118b", name: "Feedback Reports" },
] as const

export type NewEventInput = {
  /** accounts.account_id — REQUIRED. */
  clientAccountId: string | null
  /** Dynamics names events "TICKER - Place - dates"; the form suggests one. */
  name: string
  stateCode: number
  marketingCode: number
  /** Free text, as in Dynamics ("10/6, 10/7"). */
  dates?: string
  location?: string
  /** YYYY-MM-DD — event_start_actual / event_end_actual (the meetings window). */
  meetingsStart?: string
  meetingsEnd?: string
  /** of_slots — the meeting-slot capacity. */
  slots?: string
  notes?: string

  // ---- the rest of the drawer's editable fields ("form = drawer") ----
  tbc: boolean
  team: boolean
  /** bcs_mining — Yes EXCLUDES the event from Live Outreach (page + email). */
  mining: boolean
  /** users.user_id */
  accountManagerId?: string | null
  logisticsCoordinatorId?: string | null
  feedbackReportId?: string | null
  /** EVENT_FEEDBACK_TEAMS[].id or empty. */
  feedbackTeamId?: string | null
  leadCodes: string[]
  eventParameters?: string
  urgencyCode?: number | null
  /** YYYY-MM-DD (Eastern) */
  launchWeek?: string
  memoDate?: string
  lastDataUpload?: string
  shareholderReportReceived?: string
  targetingDate?: string
  targetingNotRequired: boolean
  memoNotRequired: boolean
  targetingUrl?: string
  profileLink?: string
  targetingNotes?: string
  launch: boolean
  outreachComplete: boolean
  isTest: boolean
}

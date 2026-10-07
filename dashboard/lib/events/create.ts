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
 *
 * Never picked in the form: on a dashboard-origin event the database COMPUTES
 * it from launch / outreach_complete / paused + the event's meetings and
 * feedback tasks (sql/patches/2026-10-07e_event_lifecycle.sql; the stepper's
 * order is in lib/events/lifecycle.ts). Dynamics-origin events keep their
 * synced stage.
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

/**
 * bcs_marketingstate. Never picked in the form: on a dashboard-origin event it
 * is DERIVED from the computed stage — Marketing only while the stage is Live
 * Outreach, Not Marketing otherwise — by the same database trigger that sets
 * the stage (sql/patches/2026-10-07f_event_marketing_data_upload.sql).
 */
export const EVENT_MARKETING_OPTIONS = [
  { code: 755860001, label: "Marketing" },
  { code: 755860000, label: "Not Marketing" },
] as const

/**
 * The marketing state the database will derive for these toggles. Live
 * Outreach depends on the toggles alone (Launch on, Outreach Complete off, not
 * paused), so the form can show the exact result before saving.
 */
export function derivedMarketingLabel(launch: boolean, outreachComplete: boolean, paused: boolean): string {
  return launch && !outreachComplete && !paused ? "Marketing" : "Not Marketing"
}

/**
 * The three LOOKED-UP dates. Each is the completion time (actual_end) of the
 * client's most recent Completed task of that sub-type (tasks.bcs_account_id =
 * the client) — client-level, latest wins, never typed. Same rule as
 * event_client_latest_task() in sql/patches/2026-10-07g_event_reps_task_dates.sql,
 * which keeps the stored columns fresh. Sub-types confirmed against the mirror
 * 2026-10-07: Data Upload 199 tasks, Marketing Memo 1,112 (subjects say
 * "Teaser" / "Marketing Memo"), Targeting 602 — all linked to a client.
 */
export const EVENT_TASK_DATE_SUBTYPES = {
  lastDataUpload: "Data Upload",
  memoDate: "Marketing Memo",
  targetingDate: "Targeting",
} as const
export type EventTaskDateKey = keyof typeof EVENT_TASK_DATE_SUBTYPES
export type EventTaskDates = Record<EventTaskDateKey, string | null>

/** A contact attached to an event as a company representative. */
export type EventRepresentative = {
  contactId: string
  name: string
  /** Job title · company, for the picker / list. */
  detail: string | null
}

export type EventFieldErrors = Partial<Record<"clientAccountId" | "location" | "slots" | "urgencyCode", string>>

/**
 * REQUIRED fields — Client, Location, # of Slots, Urgency. Pure: the form
 * calls it to block submit and mark the fields; createEvent / updateEvent call
 * it again on the server. Empty object = valid.
 */
export function validateEventRequired(input: Pick<NewEventInput, "clientAccountId" | "location" | "slots" | "urgencyCode">): EventFieldErrors {
  const errors: EventFieldErrors = {}
  if (!(input.clientAccountId ?? "").trim()) errors.clientAccountId = "Pick a client."
  if (!(input.location ?? "").trim()) errors.location = "Enter a location."
  const slots = (input.slots ?? "").trim()
  if (!slots) errors.slots = "Enter the number of slots."
  else if (!/^\d+$/.test(slots) || Number(slots) > 1000) errors.slots = "Slots must be a whole number (0–1000)."
  if (input.urgencyCode == null || !EVENT_URGENCY_OPTIONS.some((u) => u.code === input.urgencyCode)) {
    errors.urgencyCode = "Pick an urgency."
  }
  return errors
}

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

/**
 * THE event-name rule: "TICKER - Location - Dates", single spaces, blank parts
 * dropped (the clean form of Dynamics' "TICKER - Place - dates"). TICKER is the
 * client's ticker (its name when it has none); Dates is the free-text Dates
 * field as typed. Shown read-only in the form; the server rebuilds it from the
 * raw fields on every save, so the browser never sets a name.
 */
export function buildEventName(
  ticker: string | null | undefined,
  location: string | null | undefined,
  dates: string | null | undefined,
): string {
  return [ticker, location, dates]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" - ")
}

export type NewEventInput = {
  /** accounts.account_id — REQUIRED. */
  clientAccountId: string | null
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
  // No people here: Account Manager / Logistics Coordinator / Feedback Report
  // are COPIED from the client's account team at create (createEvent), and the
  // Feedback Team is left blank. The columns stay for history.
  leadCodes: string[]
  eventParameters?: string
  urgencyCode?: number | null
  /** YYYY-MM-DD (Eastern) */
  launchWeek?: string
  // Last Data Upload, Memo Date and Targeting Date are LOOKED UP from the
  // client's tasks (EVENT_TASK_DATE_SUBTYPES), never typed. Shareholder Report
  // Received is no longer on the form; its column is kept.
  targetingNotRequired: boolean
  memoNotRequired: boolean
  targetingUrl?: string
  profileLink?: string
  targetingNotes?: string
  /** The three lifecycle toggles. With the event's meetings and feedback
   *  tasks they DRIVE the computed stage. */
  launch: boolean
  outreachComplete: boolean
  /** Overrides everything → "Pause"; un-pausing resumes the computed stage. */
  paused: boolean
  /** Company representatives — existing contacts, saved to event_contacts. */
  representatives: EventRepresentative[]
  isTest: boolean
}

/**
 * The event-record drawer's data shape and its FIELD DEFINITIONS.
 *
 * Same contract as lib/meeting-record.ts: every section of the drawer renders
 * from the `EVENT_SECTIONS` list below — `{ label, sourceKey, type }` per field
 * — rather than hand-written JSX per field, and the table's column catalog is
 * DERIVED from the same list (lib/events/columns.ts) so the two can never drift.
 *
 * ── EDIT-READY BY DESIGN, NOT EDITABLE ─────────────────────────────────────
 * Nothing here is writable in this pass: the pane renders each field read-only,
 * there is no form state and no write-back. The indirection is what makes
 * turning the drawer into a real editor a LOCALIZED change — swap the read-only
 * renderer for an input keyed off `type`, add form state, add a save action. The
 * section layout, labels and ordering do not move.
 *
 * Do NOT add editing without the dashboard actually becoming the system of
 * record. Today Dynamics is, and everything in this app is read-only.
 * UPDATE 2026-09-23: records the DASHBOARD created (origin='dashboard') ARE
 * editable — via the entity's Add New form in edit mode and updateDashboardRow
 * (lib/crm-write.ts), which refuses any Dynamics row server-side. Rows synced
 * from Dynamics stay read-only until cutover. See docs/22.
 *
 * ── TWO SOURCING NOTES ─────────────────────────────────────────────────────
 * MEMO = TEASER. The drawer asks for "Memo Date" and "Memo Not Required".
 * public.events has no memo_* columns; it has teaser_date and
 * teaser_not_required. Rose's CRM calls the artefact a teaser, this page calls
 * it a memo. Mapped on that assumption — if it is wrong, fix the two aliases in
 * sql/patches/2026-09-10_admin_events.sql and the two labels here.
 *
 * ACCOUNT MANAGER = sales_lead_primary, not the events.manager lookup, which is
 * empty on all 968 live rows. See the same patch header.
 */

/** One event, flattened for display. Keys are the field definitions' sourceKeys. */
export type EventRecord = {
  /** bcs_mining (flattened) — true drops the event from Live Outreach. Read off the table. */
  mining?: boolean | null
  /** 'dashboard' = editable in the drawer; 'dynamics' = read-only until cutover. */
  origin?: string | null
  /** Dashboard-created test row (drawer TEST badge). */
  is_test?: boolean
  event_id: string
  /** Drives the Client headline link; null when the event has no account. */
  client_account_id: string | null

  // Header
  event_title: string | null
  event_state_label: string | null
  marketing_state_label: string | null

  // General
  client_account_name: string | null
  event_location: string | null
  tbc: boolean | null
  event_dates: string | null
  account_manager_name: string | null
  logistics_coordinator_name: string | null
  feedback_team_name: string | null
  feedback_report_name: string | null
  leads_labels: string | null
  team: boolean | null
  event_notes: string | null
  meetings_start: string | null
  meetings_end: string | null

  // Planning
  event_parameters: string | null
  of_slots: number | null
  urgency_label: string | null
  launch_week: string | null
  memo_date: string | null
  last_data_upload: string | null
  shareholder_report_received_date: string | null
  targeting_not_required: boolean | null
  memo_not_required: boolean | null
  targeting_date: string | null
  targeting_url: string | null
  profile_link: string | null
  targeting_notes: string | null
  launch: boolean | null
  outreach_complete: boolean | null

  // Capacity — the drawer's stat row. Computed in the view; see
  // sql/patches/2026-09-10_admin_events_slots.sql. `of_slots` is already
  // declared above (it is also the Planning section's "# of Slots" field).
  confirmed_meetings: number | null
  slots_remaining: number | null

  // List-only / system
  user_team_lead: string | null
  client_ticker: string | null
  state_label: string | null
  created_on: string | null
  modified_on: string | null
}

/**
 * How a field is rendered — and, later, what input it would become:
 *   text   plain value            -> text input / select
 *   date   timestamp, Eastern     -> date picker
 *   person one or more people     -> user picker (renders avatar + full name)
 *   toggle Yes/No boolean         -> switch
 *   notes  long free text         -> textarea (always full-width)
 *   link   a URL that navigates   -> text input plus the link
 */
export type EventFieldType = "text" | "date" | "person" | "toggle" | "notes" | "link"

export type EventFieldDef = {
  label: string
  sourceKey: keyof EventRecord
  type: EventFieldType
}

export type EventSectionDef = {
  key: string
  title: string
  fields: EventFieldDef[]
}

/**
 * The drawer's sections, in order.
 *
 * Company Representatives and Company Preferences are deliberately ABSENT in
 * v1: both are related contact records, and contacts are not confirmed synced.
 * Adding them later means one more section here plus its columns — no change to
 * the drawer, the catalog, or the table.
 */
export const EVENT_SECTIONS: EventSectionDef[] = [
  {
    key: "general",
    title: "General",
    fields: [
      { label: "Client", sourceKey: "client_account_name", type: "link" },
      { label: "Location", sourceKey: "event_location", type: "text" },
      { label: "TBC", sourceKey: "tbc", type: "toggle" },
      { label: "Mining (excluded from Live Outreach)", sourceKey: "mining", type: "toggle" },
      { label: "Dates", sourceKey: "event_dates", type: "text" },
      { label: "Account Manager", sourceKey: "account_manager_name", type: "person" },
      { label: "Logistics Coordinator", sourceKey: "logistics_coordinator_name", type: "person" },
      { label: "Feedback Team", sourceKey: "feedback_team_name", type: "text" },
      { label: "Feedback Report", sourceKey: "feedback_report_name", type: "person" },
      { label: "Lead(s)", sourceKey: "leads_labels", type: "text" },
      { label: "Team?", sourceKey: "team", type: "toggle" },
      { label: "Event Notes", sourceKey: "event_notes", type: "notes" },
      { label: "Meetings Start", sourceKey: "meetings_start", type: "date" },
      { label: "Meetings End", sourceKey: "meetings_end", type: "date" },
    ],
  },
  {
    key: "planning",
    title: "Planning",
    fields: [
      { label: "Event Parameters", sourceKey: "event_parameters", type: "text" },
      { label: "# of Slots", sourceKey: "of_slots", type: "text" },
      { label: "Urgency", sourceKey: "urgency_label", type: "text" },
      { label: "Launch Week", sourceKey: "launch_week", type: "date" },
      // MEMO = teaser — see the header note.
      { label: "Memo Date", sourceKey: "memo_date", type: "date" },
      { label: "Last Data Upload", sourceKey: "last_data_upload", type: "date" },
      {
        label: "Shareholder Report Received",
        sourceKey: "shareholder_report_received_date",
        type: "date",
      },
      { label: "Targeting Not Required", sourceKey: "targeting_not_required", type: "toggle" },
      { label: "Memo Not Required", sourceKey: "memo_not_required", type: "toggle" },
      { label: "Targeting Date", sourceKey: "targeting_date", type: "date" },
      { label: "Targeting URL", sourceKey: "targeting_url", type: "link" },
      { label: "Profile Link", sourceKey: "profile_link", type: "link" },
      { label: "Targeting Notes", sourceKey: "targeting_notes", type: "notes" },
      { label: "Launch", sourceKey: "launch", type: "toggle" },
      { label: "Outreach Complete", sourceKey: "outreach_complete", type: "toggle" },
    ],
  },
]

/** The header strip above the sections. */
export const EVENT_HEADER_FIELDS: EventFieldDef[] = [
  { label: "Event State", sourceKey: "event_state_label", type: "text" },
  { label: "Marketing State", sourceKey: "marketing_state_label", type: "text" },
]

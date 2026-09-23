/**
 * The meeting-record drawer's data shape and its FIELD DEFINITIONS.
 *
 * ── EDIT-READY BY DESIGN ───────────────────────────────────────────────────
 * Every section of the drawer is rendered from the `MEETING_SECTIONS` list
 * below — `{ label, sourceKey, type }` per field — rather than from hand-written
 * JSX per field. Nothing is editable in this pass: the pane renders each field
 * read-only, there is no form state and no write-back.
 *
 * The point of the indirection is that turning the drawer into a real editor
 * later is a LOCALIZED change: swap the read-only renderer in
 * app/meetings/meeting-record-pane.tsx for an input keyed off `type`, add form
 * state, and add a save action. The section/field layout, labels and ordering do
 * not move, and no section has to be rewritten. `type` is what a future input
 * would switch on, which is why toggles and people are already distinguished
 * from plain text even though today they all render as static values.
 *
 * Do NOT add editing here without the dashboard actually becoming the system of
 * record — today Dynamics is, and everything in this app is read-only.
 */

/** One meeting, flattened for display. Keys are the field definitions' sourceKeys. */
export type MeetingRecord = {
  /** 'dashboard' = editable in the drawer; 'dynamics' = read-only until cutover. */
  origin?: string | null
  /** Dashboard-created test row (drawer TEST badge). */
  is_test?: boolean
  meeting_id: string
  /** Drives the Client headline link; null when the meeting has no account. */
  client_account_id: string | null

  // Overview
  date_time: string | null
  meeting_type: string | null
  status: string | null
  investor: string | null
  client: string | null
  institution: string | null
  city: string | null
  state_region: string | null
  group_meeting: boolean | null
  hosted_in_hq: boolean | null
  general_notes: string | null

  // Representatives
  booked_by: string | null
  on_behalf_of: string | null
  /** Comma-separated when a meeting has more than one host. */
  hosts: string | null
  feedback_assignee: string | null
  client_booked: boolean | null
  host_notes: string | null

  // Planning
  calendar: string | null
  profile: string | null

  // Feedback
  /** bcs_feedbackstatus — closes meeting-level feedback (drives Feedback Collection). */
  feedback_status: string | null
  fb_in_bda: string | null
  fb_received: string | null
  feedback_notes: string | null

  // Logistics (Live meetings only)
  is_live: boolean
  sent: boolean | null
  confirm: boolean | null
  food_order: string | null
  driver: boolean | null
  logistics_notes: string | null

  // System
  modified_by: string | null
  modified_on: string | null
  created_by: string | null
  created_on: string | null
}

/**
 * How a field is rendered — and, later, what input it would become:
 *   text   plain value            -> text input / select
 *   date   timestamp, Eastern     -> date-time picker
 *   person one or more people     -> user picker (renders avatar + full name)
 *   toggle Yes/No boolean         -> switch
 *   notes  long free text         -> textarea (always full-width)
 *   link   value that navigates   -> text input plus the link
 */
export type MeetingFieldType = "text" | "date" | "person" | "toggle" | "notes" | "link"

export type MeetingFieldDef = {
  label: string
  sourceKey: keyof MeetingRecord
  type: MeetingFieldType
}

export type MeetingSectionDef = {
  key: string
  title: string
  fields: MeetingFieldDef[]
  /**
   * Only render this section's fields when the record satisfies this. Used by
   * Logistics, which applies to Live meetings only; when it returns false the
   * pane shows `emptyNote` instead of the fields.
   */
  appliesTo?: (r: MeetingRecord) => boolean
  emptyNote?: string
}

export const MEETING_SECTIONS: MeetingSectionDef[] = [
  {
    key: "overview",
    title: "Overview",
    fields: [
      { label: "Date & Time", sourceKey: "date_time", type: "date" },
      { label: "Meeting Type", sourceKey: "meeting_type", type: "text" },
      { label: "Status", sourceKey: "status", type: "text" },
      { label: "Investor", sourceKey: "investor", type: "text" },
      { label: "Client", sourceKey: "client", type: "link" },
      { label: "Institution", sourceKey: "institution", type: "text" },
      { label: "City", sourceKey: "city", type: "text" },
      { label: "State / Region", sourceKey: "state_region", type: "text" },
      { label: "Group Meeting", sourceKey: "group_meeting", type: "toggle" },
      { label: "Hosted in HQ", sourceKey: "hosted_in_hq", type: "toggle" },
      { label: "General Notes", sourceKey: "general_notes", type: "notes" },
    ],
  },
  {
    key: "representatives",
    title: "Representatives",
    fields: [
      { label: "Booked By", sourceKey: "booked_by", type: "person" },
      { label: "On Behalf Of", sourceKey: "on_behalf_of", type: "person" },
      { label: "Host", sourceKey: "hosts", type: "person" },
      { label: "Feedback", sourceKey: "feedback_assignee", type: "person" },
      { label: "Client Booked", sourceKey: "client_booked", type: "toggle" },
      { label: "Host Notes", sourceKey: "host_notes", type: "notes" },
    ],
  },
  {
    key: "planning",
    title: "Planning",
    fields: [
      { label: "Calendar", sourceKey: "calendar", type: "text" },
      { label: "Profile", sourceKey: "profile", type: "text" },
    ],
  },
  {
    key: "feedback",
    title: "Feedback",
    fields: [
      // Feedback Status is the ONE field that closes meeting-level feedback
      // (v_feedback_outstanding). The other two are informational only.
      { label: "Feedback Status (closes feedback)", sourceKey: "feedback_status", type: "text" },
      { label: "FB in BDA (info only)", sourceKey: "fb_in_bda", type: "text" },
      { label: "FB Rec'd (info only)", sourceKey: "fb_received", type: "text" },
      { label: "Feedback Notes", sourceKey: "feedback_notes", type: "notes" },
    ],
  },
  {
    key: "logistics",
    title: "Logistics · Live meetings",
    // These five fields only apply to in-person meetings; the same rule Planning
    // V2 uses to hatch out the block on a virtual row.
    appliesTo: (r) => r.is_live,
    emptyNote: "Not applicable — this is a virtual meeting.",
    fields: [
      { label: "Sent", sourceKey: "sent", type: "toggle" },
      { label: "Confirm", sourceKey: "confirm", type: "toggle" },
      { label: "Driver", sourceKey: "driver", type: "toggle" },
      { label: "Food Order", sourceKey: "food_order", type: "text" },
      { label: "Logistics Notes", sourceKey: "logistics_notes", type: "notes" },
    ],
  },
  {
    key: "system",
    title: "System",
    fields: [
      { label: "Modified By", sourceKey: "modified_by", type: "person" },
      { label: "Modified On", sourceKey: "modified_on", type: "date" },
      { label: "Created By", sourceKey: "created_by", type: "person" },
      { label: "Created On", sourceKey: "created_on", type: "date" },
    ],
  },
]

/**
 * The touchpoint-record drawer's data shape and its FIELD DEFINITIONS.
 *
 * Same contract as lib/tasks/record.ts, lib/events/record.ts and
 * lib/meeting-record.ts: every section of the drawer renders from the
 * `TOUCHPOINT_SECTIONS` list below — `{ label, sourceKey, type }` — rather than
 * hand-written JSX per field, and the table's column catalog is DERIVED from the
 * same list (lib/touchpoints/spec.ts) so the two can never drift.
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
 * ── WHAT A TOUCH IS (display name "Touches"; internals stay "touchpoints") ─
 * public.touchpoints is the mirror of the Dynamics `phonecall` entity, relabelled
 * because Rose logs every client contact as one — the live Type breakdown is
 * Virtual 946 / Email 94 / In-Person 71 / Social 10 / Onboarding Call 9 /
 * Teach-in 4, so most of them are not phone calls at all.
 *
 * ── SOURCING NOTES (three traps; the full measurements are in the patch) ───
 * OWNER IS A TEAM. `owner_team_name` is a per-account Dynamics team named after
 * the CLIENT, not a staff member — it equals the client name on ~94% of rows and
 * none of its ids resolve to public.users. It is kept in the drawer, under its
 * real name, because hiding it would just make someone go looking for it. The
 * person who actually did the work is CREATED BY.
 *
 * NO CONTACT PERSON EXISTS. `contact_type_label` is WHICH ROLE was spoken to
 * (IRO / CEO / CFO / Other), semicolon-joined for multi-select, populated on 49%
 * of rows. There is no contact name anywhere in the entity: `regarding_id` is the
 * account, and the sync does not expand the activityparty collections, so the
 * `from`/`to` party lists are absent from `_raw` entirely.
 *
 * DIRECTION IS A CONSTANT. `direction_label` is "Outgoing" on all 1,141 live
 * rows. Shown because it is a field the brief asked for and an inbound row would
 * render correctly; it carries no signal today.
 *
 * MODIFIED BY comes from `_raw` (the mirror flattens created_by but not
 * modified_by) — dug out in the view, so it is a plain column by the time the
 * drawer sees it. See sql/patches/2026-09-15_admin_touchpoints.sql.
 */

/** One touchpoint, flattened for display. Keys are the field definitions' sourceKeys. */
export type TouchpointRecord = {
  /** 'dashboard' = editable in the drawer; 'dynamics' = read-only until cutover. */
  origin?: string | null
  touchpoint_id: string
  /** Drives the Client link; null on the 2% of rows carrying no account. */
  client_account_id: string | null

  // Touchpoint
  subject: string | null
  description: string | null
  touchpoint_type_label: string | null
  contact_type_label: string | null
  direction_label: string | null
  status_label: string | null
  state_label: string | null
  touchpoint_date: string | null
  scheduled_end: string | null
  duration_minutes: number | null

  // Client
  client_account_name: string | null
  client_ticker: string | null
  regarding_id: string | null

  // People
  created_by_name: string | null
  created_by_id: string | null
  modified_by_name: string | null
  owner_team_name: string | null

  // System
  created_on: string | null
  modified_on: string | null
  is_recent: boolean | null

  // Catalog-only raw codes (see LIST_ONLY in ./spec.ts)
  touchpoint_type_code: number | null
  contact_type_code: number | null
  state_code: number | null
  status_code: number | null
  direction_code: boolean | null
  /** Dashboard-created test row (drawer TEST badge). */
  is_test?: boolean
}

/**
 * How a field is rendered — and, later, what input it would become:
 *   text   plain value            -> text input / select
 *   date   timestamp, Eastern     -> date picker
 *   person one or more people     -> user picker (renders avatar + full name)
 *   toggle Yes/No boolean         -> switch
 *   notes  long free text         -> textarea (always full-width)
 *   link   a URL or a record link -> text input plus the link
 */
export type TouchpointFieldType = "text" | "date" | "person" | "toggle" | "notes" | "link"

export type TouchpointFieldDef = {
  label: string
  sourceKey: keyof TouchpointRecord
  type: TouchpointFieldType
}

export type TouchpointSectionDef = {
  key: string
  title: string
  fields: TouchpointFieldDef[]
}

/**
 * The drawer's sections, in order — Touch, Client & Contact, People, System.
 *
 * `duration_minutes` is declared `text` rather than a number type: the drawer
 * paints it as a plain value, and the FILTER type is overridden to `number` in
 * lib/touchpoints/spec.ts so the operator list stays integer-safe. Same split the
 * Tasks spec uses for `percent_complete` and the Events spec for `of_slots`.
 */
export const TOUCHPOINT_SECTIONS: TouchpointSectionDef[] = [
  {
    key: "touchpoint",
    title: "Touch",
    fields: [
      { label: "Subject", sourceKey: "subject", type: "text" },
      { label: "Notes", sourceKey: "description", type: "notes" },
      { label: "Type", sourceKey: "touchpoint_type_label", type: "text" },
      { label: "Date", sourceKey: "touchpoint_date", type: "date" },
      { label: "Direction", sourceKey: "direction_label", type: "text" },
      { label: "Status", sourceKey: "status_label", type: "text" },
      { label: "State", sourceKey: "state_label", type: "text" },
      { label: "Duration (min)", sourceKey: "duration_minutes", type: "text" },
    ],
  },
  {
    key: "client",
    title: "Client & Contact",
    fields: [
      { label: "Client", sourceKey: "client_account_name", type: "link" },
      // A ROLE, not a person — and the only contact information this entity has.
      { label: "Contact Type", sourceKey: "contact_type_label", type: "text" },
    ],
  },
  {
    key: "people",
    title: "People",
    fields: [
      { label: "Created By", sourceKey: "created_by_name", type: "person" },
      { label: "Modified By", sourceKey: "modified_by_name", type: "person" },
      // A per-account team named after the client, NOT a staff member.
      { label: "Owner Team", sourceKey: "owner_team_name", type: "text" },
    ],
  },
  {
    key: "system",
    title: "System",
    fields: [
      { label: "Created On", sourceKey: "created_on", type: "date" },
      { label: "Modified On", sourceKey: "modified_on", type: "date" },
      // Identical to the Date on every live row; kept so the drawer shows the
      // whole record rather than a curated subset.
      { label: "Scheduled End", sourceKey: "scheduled_end", type: "date" },
    ],
  },
]

/**
 * The header strip above the sections: Type · Contact Type, then Status.
 * The Subject is the headline itself and is rendered by the pane, not from here.
 */
export const TOUCHPOINT_HEADER_FIELDS: TouchpointFieldDef[] = [
  { label: "Type", sourceKey: "touchpoint_type_label", type: "text" },
  { label: "Contact Type", sourceKey: "contact_type_label", type: "text" },
  { label: "Status", sourceKey: "status_label", type: "text" },
]

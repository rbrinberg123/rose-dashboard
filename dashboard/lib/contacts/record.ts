/**
 * The contact-record drawer's data shape and its FIELD DEFINITIONS.
 *
 * Same contract as lib/notes/record.ts, lib/touchpoints/record.ts,
 * lib/tasks/record.ts, lib/events/record.ts and lib/meeting-record.ts: every
 * section of the drawer renders from the `CONTACT_SECTIONS` list below —
 * `{ label, sourceKey, type }` — rather than hand-written JSX per field, and the
 * table's column catalog is DERIVED from the same list (lib/contacts/spec.ts) so
 * the two can never drift.
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
 * ── WHAT A CONTACT IS ──────────────────────────────────────────────────────
 * public.contacts mirrors the Dynamics `contact` entity: the PEOPLE at client
 * companies. Sixth CRM table, and the only one that is mostly personal data —
 * names, job titles, employers, a do-not-call flag. That is why /contacts is in
 * ADMIN_ONLY_ROUTES and why every server action re-checks the role.
 *
 * ── TWO THINGS TO KNOW ABOUT THE DATA ──────────────────────────────────────
 *
 * 1. THE CLIENT LINK IS PROVISIONAL. A contact carries two candidate pointers at
 *    a client account — `parent_customer_id` ("Company Name") and
 *    `company_master_record_id` ("Master Company Record") — and which one is
 *    canonical has not been decided. The page resolves the client through the
 *    FIRST, isolated inside one LATERAL in
 *    sql/patches/2026-09-16_admin_contacts.sql so switching is a one-line
 *    change. Both are exposed as columns either way.
 *
 *    `parent_customer_id` is also POLYMORPHIC — in Dynamics it points at either
 *    an account or a contact — so the view's join is guarded on
 *    `parent_customer_type = 'account'`. A contact whose parent is another
 *    contact shows the parent's NAME with no client link, which is correct.
 *
 * 2. THE CHOICE-FIELD LABELS MAY BE EMPTY. contact_type, industry,
 *    internal_assignment, lead_state, state_for_address and last_activity_type
 *    were modeled as Dynamics option sets without being able to read the
 *    metadata first (see sql/23_contacts_table.sql). If any is really a text or
 *    lookup attribute, its `_code` column rejects the value at sync time and the
 *    row lands in `sync_errors` — so a column that is empty on EVERY row is a
 *    signal to check /admin, not necessarily a signal that the CRM is blank.
 */

/** One contact, flattened for display. Keys are the field definitions' sourceKeys. */
export type ContactRecord = {
  /** 'dashboard' = editable in the drawer; 'dynamics' = read-only until cutover. */
  origin?: string | null
  contact_id: string

  // The person
  full_name: string | null
  first_name: string | null
  last_name: string | null
  job_title: string | null

  // Client link — both candidates, plus the resolved account
  parent_customer_id: string | null
  parent_customer_name: string | null
  parent_customer_type: string | null
  company_master_record_id: string | null
  company_master_record_name: string | null
  /** Drives the Client link. Null when the parent is not a matched account. */
  client_account_id: string | null
  client_account_name: string | null
  client_ticker: string | null

  // Contact info (flattened 2026-09-16 — see the header)
  email: string | null
  mobile_phone: string | null
  direct_phone: string | null
  city: string | null
  street: string | null

  // Profile
  contact_type_label: string | null
  industry_label: string | null
  internal_assignment_label: string | null
  lead_state_label: string | null
  state_for_address_label: string | null
  previous_company: string | null
  ticker_symbol: string | null

  // Flags
  ir_only: boolean | null
  poc: boolean | null
  do_not_call: boolean | null
  distribution_list: boolean | null
  ex_employee: boolean | null

  // Activity
  last_activity_subject: string | null
  last_activity_type_label: string | null
  last_activity_time: string | null
  verified_on: string | null

  // Status
  is_active: boolean | null
  state_code: number | null
  state_label: string | null
  status_code: number | null
  status_label: string | null

  // System
  owner_id: string | null
  owner_name: string | null
  created_by_id: string | null
  created_by_name: string | null
  modified_by_id: string | null
  modified_by_name: string | null
  created_on: string | null
  modified_on: string | null

  /**
   * The complete Dynamics payload, loaded ONLY by the drawer's single-row query
   * and never by the list (see app/contacts/actions.ts).
   *
   * Nothing renders it today. It is fetched because the mirror deliberately
   * leaves a set of fields unflattened — the activity-pointer lookups (last
   * appointment / email / phone / task activity), primary opportunity, segment
   * id, the country lookup and parent_contactid — and this is where they live if
   * any of them earns a field later. See sql/23_contacts_table.sql.
   */
  _raw: Record<string, unknown> | null
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
export type ContactFieldType = "text" | "date" | "person" | "toggle" | "notes" | "link"

export type ContactFieldDef = {
  label: string
  sourceKey: keyof ContactRecord
  type: ContactFieldType
}

export type ContactSectionDef = {
  key: string
  title: string
  fields: ContactFieldDef[]
}

/**
 * The drawer's sections, in order — Overview, Flags, Activity, System.
 *
 * `full_name` is declared `person` so it draws the same initials circle the
 * table uses. Every other CRM drawer resolves a person against a systemuser;
 * here the person IS the record, which is why the avatar is on the name field
 * rather than on an owner field.
 */
export const CONTACT_SECTIONS: ContactSectionDef[] = [
  {
    key: "overview",
    title: "Overview",
    fields: [
      { label: "Full Name", sourceKey: "full_name", type: "person" },
      { label: "Job Title", sourceKey: "job_title", type: "text" },
      // Resolves through parent_customer — see the header. Renders as a link to
      // the client's detail page only when the parent matched a real account.
      { label: "Client", sourceKey: "parent_customer_name", type: "link" },
      { label: "Contact Type", sourceKey: "contact_type_label", type: "text" },
      { label: "Industry", sourceKey: "industry_label", type: "text" },
      { label: "Lead State", sourceKey: "lead_state_label", type: "text" },
      { label: "Active/Inactive", sourceKey: "state_label", type: "text" },
    ],
  },
  {
    key: "contact_info",
    title: "Contact Info",
    fields: [
      // Flattened 2026-09-16. The mirror previously held none of these — a
      // contacts table with no way to contact anyone. Email is populated on
      // ~77% of rows; the phones are thinner (~17% / ~12%).
      { label: "Email", sourceKey: "email", type: "text" },
      { label: "Mobile", sourceKey: "mobile_phone", type: "text" },
      { label: "Direct Line", sourceKey: "direct_phone", type: "text" },
      { label: "City", sourceKey: "city", type: "text" },
      { label: "Street", sourceKey: "street", type: "text" },
    ],
  },
  {
    key: "flags",
    title: "Flags",
    fields: [
      { label: "IR Only", sourceKey: "ir_only", type: "toggle" },
      { label: "PoC", sourceKey: "poc", type: "toggle" },
      { label: "Do Not Call", sourceKey: "do_not_call", type: "toggle" },
      { label: "Distribution List", sourceKey: "distribution_list", type: "toggle" },
      { label: "Ex-Employee", sourceKey: "ex_employee", type: "toggle" },
    ],
  },
  {
    key: "activity",
    title: "Activity",
    fields: [
      // The contact's own last-activity summary, as Dynamics computed it. This
      // is NOT the same thing as joining to tasks/touchpoints: those are tagged
      // to accounts and events, essentially never to contacts (two rows in the
      // entire mirror). These three fields are the only contact-level activity
      // signal that exists today.
      { label: "Last Activity Subject", sourceKey: "last_activity_subject", type: "text" },
      { label: "Last Activity Type", sourceKey: "last_activity_type_label", type: "text" },
      { label: "Last Activity Time", sourceKey: "last_activity_time", type: "date" },
      { label: "Verified On", sourceKey: "verified_on", type: "date" },
      { label: "Previous Company", sourceKey: "previous_company", type: "text" },
      // The contact's OWN ticker field, distinct from the client's ticker that
      // the Client column links through.
      { label: "Ticker Symbol", sourceKey: "ticker_symbol", type: "text" },
    ],
  },
  {
    key: "system",
    title: "System",
    fields: [
      // Provenance. "Owner" is the record's owner in Dynamics; Created/Modified
      // By answer "who last touched this?", pairing with the dashboard's own
      // audit_log (which records who changed something HERE).
      { label: "Owner", sourceKey: "owner_name", type: "person" },
      { label: "Created By", sourceKey: "created_by_name", type: "person" },
      { label: "Created On", sourceKey: "created_on", type: "date" },
      { label: "Modified By", sourceKey: "modified_by_name", type: "person" },
      { label: "Modified On", sourceKey: "modified_on", type: "date" },
    ],
  },
]

/**
 * The header strip above the sections: Job Title, then Contact Type.
 * The contact's NAME is the headline itself and is rendered by the pane.
 */
export const CONTACT_HEADER_FIELDS: ContactFieldDef[] = [
  { label: "Job Title", sourceKey: "job_title", type: "text" },
  { label: "Contact Type", sourceKey: "contact_type_label", type: "text" },
]

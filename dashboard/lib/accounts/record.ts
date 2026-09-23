/**
 * The client-record drawer's data shape and its FIELD DEFINITIONS.
 *
 * Same contract as lib/contacts/record.ts, lib/notes/record.ts,
 * lib/touchpoints/record.ts, lib/tasks/record.ts, lib/events/record.ts and
 * lib/meeting-record.ts: every section of the drawer renders from the
 * `ACCOUNT_SECTIONS` list below — `{ label, sourceKey, type }` — rather than
 * hand-written JSX per field, and the table's column catalog is DERIVED from the
 * same list (lib/accounts/spec.ts) so the two can never drift.
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
 *
 * ── WHAT A CLIENT IS, AND WHAT THIS PAGE IS NOT ────────────────────────────
 * public.accounts mirrors the Dynamics `account` entity: Rose's clients, the
 * issuers. Seventh CRM table.
 *
 * It is NOT the Portfolio client table. /portfolio reads v_client_portfolio —
 * an ANALYTICS rollup over active clients only, carrying meeting counts,
 * retainers, open slots and a latest note status, none of which live on the
 * account row. This page is the RECORD: every account, active and inactive,
 * with its own fields. Both exist on purpose; neither replaces the other.
 *
 * ── THREE THINGS TO KNOW ABOUT THE DATA ────────────────────────────────────
 *
 * 1. THERE ARE THREE DIFFERENT "STATUS" FIELDS AND THEY DISAGREE.
 *      state_label          Dynamics statecode — Active / Inactive. THIS is what
 *                           the default view filters on, and what ~15 views in
 *                           sql/03_views.sql already mean by "active client".
 *      client_status_label  a Rose business field — Current / Past / blank. It
 *                           disagrees with the Dynamics state on 33 accounts.
 *      status_label         the Dynamics statuscode, perfectly redundant with
 *                           state_label today.
 *    All three are shown, in that order, so the disagreement is visible rather
 *    than resolved behind the reader's back. A fourth flag exists —
 *    public.account_status, dashboard-owned — which is setup-only, read by
 *    nothing but /admin/account-teams, and deliberately absent here.
 *
 * 2. THE ACCOUNT TEAM IS DISPLAYED, NOT DECIDED. These five name fields come
 *    straight off `accounts` — the same Dynamics columns the Portfolio and
 *    Events avatar clusters already draw. public.account_team_members is a
 *    SECOND, dashboard-owned team table that is wired to nothing; which of the
 *    two becomes the source of truth is an open question and is not answered by
 *    this page. Read-only either way.
 *
 * 3. THE ENGAGEMENT DATES ARE DYNAMICS' OWN ROLLUPS. last_touchpoint_date,
 *    last_event_date, days_since_last_review and friends are computed in the
 *    CRM and passed through unchanged. They are known to lag what
 *    public.meetings and public.events actually contain. On a system-of-record
 *    page that is the right thing to show — it is what the CRM believes — but do
 *    not treat them as reporting figures. Portfolio computes its own counts off
 *    public.meetings for exactly this reason.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
 * Contract, retainer and days-left do NOT appear. They are not accounts columns
 * — they live on public.contracts — and this pass is restricted to fields
 * already flattened onto the account row. Retainer/fee is additionally a
 * field-level permission (see the Financials grant), which is a second reason
 * not to smuggle it onto an unscoped CRM table. So are the ~40 still-unflattened
 * accounts fields (the staff-initials cluster, address1_*, …); that is a
 * separate, dedicated accounts flatten pass.
 */

/** One client, flattened for display. Keys are the field definitions' sourceKeys. */
export type AccountRecord = {
  account_id: string

  /**
   * The app-facing client triple. On this entity they are the account's own id,
   * name and ticker under the names every other admin view uses — which is what
   * lets the shared ticker renderer and the /client-detail link work unchanged.
   */
  client_account_id: string | null
  client_account_name: string | null
  client_ticker: string | null

  // Identity
  name: string | null
  ticker_symbol: string | null
  ipreo_ticker: string | null
  website_url: string | null
  email: string | null
  company_master_id: string | null
  company_master_name: string | null

  // Classification
  client_status_label: string | null
  client_status_code: number | null
  sector_label: string | null
  industry_option_label: string | null
  fs_sector: string | null
  fs_industry: string | null
  exchange_label: string | null

  // Size
  market_cap_b: number | null
  /** Derived in the view. Mega / Large / Mid / Small / Micro — Portfolio's buckets. */
  market_cap_label: string | null

  // Geography
  hq_country_name: string | null
  /** Derived in the view. Americas / APAC / EMEA — Portfolio's buckets. */
  region_label: string | null
  city: string | null
  state_province: string | null
  country: string | null

  // Account team (Dynamics, read-only)
  sales_lead_primary_id: string | null
  sales_lead_primary_name: string | null
  secondary_manager_id: string | null
  secondary_manager_name: string | null
  associate_id: string | null
  associate_name: string | null
  feedback_report_id: string | null
  feedback_report_name: string | null
  logistics_coordinator_id: string | null
  logistics_coordinator_name: string | null
  targeting_id: string | null
  targeting_name: string | null
  teaser_id: string | null
  teaser_name: string | null
  primary_contact_id: string | null
  primary_contact_name: string | null
  owner_id: string | null
  owner_name: string | null

  // Engagement — Dynamics rollups, passed through. See the header.
  current_event_id: string | null
  current_event_name: string | null
  current_project_id: string | null
  current_project_name: string | null
  last_touchpoint_date: string | null
  next_touchpoint_date: string | null
  last_event_date: string | null
  next_event_date: string | null
  ongoing_event_date: string | null
  last_targeting_date: string | null
  last_teaser_date: string | null
  days_since_last_review: number | null
  original_start_date: string | null
  onboarding_call: string | null
  last_data_upload: string | null
  teach_in: string | null
  teach_in_date: string | null
  shareholder_report_received_date: string | null

  // Flags
  do_not_call: boolean | null
  ir_only: boolean | null
  bda_peers: boolean | null
  calendar: boolean | null
  calendar_confirmed: boolean | null
  distro: boolean | null
  meeting_history_received: boolean | null
  mgmt_review: boolean | null
  recurring_call_scheduled: boolean | null
  report: boolean | null
  rep_short_interest: boolean | null
  sh_report: boolean | null

  // Free text
  dietary_restrictions: string | null
  onboarding_notes: string | null
  peers: string | null

  // Status
  is_active: boolean | null
  state_code: number | null
  state_label: string | null
  status_code: number | null
  status_label: string | null

  // System
  created_by_id: string | null
  created_by_name: string | null
  modified_by_id: string | null
  modified_by_name: string | null
  created_on: string | null
  modified_on: string | null

  /**
   * The complete Dynamics payload, loaded ONLY by the drawer's single-row query
   * and never by the list (see app/accounts/actions.ts).
   *
   * Nothing renders it today. It is fetched because the mirror still leaves ~40
   * accounts fields unflattened — the staff-initials cluster, the address1_*
   * block, and others — and this is where they live until the dedicated accounts
   * flatten pass promotes the ones worth a field.
   */
  _raw: Record<string, unknown> | null

  // ---- flattened 2026-09-23g (sql/patches/2026-09-23g_accounts_full_fields.sql) ----
  /** Primary address (address1_*), falling back to address2 in the view. */
  street?: string | null
  postal_code?: string | null
  phone?: string | null
  secondary_exchange_label?: string | null
  hq_state_label?: string | null
  reporting_frequency_label?: string | null
  /** Dynamics time-zone index (e.g. 35 = Eastern, 85 = GMT/London). */
  timezone_code?: number | null
  meeting_slot_minutes?: number | null
  meeting_platform_pref?: string | null
  div_yield?: number | null
  targeting_parameters?: string | null
  additional_notes?: string | null
  estimates?: boolean | null
  include_admin?: boolean | null
  exclude_from_distribution?: boolean | null
  contact_ir_only?: boolean | null
  /** 'dashboard' = editable in the drawer; 'dynamics' = read-only until cutover. */
  origin?: string | null
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
 *   number a figure               -> number input
 */
export type AccountFieldType =
  | "text"
  | "date"
  | "person"
  | "toggle"
  | "notes"
  | "link"
  | "number"

export type AccountFieldDef = {
  label: string
  sourceKey: keyof AccountRecord
  type: AccountFieldType
}

export type AccountSectionDef = {
  key: string
  title: string
  fields: AccountFieldDef[]
}

/**
 * The drawer's sections, in order — Overview, Account Team, Engagement, Flags,
 * Notes, System. The brief's four groups plus two the flattened field set makes
 * obvious once it is on screen: the twelve Yes/No operational flags, and the two
 * free-text blocks that would be unreadable squeezed into a half-width cell.
 *
 * `name` appears BOTH as the drawer's headline and as the first Overview field,
 * the same way the Contacts drawer treats a contact's full name. It is declared
 * `link` because it is the one field that carries through to /client-detail —
 * the same destination the table's Client column links to.
 */
export const ACCOUNT_SECTIONS: AccountSectionDef[] = [
  {
    key: "overview",
    title: "Overview",
    fields: [
      { label: "Client", sourceKey: "name", type: "link" },
      { label: "Ticker", sourceKey: "ticker_symbol", type: "text" },
      // The three statuses, in the order the header explains. Active/Inactive
      // first because it is the one the default view filters on.
      { label: "Active/Inactive", sourceKey: "state_label", type: "text" },
      { label: "Client Status", sourceKey: "client_status_label", type: "text" },
      { label: "Sector", sourceKey: "sector_label", type: "text" },
      { label: "Industry", sourceKey: "industry_option_label", type: "text" },
      { label: "Region", sourceKey: "region_label", type: "text" },
      { label: "HQ Country", sourceKey: "hq_country_name", type: "text" },
      { label: "Market Cap ($B)", sourceKey: "market_cap_b", type: "number" },
      { label: "Market Cap Band", sourceKey: "market_cap_label", type: "text" },
      { label: "Exchange", sourceKey: "exchange_label", type: "text" },
      { label: "Website", sourceKey: "website_url", type: "link" },
      { label: "Email", sourceKey: "email", type: "text" },
      // PRIMARY address (Dynamics address1_*), with address2 as the fallback —
      // see sql/patches/2026-09-23g_accounts_full_fields.sql.
      { label: "Street", sourceKey: "street", type: "text" },
      { label: "City", sourceKey: "city", type: "text" },
      { label: "State/Province", sourceKey: "state_province", type: "text" },
      { label: "Postal Code", sourceKey: "postal_code", type: "text" },
      { label: "Country", sourceKey: "country", type: "text" },
      { label: "Phone", sourceKey: "phone", type: "text" },
      { label: "Ipreo Ticker", sourceKey: "ipreo_ticker", type: "text" },
      { label: "Master Company Record", sourceKey: "company_master_name", type: "text" },
    ],
  },
  {
    key: "team",
    title: "Account Team",
    fields: [
      // The five the brief names, then the three other staffing lookups that are
      // already flattened. Read-only: these are the Dynamics fields, and which
      // team table is canonical is a separate question (see the header).
      { label: "Account Manager", sourceKey: "sales_lead_primary_name", type: "person" },
      { label: "Secondary", sourceKey: "secondary_manager_name", type: "person" },
      { label: "Associate", sourceKey: "associate_name", type: "person" },
      { label: "Feedback", sourceKey: "feedback_report_name", type: "person" },
      { label: "Logistics", sourceKey: "logistics_coordinator_name", type: "person" },
      { label: "Targeting", sourceKey: "targeting_name", type: "person" },
      { label: "Teaser", sourceKey: "teaser_name", type: "person" },
      { label: "Primary Contact", sourceKey: "primary_contact_name", type: "text" },
    ],
  },
  {
    key: "engagement",
    title: "Engagement",
    fields: [
      // Dynamics' own rollups — see note 3 in the header. Shown because this is
      // the system-of-record page and they are what the CRM believes; not to be
      // used as reporting figures.
      { label: "Current Event", sourceKey: "current_event_name", type: "text" },
      { label: "Current Project", sourceKey: "current_project_name", type: "text" },
      { label: "Last Touch", sourceKey: "last_touchpoint_date", type: "date" },
      { label: "Next Touch", sourceKey: "next_touchpoint_date", type: "date" },
      { label: "Last Event", sourceKey: "last_event_date", type: "date" },
      { label: "Next Event", sourceKey: "next_event_date", type: "date" },
      { label: "Ongoing Event", sourceKey: "ongoing_event_date", type: "date" },
      { label: "Days Since Review", sourceKey: "days_since_last_review", type: "number" },
      { label: "Original Start", sourceKey: "original_start_date", type: "date" },
      { label: "Onboarding Call", sourceKey: "onboarding_call", type: "date" },
      { label: "Teach-In", sourceKey: "teach_in", type: "date" },
      // Two separate Dynamics fields (bcs_teachin and bcs_teachindate), not a
      // duplicate — both are mapped, so both are shown.
      { label: "Teach-In Date", sourceKey: "teach_in_date", type: "date" },
      { label: "Last Targeting", sourceKey: "last_targeting_date", type: "date" },
      { label: "Last Teaser", sourceKey: "last_teaser_date", type: "date" },
      { label: "Last Data Upload", sourceKey: "last_data_upload", type: "date" },
      {
        label: "SH Report Received",
        sourceKey: "shareholder_report_received_date",
        type: "date",
      },
    ],
  },
  {
    key: "flags",
    title: "Flags",
    fields: [
      { label: "Do Not Call", sourceKey: "do_not_call", type: "toggle" },
      { label: "IR Only", sourceKey: "ir_only", type: "toggle" },
      { label: "Calendar", sourceKey: "calendar", type: "toggle" },
      { label: "Calendar Confirmed", sourceKey: "calendar_confirmed", type: "toggle" },
      { label: "Distro", sourceKey: "distro", type: "toggle" },
      { label: "BDA Peers", sourceKey: "bda_peers", type: "toggle" },
      { label: "Mtg History Received", sourceKey: "meeting_history_received", type: "toggle" },
      { label: "Mgmt Review", sourceKey: "mgmt_review", type: "toggle" },
      { label: "Recurring Call", sourceKey: "recurring_call_scheduled", type: "toggle" },
      { label: "Report", sourceKey: "report", type: "toggle" },
      { label: "Rep Short Interest", sourceKey: "rep_short_interest", type: "toggle" },
      { label: "SH Report", sourceKey: "sh_report", type: "toggle" },
    ],
  },
  {
    // Flattened 2026-09-23g — client-record fields that had no column before.
    key: "profile",
    title: "Profile & Preferences",
    fields: [
      { label: "Secondary Exchange", sourceKey: "secondary_exchange_label", type: "text" },
      { label: "HQ State", sourceKey: "hq_state_label", type: "text" },
      { label: "Reporting Frequency", sourceKey: "reporting_frequency_label", type: "text" },
      { label: "Dividend Yield (%)", sourceKey: "div_yield", type: "number" },
      { label: "Meeting Slot (min)", sourceKey: "meeting_slot_minutes", type: "number" },
      { label: "Meeting Platform", sourceKey: "meeting_platform_pref", type: "text" },
      { label: "Time Zone (Dynamics code)", sourceKey: "timezone_code", type: "number" },
      { label: "Estimates", sourceKey: "estimates", type: "toggle" },
      { label: "Include Admin", sourceKey: "include_admin", type: "toggle" },
      { label: "Exclude from Distribution", sourceKey: "exclude_from_distribution", type: "toggle" },
      { label: "Contact IR Only", sourceKey: "contact_ir_only", type: "toggle" },
    ],
  },
  {
    key: "notes",
    title: "Notes",
    fields: [
      { label: "Additional Notes", sourceKey: "additional_notes", type: "notes" },
      { label: "Targeting Parameters", sourceKey: "targeting_parameters", type: "notes" },
      // `notes` renders full-width and preserves line breaks. These three are
      // free text in the CRM and routinely run to several lines.
      { label: "Onboarding Notes", sourceKey: "onboarding_notes", type: "notes" },
      { label: "Peers", sourceKey: "peers", type: "notes" },
      { label: "Dietary Restrictions", sourceKey: "dietary_restrictions", type: "notes" },
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
      { label: "Status (Dynamics)", sourceKey: "status_label", type: "text" },
    ],
  },
]

/**
 * The header strip above the sections: Sector, then Region.
 * The client's NAME is the headline itself and is rendered by the pane, and the
 * Active/Inactive pill sits beside it.
 */
export const ACCOUNT_HEADER_FIELDS: AccountFieldDef[] = [
  { label: "Sector", sourceKey: "sector_label", type: "text" },
  { label: "Region", sourceKey: "region_label", type: "text" },
]

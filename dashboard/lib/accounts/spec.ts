/**
 * The Clients entity: its column catalog, its built-in views, and the
 * EntitySpec that binds them to the shared table machinery in lib/table-views/.
 *
 * ── ONE LIST, NOT TWO ──────────────────────────────────────────────────────
 * The catalog is DERIVED from `ACCOUNT_SECTIONS` in lib/accounts/record.ts — the
 * same field definitions the record drawer renders — so labels, types and
 * ordering come from one place, and adding a field to the drawer adds it to the
 * column picker automatically. What lives here is only what the drawer does not
 * need: which view column backs each field, how wide it renders, how it is
 * painted, and which band it groups under.
 *
 * Seventh entity on this machinery, after Meetings, Events, Tasks, Touches,
 * Notes and Contacts. Nothing about filtering, paging, saved views or
 * authorisation is written again here.
 *
 * ── THE ENTITY KEY IS "accounts", THE LABEL IS "Clients" ───────────────────
 * The route (/accounts), the view (v_admin_accounts_all), the saved-views table
 * (account_saved_views), this spec's key and every file name stay "accounts" —
 * the Dynamics entity and the mirror table are both `account`. Only what a
 * person reads says "Client". Exactly the precedent Touches set, where the route
 * and every internal name stay "touchpoints".
 */

import type { ColumnDef, EntitySpec, FieldType, ViewSort } from "@/lib/table-views/types"
import { BUILTIN_PREFIX, type BuiltinView } from "@/lib/table-views/types"
import { ACCOUNT_SECTIONS, type AccountRecord } from "./record"

/** How a clients cell is painted. Mirrors the contacts renderer vocabulary. */
export type AccountRenderer =
  | "text"
  | "date"
  | "client" // the client itself: ticker link + the account-team avatar cluster
  | "people" // initials-circle avatar for one person
  | "statePill" // coloured pill carrying Active / Inactive
  | "url" // an external link, shown as a short label
  | "number" // right-aligned tabular figure
  | "bool" // Yes / No / em dash

export type AccountColumnDef = ColumnDef & { renderer: AccountRenderer }

/**
 * The bands above the column headers, in picker order. A band is a run of
 * ADJACENT columns, so the default column order below is what actually decides
 * where the rules fall; these are the labels those runs get.
 */
export const ACCOUNT_COLUMN_GROUPS = [
  "Client",
  "Profile",
  "Account Team",
  "Engagement",
  "Flags",
  "Notes",
  "Status",
  "System",
] as const
export type AccountColumnGroup = (typeof ACCOUNT_COLUMN_GROUPS)[number]

/**
 * Per-field display facts, keyed by the drawer's `sourceKey`.
 *
 * `column` is the name on v_admin_accounts_all. Every one matches the drawer key
 * exactly — the view renames nothing and digs nothing out of `_raw`.
 */
const SOURCE: Partial<
  Record<
    keyof AccountRecord,
    {
      column: string
      width: string
      renderer: AccountRenderer
      group: AccountColumnGroup
      /**
       * Override the FILTER type the drawer field declares. The drawer's own
       * `AccountFieldType` says how to PAINT a value; this says which operators
       * the filter row may offer.
       */
      type?: FieldType
      compact?: boolean
      header?: string
      title?: string
    }
  >
> = {
  // ---- Client ----
  // The row's identity: the client's name, its ticker link, and the account-team
  // circles. Backed by `name`, not by the ticker column, so the keyword box, the
  // text filters and the sort all work on the full company name — the ticker is
  // what is PAINTED, not what is stored.
  name: {
    column: "name",
    width: "230px",
    renderer: "client",
    group: "Client",
    header: "Client",
    title:
      "Client ticker — full company name on hover. Links to the client's detail " +
      "page. The circles are the account team (manager, secondary, associate, " +
      "logistics), the same cluster Portfolio and Events show. Sorts and filters " +
      "on the full name",
  },
  ticker_symbol: {
    column: "ticker_symbol",
    width: "90px",
    renderer: "text",
    group: "Client",
    header: "Ticker",
    title: "The ticker as plain text. The Client column paints it as a link instead",
  },

  // ---- Profile ----
  state_label: {
    column: "state_label",
    width: "92px",
    renderer: "statePill",
    group: "Status",
    header: "Status",
    title:
      "Dynamics statecode: Active (0) or Inactive (1). This is what the default " +
      "view filters on, and what ~15 existing views mean by 'active client'. " +
      "NOT the same as Client Status",
  },
  client_status_label: {
    column: "client_status_label",
    width: "100px",
    renderer: "text",
    group: "Status",
    header: "Client Status",
    title:
      "bcs_ClientStatus — a Rose business field (Current / Past / blank). It " +
      "disagrees with the Dynamics Active/Inactive state on 33 accounts, which " +
      "is why both are shown",
  },
  sector_label: {
    column: "sector_label",
    width: "140px",
    renderer: "text",
    group: "Profile",
    header: "Sector",
    title: "bcs_Sector",
  },
  industry_option_label: {
    column: "industry_option_label",
    width: "150px",
    renderer: "text",
    group: "Profile",
    header: "Industry",
    title: "bcs_IndustryOption",
  },
  region_label: {
    column: "region_label",
    width: "96px",
    renderer: "text",
    group: "Profile",
    header: "Region",
    title:
      "Americas / APAC / EMEA, derived from HQ Country by the same rule " +
      "v_client_portfolio uses. An unrecognised or missing country falls into " +
      "EMEA — put HQ Country on screen to see the raw value",
  },
  hq_country_name: {
    column: "hq_country_name",
    width: "140px",
    renderer: "text",
    group: "Profile",
    header: "HQ Country",
  },
  market_cap_b: {
    column: "market_cap_b",
    width: "96px",
    renderer: "number",
    group: "Profile",
    header: "Mkt Cap ($B)",
    title: "bcs_MarketCapB, in billions. Blank means not recorded",
  },
  market_cap_label: {
    column: "market_cap_label",
    width: "88px",
    renderer: "text",
    group: "Profile",
    header: "Cap Band",
    title:
      "Mega / Large / Mid / Small / Micro, by the same thresholds " +
      "v_client_portfolio uses. A client with NO market cap on record lands in " +
      "Micro, not in its own bucket — check Mkt Cap ($B) to tell the two apart",
  },
  exchange_label: {
    column: "exchange_label",
    width: "110px",
    renderer: "text",
    group: "Profile",
    header: "Exchange",
  },
  website_url: {
    column: "website_url",
    width: "80px",
    renderer: "url",
    group: "Profile",
    header: "Website",
  },
  email: {
    column: "email",
    width: "200px",
    renderer: "text",
    group: "Profile",
    header: "Email",
  },
  city: { column: "city", width: "130px", renderer: "text", group: "Profile", header: "City" },
  state_province: {
    column: "state_province",
    width: "110px",
    renderer: "text",
    group: "Profile",
    header: "State",
  },
  country: {
    column: "country",
    width: "120px",
    renderer: "text",
    group: "Profile",
    header: "Country",
  },
  ipreo_ticker: {
    column: "ipreo_ticker",
    width: "100px",
    renderer: "text",
    group: "Profile",
    header: "Ipreo Ticker",
  },
  company_master_name: {
    column: "company_master_name",
    width: "170px",
    renderer: "text",
    group: "Profile",
    header: "Master Co.",
    title: "bcs_CompanyMasterRecord — the parent company record, where one exists",
  },

  // ---- Account Team ----
  // Display-only, read straight off the account. Filtered by NAME rather than by
  // user id, which unions the duplicate systemuser records two people in this
  // CRM carry — see lib/accounts/filters.ts.
  sales_lead_primary_name: {
    column: "sales_lead_primary_name",
    width: "150px",
    renderer: "people",
    group: "Account Team",
    header: "Account Mgr",
    title: "bcs_SalesLeadPrimary — the account manager",
  },
  secondary_manager_name: {
    column: "secondary_manager_name",
    width: "150px",
    renderer: "people",
    group: "Account Team",
    header: "Secondary",
  },
  associate_name: {
    column: "associate_name",
    width: "150px",
    renderer: "people",
    group: "Account Team",
    header: "Associate",
  },
  feedback_report_name: {
    column: "feedback_report_name",
    width: "150px",
    renderer: "people",
    group: "Account Team",
    header: "Feedback",
    title: "bcs_FeedbackReport — who writes this client's feedback report",
  },
  logistics_coordinator_name: {
    column: "logistics_coordinator_name",
    width: "150px",
    renderer: "people",
    group: "Account Team",
    header: "Logistics",
  },
  targeting_name: {
    column: "targeting_name",
    width: "150px",
    renderer: "people",
    group: "Account Team",
    header: "Targeting",
  },
  teaser_name: {
    column: "teaser_name",
    width: "150px",
    renderer: "people",
    group: "Account Team",
    header: "Teaser",
  },
  primary_contact_name: {
    column: "primary_contact_name",
    width: "170px",
    renderer: "text",
    group: "Account Team",
    header: "Primary Contact",
    title: "The client-side primary contact (a contact record, not a Rose person)",
  },

  // ---- Engagement ----
  // Every date here is a Dynamics rollup, passed through. See the header of
  // lib/accounts/record.ts: they lag what public.meetings/events contain, and
  // must not be used as reporting figures.
  last_touchpoint_date: {
    column: "last_touchpoint_date",
    width: "104px",
    renderer: "date",
    group: "Engagement",
    header: "Last Touch",
    title:
      "bcs_LastTouchpoint — the CRM's own rollup, not a count off public.meetings. " +
      "Known to lag; treat it as what the CRM believes",
  },
  next_touchpoint_date: {
    column: "next_touchpoint_date",
    width: "104px",
    renderer: "date",
    group: "Engagement",
    header: "Next Touch",
  },
  last_event_date: {
    column: "last_event_date",
    width: "104px",
    renderer: "date",
    group: "Engagement",
    header: "Last Event",
  },
  next_event_date: {
    column: "next_event_date",
    width: "104px",
    renderer: "date",
    group: "Engagement",
    header: "Next Event",
  },
  ongoing_event_date: {
    column: "ongoing_event_date",
    width: "108px",
    renderer: "date",
    group: "Engagement",
    header: "Ongoing Event",
  },
  current_event_name: {
    column: "current_event_name",
    width: "200px",
    renderer: "text",
    group: "Engagement",
    header: "Current Event",
  },
  current_project_name: {
    column: "current_project_name",
    width: "180px",
    renderer: "text",
    group: "Engagement",
    header: "Current Project",
  },
  days_since_last_review: {
    column: "days_since_last_review",
    width: "88px",
    renderer: "number",
    group: "Engagement",
    header: "Days Since Rev.",
    compact: true,
  },
  original_start_date: {
    column: "original_start_date",
    width: "104px",
    renderer: "date",
    group: "Engagement",
    header: "Orig. Start",
    title: "bcs_OriginalStartDate — when the engagement began",
  },
  onboarding_call: {
    column: "onboarding_call",
    width: "108px",
    renderer: "date",
    group: "Engagement",
    header: "Onboarding Call",
  },
  teach_in: {
    column: "teach_in",
    width: "100px",
    renderer: "date",
    group: "Engagement",
    header: "Teach-In",
  },
  teach_in_date: {
    column: "teach_in_date",
    width: "104px",
    renderer: "date",
    group: "Engagement",
    header: "Teach-In Date",
    title: "bcs_TeachInDate — a SECOND Dynamics field, distinct from bcs_TeachIn",
  },
  last_targeting_date: {
    column: "last_targeting_date",
    width: "108px",
    renderer: "date",
    group: "Engagement",
    header: "Last Targeting",
  },
  last_teaser_date: {
    column: "last_teaser_date",
    width: "104px",
    renderer: "date",
    group: "Engagement",
    header: "Last Teaser",
  },
  last_data_upload: {
    column: "last_data_upload",
    width: "108px",
    renderer: "date",
    group: "Engagement",
    header: "Last Upload",
  },
  shareholder_report_received_date: {
    column: "shareholder_report_received_date",
    width: "108px",
    renderer: "date",
    group: "Engagement",
    header: "SH Rpt Recd",
  },

  // ---- Flags ----
  do_not_call: {
    column: "do_not_call",
    width: "78px",
    renderer: "bool",
    group: "Flags",
    header: "Do Not Call",
    compact: true,
  },
  ir_only: {
    column: "ir_only",
    width: "70px",
    renderer: "bool",
    group: "Flags",
    header: "IR Only",
    compact: true,
  },
  calendar: {
    column: "calendar",
    width: "74px",
    renderer: "bool",
    group: "Flags",
    header: "Calendar",
    compact: true,
  },
  calendar_confirmed: {
    column: "calendar_confirmed",
    width: "78px",
    renderer: "bool",
    group: "Flags",
    header: "Cal. Conf.",
    compact: true,
  },
  distro: {
    column: "distro",
    width: "68px",
    renderer: "bool",
    group: "Flags",
    header: "Distro",
    compact: true,
  },
  bda_peers: {
    column: "bda_peers",
    width: "74px",
    renderer: "bool",
    group: "Flags",
    header: "BDA Peers",
    compact: true,
  },
  meeting_history_received: {
    column: "meeting_history_received",
    width: "82px",
    renderer: "bool",
    group: "Flags",
    header: "Mtg Hist.",
    compact: true,
    title: "bcs_MeetingHistoryRecd — meeting history received from the client",
  },
  mgmt_review: {
    column: "mgmt_review",
    width: "80px",
    renderer: "bool",
    group: "Flags",
    header: "Mgmt Rev.",
    compact: true,
  },
  recurring_call_scheduled: {
    column: "recurring_call_scheduled",
    width: "84px",
    renderer: "bool",
    group: "Flags",
    header: "Rec. Call",
    compact: true,
  },
  report: {
    column: "report",
    width: "68px",
    renderer: "bool",
    group: "Flags",
    header: "Report",
    compact: true,
  },
  rep_short_interest: {
    column: "rep_short_interest",
    width: "84px",
    renderer: "bool",
    group: "Flags",
    header: "Short Int.",
    compact: true,
  },
  sh_report: {
    column: "sh_report",
    width: "76px",
    renderer: "bool",
    group: "Flags",
    header: "SH Report",
    compact: true,
  },

  // ---- Notes ----
  onboarding_notes: {
    column: "onboarding_notes",
    width: "280px",
    renderer: "text",
    group: "Notes",
    header: "Onboarding Notes",
  },
  peers: { column: "peers", width: "220px", renderer: "text", group: "Notes", header: "Peers" },
  dietary_restrictions: {
    column: "dietary_restrictions",
    width: "200px",
    renderer: "text",
    group: "Notes",
    header: "Dietary",
  },

  // ---- System ----
  owner_name: {
    column: "owner_name",
    width: "150px",
    renderer: "people",
    group: "System",
    header: "Owner",
    title: "Who owns the account record in Dynamics",
  },
  created_by_name: {
    column: "created_by_name",
    width: "150px",
    renderer: "people",
    group: "System",
    header: "Created By",
  },
  modified_by_name: {
    column: "modified_by_name",
    width: "150px",
    renderer: "people",
    group: "System",
    header: "Modified By",
  },
  created_on: {
    column: "created_on",
    width: "104px",
    renderer: "date",
    group: "System",
    header: "Created",
  },
  modified_on: {
    column: "modified_on",
    width: "104px",
    renderer: "date",
    group: "System",
    header: "Modified",
  },
  status_label: {
    column: "status_label",
    width: "104px",
    renderer: "text",
    group: "Status",
    header: "Sys Status",
    title: "The Dynamics statuscode label. Redundant with Status today (106/122 either way)",
  },
}

/**
 * Columns the LIST has that the drawer does not show as its own FIELD.
 *
 * `name` earns a plain-text column of its own because the Client column paints
 * the TICKER: on a page whose whole point is the client record, being able to
 * put the full legal company name on screen, sort it and export it is not
 * optional. `is_active` is here for the same reason it is on Contacts — so
 * anyone auditing why a row is or is not in the default view can see the value
 * the filter actually tests.
 */
const LIST_ONLY: AccountColumnDef[] = [
  {
    key: "client_account_name",
    label: "Client Name",
    header: "Client Name",
    section: "Client",
    type: "text",
    width: "240px",
    renderer: "text",
    title: "The full company name, as plain text — the Client column paints the ticker instead",
  },
  {
    key: "fs_sector",
    label: "FS Sector",
    header: "FS Sector",
    section: "Profile",
    type: "text",
    width: "140px",
    renderer: "text",
    title: "bcs_FSSector — a second, free-text sector field distinct from bcs_Sector",
  },
  {
    key: "fs_industry",
    label: "FS Industry",
    header: "FS Industry",
    section: "Profile",
    type: "text",
    width: "150px",
    renderer: "text",
  },
  {
    key: "is_active",
    label: "Is Active",
    header: "Active?",
    section: "Status",
    type: "toggle",
    width: "74px",
    renderer: "bool",
    compact: true,
    title:
      "Computed in the view as state_code = 0. This is the toggle the default " +
      "view filters on — exposed so anyone auditing why a row is or is not in it " +
      "can see it",
  },
  {
    key: "state_code",
    label: "State Code",
    header: "State #",
    section: "Status",
    type: "number",
    width: "76px",
    renderer: "text",
    compact: true,
  },
  {
    key: "status_code",
    label: "Status Code",
    header: "Status #",
    section: "Status",
    type: "number",
    width: "80px",
    renderer: "text",
    compact: true,
  },
  {
    key: "client_status_code",
    label: "Client Status Code",
    header: "Cli. Status #",
    section: "Status",
    type: "number",
    width: "90px",
    renderer: "text",
    compact: true,
  },
  {
    key: "_synced_at",
    label: "Last Synced",
    header: "Synced",
    section: "System",
    type: "date",
    width: "104px",
    renderer: "date",
    title: "When the dashboard last wrote this row from Dynamics — not a CRM field",
  },
]

/** The full catalog, in drawer order, then the list-only extras. */
export const ACCOUNT_CATALOG: AccountColumnDef[] = [
  ...ACCOUNT_SECTIONS.flatMap((section) =>
    section.fields.flatMap((f) => {
      const src = SOURCE[f.sourceKey]
      if (!src) return []
      return [
        {
          key: src.column,
          label: f.label,
          header: src.header,
          title: src.title,
          section: src.group,
          type: src.type ?? f.type,
          width: src.width,
          renderer: src.renderer,
          compact: src.compact,
        } satisfies AccountColumnDef,
      ]
    }),
  ),
  ...LIST_ONLY,
]

const BY_KEY = new Map(ACCOUNT_CATALOG.map((c) => [c.key, c]))

export function getAccountColumn(key: string): AccountColumnDef | undefined {
  return BY_KEY.get(key)
}

/** Catalog grouped for the picker — one heading per group, in group order. */
export function accountCatalogBySection(): { section: string; columns: AccountColumnDef[] }[] {
  return ACCOUNT_COLUMN_GROUPS.map((g) => ({
    section: g as string,
    columns: ACCOUNT_CATALOG.filter((c) => c.section === g),
  })).filter((g) => g.columns.length > 0)
}

/**
 * The default seven columns:
 *   Client · Status · Client Status · Sector · Region · Cap Band · Last Touch
 *
 * The brief's list — Client (name + ticker link + account-team avatars), Status,
 * Sector, Region, Market Cap, plus a last-activity column — with Client Status
 * added beside Status. Both are called a "status" and they disagree on 33
 * accounts; showing one without the other is how that disagreement stays
 * invisible.
 *
 * "Market Cap" is the BAND rather than the raw $B figure: the band is what the
 * dropdown filters on and what Portfolio groups by, and the raw number is one
 * click away in the column picker.
 *
 * Resulting bands: Client | Status (Status, Client Status) | Profile (Sector,
 * Region, Cap Band) | Engagement (Last Touch). Each is a contiguous run, which
 * is what a band requires.
 */
export const ACCOUNT_DEFAULT_COLUMNS: string[] = [
  "name",
  "state_label",
  "client_status_label",
  "sector_label",
  "region_label",
  "market_cap_label",
  "last_touchpoint_date",
]

/**
 * Always fetched: the row identity, and the columns the Client cell paints with
 * whatever the active view asks for.
 *
 * The four account-team names are here because the Client column draws the
 * avatar cluster from them even when none of the four is a visible column of its
 * own — the same cluster Portfolio and Events show, from the same four
 * `accounts` columns (lib/account-team.ts ACCOUNT_TEAM_ROLES). Without them the
 * circles would appear and disappear depending on the view's column list.
 */
export const ACCOUNT_ALWAYS_SELECT = [
  "account_id",
  "client_account_id",
  "client_account_name",
  "client_ticker",
  "sales_lead_primary_name",
  "secondary_manager_name",
  "associate_name",
  "logistics_coordinator_name",
] as const

/**
 * Alphabetical by client name — what the brief asked for, and the right default
 * for a directory people navigate by name. Ascending, so A is at the top.
 */
export const ACCOUNT_DEFAULT_SORT: ViewSort = { field: "name", dir: "asc" }

/**
 * The built-in system views — CODE, not rows, so they always exist and need no
 * seeding step. Same as all six sibling entities; see the note in the patch
 * about why account_saved_views ships with no seed row.
 *
 * "Active clients" is the fallback default the brief asked for: state_code = 0,
 * by name. It filters on `is_active`, which the view COMPUTES on every query
 * rather than freezing into a saved filter, so a client deactivated in Dynamics
 * leaves the view on the next sync with no edit here.
 *
 * "All clients" exists because without it there is no way to reach an inactive
 * client except by hand-editing the filter — the same reason every sibling
 * entity carries an "All X". It matters more here than anywhere else: roughly
 * half the mirror (122 of 228) is inactive, and Portfolio cannot show any of it.
 */
export const ACCOUNT_BUILTIN_VIEWS: BuiltinView[] = [
  {
    id: `${BUILTIN_PREFIX}active`,
    name: "Active clients",
    isFallbackDefault: true,
    config: {
      columns: ACCOUNT_DEFAULT_COLUMNS,
      filters: [{ field: "is_active", op: "isTrue" }],
      sort: ACCOUNT_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}all`,
    name: "All clients",
    config: {
      columns: ACCOUNT_DEFAULT_COLUMNS,
      filters: [],
      sort: ACCOUNT_DEFAULT_SORT,
    },
  },
]

/** The Clients entity, bound to the shared machinery. */
export const ACCOUNTS_SPEC: EntitySpec = {
  key: "accounts",
  viewName: "v_admin_accounts_all",
  idColumn: "account_id",
  alwaysSelect: ACCOUNT_ALWAYS_SELECT,
  getColumn: getAccountColumn,
  catalog: ACCOUNT_CATALOG,
  defaultSort: ACCOUNT_DEFAULT_SORT,
  builtins: ACCOUNT_BUILTIN_VIEWS,
  savedViewsTable: "account_saved_views",
  optionsView: "v_admin_accounts_filter_options",
}

/**
 * Is this value a PERSON we can draw initials for?
 *
 * The same space test the other pages use, so a single-token value is shown
 * verbatim rather than rendered as one misleading letter. It matters on this
 * entity: several account-team lookups point at a TEAM rather than a named
 * individual, and "Logistics" deserves to read as the word it is.
 */
export function isPersonName(value: string | null | undefined): boolean {
  return !!value && value.trim().includes(" ")
}

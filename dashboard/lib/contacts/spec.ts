/**
 * The Contacts entity: its column catalog, its built-in views, and the
 * EntitySpec that binds them to the shared table machinery in lib/table-views/.
 *
 * ── ONE LIST, NOT TWO ──────────────────────────────────────────────────────
 * The catalog is DERIVED from `CONTACT_SECTIONS` in lib/contacts/record.ts — the
 * same field definitions the record drawer renders — so labels, types and
 * ordering come from one place, and adding a field to the drawer adds it to the
 * column picker automatically. What lives here is only what the drawer does not
 * need: which view column backs each field, how wide it renders, how it is
 * painted, and which band it groups under.
 *
 * Sixth entity on this machinery, after Meetings, Events, Tasks, Touches and
 * Notes. Nothing about filtering, paging, saved views or authorisation is
 * written again here.
 */

import type { ColumnDef, EntitySpec, FieldType, ViewSort } from "@/lib/table-views/types"
import { BUILTIN_PREFIX, type BuiltinView } from "@/lib/table-views/types"
import { CONTACT_SECTIONS, type ContactRecord } from "./record"

/** How a contacts cell is painted. Mirrors the notes renderer vocabulary. */
export type ContactRenderer =
  | "text"
  | "date"
  | "ticker" // client symbol, linked to client detail, full name on hover
  | "people" // initials-circle avatar for the contact themselves
  | "statePill" // coloured pill carrying Active / Inactive
  | "bool" // Yes / No / em dash

export type ContactColumnDef = ColumnDef & { renderer: ContactRenderer }

/**
 * The bands above the column headers, in picker order. A band is a run of
 * ADJACENT columns, so the default column order below is what actually decides
 * where the rules fall; these are the labels those runs get.
 *
 * "Flags & State" covers the four Yes/No flags AND Lead State deliberately:
 * in the default column order Lead State sits immediately after Do Not Call, and
 * a band must be a contiguous run. Grouping it with the flags — they are all
 * classification markers on the person — keeps one clean band instead of
 * splitting "Profile" into two.
 */
export const CONTACT_COLUMN_GROUPS = [
  "Contact",
  "Client",
  "Profile",
  "Contact Info",
  "Flags & State",
  "Activity",
  "Status",
  "System",
] as const
export type ContactColumnGroup = (typeof CONTACT_COLUMN_GROUPS)[number]

/**
 * Per-field display facts, keyed by the drawer's `sourceKey`.
 *
 * `column` is the name on v_admin_contacts_all. Every one matches the drawer key
 * exactly — unlike Notes, this view renames nothing and digs nothing out of
 * `_raw`, because the mirror flattened the whole curated field set.
 */
const SOURCE: Partial<
  Record<
    keyof ContactRecord,
    {
      column: string
      width: string
      renderer: ContactRenderer
      group: ContactColumnGroup
      /**
       * Override the FILTER type the drawer field declares. The drawer's own
       * `ContactFieldType` says how to PAINT a value; this says which operators
       * the filter row may offer.
       */
      type?: FieldType
      compact?: boolean
      header?: string
      title?: string
    }
  >
> = {
  // ---- Contact ----
  full_name: {
    column: "full_name",
    width: "190px",
    renderer: "people",
    group: "Contact",
    header: "Contact",
    title: "The contact's full name, with their initials. Click the row to open the record",
  },

  // ---- Client ----
  parent_customer_name: {
    // Holds the ticker and links to the client's detail page, exactly as the
    // other CRM tables do — same renderer, same destination. Falls back to the
    // parent's plain NAME when it is not a matched account, which is what a
    // contact whose parent is another contact will show.
    column: "parent_customer_name",
    width: "104px",
    renderer: "ticker",
    group: "Client",
    header: "Client",
    title:
      "Client ticker — full name on hover. Links to the client's detail page. " +
      "Resolved through Company Name (parent_customer); see the patch header for " +
      "the Master Company Record alternative",
  },

  // ---- Profile ----
  job_title: {
    column: "job_title",
    width: "200px",
    renderer: "text",
    group: "Profile",
    header: "Job Title",
  },

  // ---- Contact Info (flattened 2026-09-16) ----
  email: {
    column: "email",
    width: "220px",
    renderer: "text",
    group: "Contact Info",
    header: "Email",
    title: "emailaddress1 — populated on ~77% of contacts. Indexed (idx_contacts_email)",
  },
  city: {
    column: "city",
    width: "130px",
    renderer: "text",
    group: "Contact Info",
    header: "City",
    title: "address1_city — the PRIMARY address block on contact",
  },
  mobile_phone: {
    column: "mobile_phone",
    width: "140px",
    renderer: "text",
    group: "Contact Info",
    header: "Mobile",
  },
  direct_phone: {
    column: "direct_phone",
    width: "140px",
    renderer: "text",
    group: "Contact Info",
    header: "Direct Line",
  },
  street: {
    column: "street",
    width: "200px",
    renderer: "text",
    group: "Contact Info",
    header: "Street",
  },
  contact_type_label: {
    column: "contact_type_label",
    width: "140px",
    renderer: "text",
    group: "Profile",
    header: "Contact Type",
    title: "bcs_ContactType. Empty on every row would mean the sync rejected it — check /admin",
  },
  industry_label: {
    column: "industry_label",
    width: "150px",
    renderer: "text",
    group: "Profile",
    header: "Industry",
    title: "bcs_IndustryChoice",
  },

  // ---- Flags & State ----
  ir_only: {
    column: "ir_only",
    width: "70px",
    renderer: "bool",
    group: "Flags & State",
    header: "IR Only",
    compact: true,
  },
  poc: {
    column: "poc",
    width: "62px",
    renderer: "bool",
    group: "Flags & State",
    header: "PoC",
    compact: true,
    title: "Point of Contact",
  },
  do_not_call: {
    column: "do_not_call",
    width: "78px",
    renderer: "bool",
    group: "Flags & State",
    header: "Do Not Call",
    compact: true,
  },
  distribution_list: {
    column: "distribution_list",
    width: "74px",
    renderer: "bool",
    group: "Flags & State",
    header: "Distro",
    compact: true,
    title: "On the distribution list (bcs_DistributionList)",
  },
  ex_employee: {
    column: "ex_employee",
    width: "76px",
    renderer: "bool",
    group: "Flags & State",
    header: "Ex-Empl.",
    compact: true,
    title: "Ex-Employee — no longer at this company",
  },
  lead_state_label: {
    column: "lead_state_label",
    width: "120px",
    renderer: "text",
    group: "Flags & State",
    header: "Lead State",
    title: "bcs_State (LeadState)",
  },

  // ---- Activity ----
  last_activity_time: {
    column: "last_activity_time",
    width: "112px",
    renderer: "date",
    group: "Activity",
    header: "Last Activity",
    title:
      "Dynamics' own last-activity stamp on the contact. The default view sorts " +
      "on it, most recent first",
  },
  last_activity_subject: {
    column: "last_activity_subject",
    width: "260px",
    renderer: "text",
    group: "Activity",
    header: "Last Activity Subject",
  },
  last_activity_type_label: {
    column: "last_activity_type_label",
    width: "130px",
    renderer: "text",
    group: "Activity",
    header: "Activity Type",
  },
  verified_on: {
    column: "verified_on",
    width: "104px",
    renderer: "date",
    group: "Activity",
    header: "Verified",
    title: "bcs_VerifiedOn — when the contact's details were last confirmed",
  },
  previous_company: {
    column: "previous_company",
    width: "180px",
    renderer: "text",
    group: "Activity",
    header: "Previous Company",
  },
  ticker_symbol: {
    column: "ticker_symbol",
    width: "92px",
    renderer: "text",
    group: "Activity",
    header: "Ticker",
    title: "The contact's OWN ticker field — not the client's, which the Client column links through",
  },

  // ---- Status ----
  state_label: {
    column: "state_label",
    width: "94px",
    renderer: "statePill",
    group: "Status",
    header: "Active",
    title: "Dynamics statecode: Active (0) or Inactive (1)",
  },

  // ---- System ----
  owner_name: {
    column: "owner_name",
    width: "150px",
    renderer: "people",
    group: "System",
    header: "Owner",
    title: "Who owns the contact record in Dynamics",
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
    width: "112px",
    renderer: "date",
    group: "System",
    header: "Created",
  },
  modified_on: {
    column: "modified_on",
    width: "112px",
    renderer: "date",
    group: "System",
    header: "Modified",
  },
}

/**
 * Columns the LIST has that the drawer does not show as its own FIELD.
 *
 * The two client-link extras are here because the whole point of this page in
 * its first pass is deciding WHICH link is real: someone auditing that needs to
 * be able to put the Master Company Record and the parent's entity type on
 * screen beside the resolved client.
 */
const LIST_ONLY: ContactColumnDef[] = [
  {
    key: "first_name",
    label: "First Name",
    header: "First",
    section: "Contact",
    type: "text",
    width: "120px",
    renderer: "text",
  },
  {
    key: "last_name",
    label: "Last Name",
    header: "Last",
    section: "Contact",
    type: "text",
    width: "140px",
    renderer: "text",
  },
  {
    key: "parent_customer_type",
    label: "Parent Type",
    header: "Parent Type",
    section: "Client",
    type: "text",
    width: "100px",
    renderer: "text",
    title:
      "What parentcustomerid points AT — 'account' or 'contact'. The client link " +
      "only resolves for 'account'",
  },
  {
    key: "company_master_record_name",
    label: "Master Company Record",
    header: "Master Co.",
    section: "Client",
    type: "text",
    width: "160px",
    renderer: "text",
    title:
      "The SECOND client-link candidate. Shown so it can be compared against the " +
      "resolved Client column before one of the two is made canonical",
  },
  {
    key: "internal_assignment_label",
    label: "Internal Assignment",
    header: "Assignment",
    section: "Profile",
    type: "text",
    width: "150px",
    renderer: "text",
    title: "bcs_InternalAssignment",
  },
  {
    key: "state_for_address_label",
    label: "State (Address)",
    header: "State",
    section: "Profile",
    type: "text",
    width: "110px",
    renderer: "text",
    title: "bcs_StateForAddress — the geographic state, not the lead state",
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
    key: "status_label",
    label: "Status (Dynamics)",
    header: "Sys Status",
    section: "Status",
    type: "text",
    width: "100px",
    renderer: "text",
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
    key: "client_ticker",
    label: "Ticker (client)",
    section: "Client",
    type: "text",
    width: "90px",
    renderer: "text",
  },
]

/** The full catalog, in drawer order, then the list-only extras. */
export const CONTACT_CATALOG: ContactColumnDef[] = [
  ...CONTACT_SECTIONS.flatMap((section) =>
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
        } satisfies ContactColumnDef,
      ]
    }),
  ),
  ...LIST_ONLY,
]

const BY_KEY = new Map(CONTACT_CATALOG.map((c) => [c.key, c]))

export function getContactColumn(key: string): ContactColumnDef | undefined {
  return BY_KEY.get(key)
}

/** Catalog grouped for the picker — one heading per group, in group order. */
export function contactCatalogBySection(): { section: string; columns: ContactColumnDef[] }[] {
  return CONTACT_COLUMN_GROUPS.map((g) => ({
    section: g as string,
    columns: CONTACT_CATALOG.filter((c) => c.section === g),
  })).filter((g) => g.columns.length > 0)
}

/**
 * The default thirteen columns:
 *   Contact · Client · Job Title · Contact Type · Industry · Email · City ·
 *   IR Only · PoC · Do Not Call · Lead State · Last Activity · Active/Inactive
 *
 * Email and City were added 2026-09-16 when the underlying fields were finally
 * flattened out of `_raw`.
 *
 * ── WHY EMAIL IS NOT IMMEDIATELY AFTER JOB TITLE ───────────────────────────
 * The order decides the header BANDS, and a band must be a run of ADJACENT
 * columns. Slotting Email between Job Title and Contact Type would split
 * Profile into two separate bands with the same label
 * (Profile | Contact Info | Profile), which reads like a rendering bug. Email
 * and City therefore sit immediately AFTER the Profile block — three columns
 * later, still well inside the first screenful.
 *
 * To put Email directly after Job Title anyway, move both keys up in this list
 * and accept the repeated band label; nothing else needs to change.
 *
 * Resulting bands: Contact | Client | Profile (Job Title, Contact Type,
 * Industry) | Contact Info (Email, City) | Flags & State (IR Only, PoC, Do Not
 * Call, Lead State) | Activity (Last Activity) | Status (Active).
 */
export const CONTACT_DEFAULT_COLUMNS: string[] = [
  "full_name",
  "parent_customer_name",
  "job_title",
  "contact_type_label",
  "industry_label",
  "email",
  "city",
  "ir_only",
  "poc",
  "do_not_call",
  "lead_state_label",
  "last_activity_time",
  "state_label",
]

/**
 * Always fetched: the row identity, the ids the table needs for links, and
 * is_test for the TEST badge on dashboard-created test contacts. Each key is
 * skipped when the view lacks it (selectListFor → usable), so the list still
 * loads before sql/patches/2026-09-23b_contacts_dashboard_writes.sql is run.
 */
export const CONTACT_ALWAYS_SELECT = [
  "contact_id",
  "client_account_id",
  "client_ticker",
  "is_test",
] as const

/**
 * Most recently active first — what the brief asked for, and the right default
 * for a directory whose only activity signal is Dynamics' own last-activity
 * stamp. `nullsFirst: false` in fetchRows puts never-active contacts at the
 * bottom rather than the top, which matters here: on a fresh sync that column
 * may be sparse, and a screen of blank rows would read as a broken page.
 */
export const CONTACT_DEFAULT_SORT: ViewSort = { field: "last_activity_time", dir: "desc" }

/**
 * The built-in system views — CODE, not rows, so they always exist and need no
 * seeding step. Same as all five sibling entities; see the note in the patch
 * about why contact_saved_views ships with no seed row.
 *
 * "Active contacts" is the fallback default the brief asked for: state_code = 0,
 * newest activity first. It filters on `is_active`, which the view COMPUTES on
 * every query rather than freezing into a saved filter, so a contact
 * deactivated in Dynamics leaves the view on the next sync with no edit here.
 *
 * "All contacts" exists because without it there is no way to reach an inactive
 * contact except by hand-editing the filter — the same reason every sibling
 * entity carries an "All X".
 */
export const CONTACT_BUILTIN_VIEWS: BuiltinView[] = [
  {
    id: `${BUILTIN_PREFIX}active`,
    name: "Active contacts",
    isFallbackDefault: true,
    config: {
      columns: CONTACT_DEFAULT_COLUMNS,
      filters: [{ field: "is_active", op: "isTrue" }],
      sort: CONTACT_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}all`,
    name: "All contacts",
    config: {
      columns: CONTACT_DEFAULT_COLUMNS,
      filters: [],
      sort: CONTACT_DEFAULT_SORT,
    },
  },
]

/** The Contacts entity, bound to the shared machinery. */
export const CONTACTS_SPEC: EntitySpec = {
  key: "contacts",
  viewName: "v_admin_contacts_all",
  idColumn: "contact_id",
  alwaysSelect: CONTACT_ALWAYS_SELECT,
  getColumn: getContactColumn,
  catalog: CONTACT_CATALOG,
  defaultSort: CONTACT_DEFAULT_SORT,
  builtins: CONTACT_BUILTIN_VIEWS,
  savedViewsTable: "contact_saved_views",
  optionsView: "v_admin_contacts_filter_options",
}

/**
 * Is this value a PERSON we can draw initials for?
 *
 * The same space test the other pages use, so a single-token value is shown
 * verbatim rather than rendered as one misleading letter. On this entity the
 * value IS the record's own name, so it is very nearly always true — but a
 * contact with only a last name in the CRM is a real case.
 */
export function isPersonName(value: string | null | undefined): boolean {
  return !!value && value.trim().includes(" ")
}

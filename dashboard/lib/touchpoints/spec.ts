/**
 * The Touchpoints entity: its column catalog, its built-in views, and the
 * EntitySpec that binds them to the shared table machinery in lib/table-views/.
 *
 * ── ONE LIST, NOT TWO ──────────────────────────────────────────────────────
 * The catalog is DERIVED from `TOUCHPOINT_SECTIONS` in lib/touchpoints/record.ts
 * — the same field definitions the record drawer renders — so labels, types and
 * ordering come from one place, and adding a field to the drawer adds it to the
 * column picker automatically. What lives here is only what the drawer does not
 * need: which view column backs each field, how wide it renders, how it is
 * painted, and which band it groups under.
 *
 * Fourth entity on this machinery, after Meetings, Events and Tasks. Nothing
 * about filtering, paging, saved views or authorisation is written again here.
 *
 * ── NAMING ─────────────────────────────────────────────────────────────────
 * The DISPLAY name is "Touches" — the nav label, the page title, the built-in
 * view names, the column band and the drawer's first section all say Touch or
 * Touches. Everything INTERNAL is still "touchpoints": the /touchpoints route,
 * v_admin_touchpoints_all, public.touchpoints, touchpoint_saved_views, every
 * symbol in this file and every file name. Only user-visible strings changed.
 */

import type { ColumnDef, EntitySpec, FieldType, ViewSort } from "@/lib/table-views/types"
import { BUILTIN_PREFIX, type BuiltinView } from "@/lib/table-views/types"
import { TOUCHPOINT_SECTIONS, type TouchpointRecord } from "./record"

/** How a touchpoints cell is painted. Mirrors the tasks renderer vocabulary. */
export type TouchpointRenderer =
  | "text"
  | "date"
  | "ticker" // client symbol, linked to client detail, full name on hover
  | "people" // initials-circle avatars for a known person
  | "statusPill" // coloured pill carrying the touchpoint status
  | "subject" // the subject — clicking it opens the drawer
  | "number" // right-aligned tabular figure
  | "bool" // Yes / No / em dash

export type TouchpointColumnDef = ColumnDef & { renderer: TouchpointRenderer }

/**
 * The bands above the column headers, in picker order. A band is a run of
 * ADJACENT columns, so the default column order below is what actually decides
 * where the rules fall; these are the labels those runs get.
 */
export const TOUCHPOINT_COLUMN_GROUPS = [
  "Client",
  "Touch",
  "Classification",
  "People",
  "System",
] as const
export type TouchpointColumnGroup = (typeof TOUCHPOINT_COLUMN_GROUPS)[number]

/**
 * Per-field display facts, keyed by the drawer's `sourceKey`.
 *
 * `column` is the name on v_admin_touchpoints_all. Most match the drawer key
 * exactly because public.touchpoints is already a flat mirror; the exceptions are
 * the two renames the view performs (`scheduled_start` → `touchpoint_date`,
 * `owner_*` → `owner_team_*`) and `modified_by_name`, which the view digs out of
 * `_raw`.
 */
const SOURCE: Partial<
  Record<
    keyof TouchpointRecord,
    {
      column: string
      width: string
      renderer: TouchpointRenderer
      group: TouchpointColumnGroup
      /**
       * Override the FILTER type the drawer field declares. The drawer's own
       * `TouchpointFieldType` says how to PAINT a value; this says which
       * operators the filter row may offer. They agree everywhere except
       * duration_minutes, which the drawer shows as plain text but must not be
       * filtered with ilike (integer ~~* unknown is error 42883, which blanks
       * the page).
       */
      type?: FieldType
      compact?: boolean
      header?: string
      title?: string
    }
  >
> = {
  // ---- Client ----
  client_account_name: {
    // Holds the ticker and links to the client's detail page, exactly as the
    // Tasks and Events tables do — same renderer, same destination.
    column: "client_account_name",
    width: "104px",
    renderer: "ticker",
    group: "Client",
    header: "Client",
    title: "Client ticker — full name on hover. Links to the client's detail page",
  },

  // ---- Touchpoint ----
  touchpoint_date: {
    column: "touchpoint_date",
    width: "104px",
    renderer: "date",
    group: "Touch",
    header: "Date",
    title: "Scheduled Start — what the CRM treats as the date of the touch",
  },
  subject: {
    column: "subject",
    width: "300px",
    renderer: "subject",
    group: "Touch",
    header: "Subject",
    title: "Click to open the touch record",
  },
  description: {
    column: "description",
    width: "280px",
    renderer: "text",
    group: "Touch",
    header: "Notes",
    title: "The free-text call notes — 93% of rows carry one, often several paragraphs",
  },

  // ---- Classification ----
  touchpoint_type_label: {
    column: "touchpoint_type_label",
    width: "112px",
    renderer: "text",
    group: "Classification",
    header: "Type",
    title: "Virtual / Email / In-Person / Social / Onboarding Call / Teach-in",
  },
  contact_type_label: {
    column: "contact_type_label",
    width: "136px",
    renderer: "text",
    group: "Classification",
    header: "Contact",
    title:
      "WHICH ROLE was spoken to — IRO / CEO / CFO / Other. A multi-select, stored " +
      "semicolon-joined. Empty on 51% of rows. This entity holds no contact NAME",
  },
  status_label: {
    column: "status_label",
    width: "96px",
    renderer: "statusPill",
    group: "Classification",
    header: "Status",
    title: "Open / Made / Received",
  },
  state_label: {
    column: "state_label",
    width: "92px",
    renderer: "text",
    group: "Classification",
    header: "State",
    title: "Open / Completed — the coarse state behind Status",
  },
  direction_label: {
    column: "direction_label",
    width: "88px",
    renderer: "text",
    group: "Classification",
    header: "Direction",
    title: "Outgoing on every live row today — the CRM logs no inbound touches",
  },

  // ---- People ----
  created_by_name: {
    column: "created_by_name",
    width: "92px",
    renderer: "people",
    group: "People",
    header: "Created By",
    title: "The staff member who logged the touch — the real person on this record",
  },
  modified_by_name: {
    column: "modified_by_name",
    width: "96px",
    renderer: "people",
    group: "People",
    header: "Modified By",
    title: "Sourced from _raw — the mirror flattens created_by but not modified_by",
  },
  owner_team_name: {
    column: "owner_team_name",
    width: "150px",
    renderer: "text",
    group: "People",
    header: "Owner Team",
    title:
      "A per-account Dynamics TEAM named after the client, not a staff member — " +
      "it duplicates the Client column. Use Created By for the person",
  },

  // ---- System ----
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
  scheduled_end: {
    column: "scheduled_end",
    width: "112px",
    renderer: "date",
    group: "System",
    header: "Sched End",
    title: "Identical to Date on every live row — the CRM writes the same instant to both",
  },
  duration_minutes: {
    column: "duration_minutes",
    width: "80px",
    renderer: "number",
    group: "System",
    type: "number",
    header: "Duration",
    title: "Actual Duration Minutes — 30 on every populated row; the CRM never varies it",
  },
}

/**
 * Columns the LIST has that the drawer does not show as its own FIELD.
 *
 * The raw option-set codes are here so a saved view can filter one directly when
 * a label is ambiguous or has been renamed in Dynamics, and `is_recent` is here
 * because it is the rolling window the default view is built on — someone
 * inspecting why a row is or is not in "Recent" needs to be able to see it.
 */
const LIST_ONLY: TouchpointColumnDef[] = [
  {
    key: "is_recent",
    label: "Last 12 Months",
    header: "Recent",
    section: "System",
    type: "toggle",
    width: "78px",
    renderer: "bool",
    compact: true,
    title:
      "Computed in the view as scheduled_start >= now() - 12 months. This is what " +
      "the default view filters on, and it re-evaluates on every query rather than " +
      "freezing to the day the view was saved",
  },
  {
    key: "client_ticker",
    label: "Ticker (raw)",
    section: "Client",
    type: "text",
    width: "90px",
    renderer: "text",
  },
  {
    key: "regarding_id",
    label: "Regarding Id (raw)",
    header: "Regarding Id",
    section: "Client",
    type: "text",
    width: "150px",
    renderer: "text",
    title: "The account id again on ~100% of rows — this entity's regarding is the client",
  },
  {
    key: "touchpoint_type_code",
    label: "Type Code (raw)",
    header: "Type Code",
    section: "Classification",
    type: "number",
    width: "100px",
    renderer: "number",
  },
  {
    key: "contact_type_code",
    label: "Contact Type Code (raw)",
    header: "Contact Code",
    section: "Classification",
    type: "text",
    width: "120px",
    renderer: "text",
    title: "Comma-joined for the multi-select, so it is text rather than an integer",
  },
  {
    key: "state_code",
    label: "State Code (raw)",
    header: "State Code",
    section: "Classification",
    type: "number",
    width: "94px",
    renderer: "number",
  },
  {
    key: "status_code",
    label: "Status Code (raw)",
    header: "Status Code",
    section: "Classification",
    type: "number",
    width: "100px",
    renderer: "number",
  },
  {
    key: "direction_code",
    label: "Direction Code (raw)",
    header: "Dir. Code",
    section: "Classification",
    type: "toggle",
    width: "84px",
    renderer: "bool",
    compact: true,
    title: "true = outbound. True on every live row",
  },
]

/** Fields shown in the drawer HEADER, which are also offerable as columns. */
const HEADER_COLUMNS: { key: keyof TouchpointRecord; label: string }[] = []

/** The full catalog, in drawer order, then the list-only extras. */
export const TOUCHPOINT_CATALOG: TouchpointColumnDef[] = [
  ...TOUCHPOINT_SECTIONS.flatMap((section) =>
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
        } satisfies TouchpointColumnDef,
      ]
    }),
  ),
  ...HEADER_COLUMNS.flatMap((h) => {
    const src = SOURCE[h.key]
    if (!src) return []
    return [
      {
        key: src.column,
        label: h.label,
        header: src.header,
        title: src.title,
        section: src.group,
        type: "text",
        width: src.width,
        renderer: src.renderer,
        compact: src.compact,
      } satisfies TouchpointColumnDef,
    ]
  }),
  ...LIST_ONLY,
]

const BY_KEY = new Map(TOUCHPOINT_CATALOG.map((c) => [c.key, c]))

export function getTouchpointColumn(key: string): TouchpointColumnDef | undefined {
  return BY_KEY.get(key)
}

/** Catalog grouped for the picker — one heading per group, in group order. */
export function touchpointCatalogBySection(): { section: string; columns: TouchpointColumnDef[] }[] {
  return TOUCHPOINT_COLUMN_GROUPS.map((g) => ({
    section: g as string,
    columns: TOUCHPOINT_CATALOG.filter((c) => c.section === g),
  })).filter((g) => g.columns.length > 0)
}

/**
 * The default seven columns:
 *   Client · Date · Subject · Type · Contact · Status · Created By
 *
 * The order is also what decides the header BANDS, which must be runs of
 * adjacent columns: Client | Touchpoint (Date, Subject) | Classification (Type,
 * Contact, Status) | People (Created By).
 *
 * NOT here, deliberately:
 *   Direction    "Outgoing" on every row — a constant column earns no width.
 *   Owner Team   duplicates Client (it is a team named after the account).
 *   Duration     30 on every populated row.
 *   Notes        often several paragraphs; it belongs in the drawer.
 * All four are in the catalog, so a saved view can add any of them without a
 * code change.
 */
export const TOUCHPOINT_DEFAULT_COLUMNS: string[] = [
  "client_account_name",
  "touchpoint_date",
  "subject",
  "touchpoint_type_label",
  "contact_type_label",
  "status_label",
  "created_by_name",
]

/**
 * Always fetched: the row identity, the ids the table needs for links, and
 * is_test for the TEST badge. Each key is skipped when the view lacks it, so the
 * list still loads before sql/patches/2026-09-23d_touchpoints_dashboard_writes.sql runs.
 */
export const TOUCHPOINT_ALWAYS_SELECT = [
  "touchpoint_id",
  "client_account_id",
  "client_ticker",
  "is_test",
] as const

/**
 * Newest first — Touchpoints is a historical LOG, like Meetings and Events, and
 * unlike Tasks. The interesting end of a contact history is the recent past, so
 * the default sort is DESCENDING on the touchpoint's own date.
 *
 * `nullsFirst: false` in fetchRows puts the 8 undated rows at the bottom rather
 * than the top.
 */
export const TOUCHPOINT_DEFAULT_SORT: ViewSort = { field: "touchpoint_date", dir: "desc" }

/**
 * The built-in system views — code, not rows, so they always exist and need no
 * seeding step.
 *
 * "Recent touchpoints" is the fallback default: a ROLLING last-12-months window,
 * 645 of 1,141 live rows, newest first.
 *
 * ── WHY is_recent AND NOT A DATE FILTER ────────────────────────────────────
 * The shared filter grammar resolves only `$today`, `$tomorrow` and frozen
 * YYYY-MM-DD literals (resolveDateValue in lib/table-views/query.ts). There is no
 * relative-offset token, so `{ field: "touchpoint_date", op: "after", value: "2025-09-15" }`
 * would be correct on the day it was written and quietly wrong forever after —
 * the window would never move.
 *
 * Computing the window in the VIEW instead (`is_recent` = scheduled_start >=
 * now() - interval '12 months') keeps the default genuinely rolling, re-evaluated
 * on every query, and needs no change to machinery three other pages depend on.
 * The cost is one boolean column; the alternative was a new token in the shared
 * date resolver.
 */
export const TOUCHPOINT_BUILTIN_VIEWS: BuiltinView[] = [
  {
    id: `${BUILTIN_PREFIX}recent`,
    name: "Recent touches",
    isFallbackDefault: true,
    config: {
      columns: TOUCHPOINT_DEFAULT_COLUMNS,
      filters: [{ field: "is_recent", op: "isTrue" }],
      sort: TOUCHPOINT_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}virtual`,
    name: "Recent — Virtual",
    config: {
      columns: TOUCHPOINT_DEFAULT_COLUMNS,
      filters: [
        { field: "is_recent", op: "isTrue" },
        { field: "touchpoint_type_label", op: "eq", value: "Virtual" },
      ],
      sort: TOUCHPOINT_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}in_person`,
    name: "Recent — In-Person",
    config: {
      columns: TOUCHPOINT_DEFAULT_COLUMNS,
      filters: [
        { field: "is_recent", op: "isTrue" },
        { field: "touchpoint_type_label", op: "eq", value: "In-Person" },
      ],
      sort: TOUCHPOINT_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}completed`,
    name: "Completed",
    config: {
      columns: TOUCHPOINT_DEFAULT_COLUMNS,
      filters: [{ field: "state_label", op: "eq", value: "Completed" }],
      sort: TOUCHPOINT_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}all`,
    name: "All touches",
    config: {
      columns: TOUCHPOINT_DEFAULT_COLUMNS,
      filters: [],
      sort: TOUCHPOINT_DEFAULT_SORT,
    },
  },
]

/** The Touches entity (internal key "touchpoints"), bound to the shared machinery. */
export const TOUCHPOINTS_SPEC: EntitySpec = {
  key: "touchpoints",
  viewName: "v_admin_touchpoints_all",
  idColumn: "touchpoint_id",
  alwaysSelect: TOUCHPOINT_ALWAYS_SELECT,
  getColumn: getTouchpointColumn,
  catalog: TOUCHPOINT_CATALOG,
  defaultSort: TOUCHPOINT_DEFAULT_SORT,
  builtins: TOUCHPOINT_BUILTIN_VIEWS,
  savedViewsTable: "touchpoint_saved_views",
  optionsView: "v_admin_touchpoints_filter_options",
}

/**
 * Is this value a PERSON we can draw initials for?
 *
 * Unlike Tasks — whose owner column mixes real names, two-letter staff codes and
 * queue names — every people value on this entity is a real full name:
 * `created_by_name` has 23 distinct values and `modified_by_name` 17, and the
 * only non-human among them is "CRM Administration", which takes a "CA" circle
 * harmlessly.
 *
 * The same space test is kept so the two pages behave identically, and so a
 * single-token value that appears later is shown verbatim rather than rendered
 * as one misleading letter.
 */
export function isPersonName(value: string | null | undefined): boolean {
  return !!value && value.trim().includes(" ")
}

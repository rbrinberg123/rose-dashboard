/**
 * The Contracts entity: its column catalog, its built-in views, and the
 * EntitySpec that binds them to the shared table machinery in lib/table-views/.
 *
 * Same shape as lib/notes/spec.ts: the catalog is DERIVED from
 * `CONTRACT_SECTIONS` in lib/contracts/record.ts — the drawer's field list — so
 * labels, types and ordering come from one place. What lives here is only which
 * view column backs each field, how wide it renders, how it is painted, and
 * which band it groups under.
 */

import type { ColumnDef, EntitySpec, FieldType, ViewSort } from "@/lib/table-views/types"
import { BUILTIN_PREFIX, TODAY_TOKEN, type BuiltinView } from "@/lib/table-views/types"
import { CONTRACT_SECTIONS, type ContractFieldType, type ContractRecord } from "./record"

/** How a contract cell is painted. */
export type ContractRenderer =
  | "text"
  | "date"
  | "ticker" // client symbol, linked to client detail, full name on hover
  | "number"
  | "money" // retainer with its currency
  | "bool" // Yes / No / em dash
  | "person"

export type ContractColumnDef = ColumnDef & { renderer: ContractRenderer }

/** Header bands, in picker order. A band is a run of ADJACENT columns. */
export const CONTRACT_COLUMN_GROUPS = [
  "Client",
  "Contract",
  "Term",
  "Retainer",
  "Termination",
  "Notes",
  "System",
] as const
export type ContractColumnGroup = (typeof CONTRACT_COLUMN_GROUPS)[number]

/** The drawer's paint type → the filter-builder's field type. */
const FILTER_TYPE: Record<ContractFieldType, FieldType> = {
  text: "text",
  date: "date",
  // Integers / numeric on the view: text operators would be a query error.
  number: "number",
  money: "number",
  toggle: "toggle",
  notes: "notes",
  link: "link",
  person: "person",
}

/** Per-field display facts, keyed by the drawer's `sourceKey` (= view column). */
const SOURCE: Partial<
  Record<
    keyof ContractRecord,
    {
      width: string
      renderer: ContractRenderer
      group: ContractColumnGroup
      header?: string
      title?: string
      compact?: boolean
    }
  >
> = {
  // ---- Client ----
  client_name: {
    width: "104px",
    renderer: "ticker",
    group: "Client",
    header: "Client",
    title: "Client ticker — full name on hover. Links to the client's detail page",
  },

  // ---- Contract ----
  contract_name: { width: "220px", renderer: "text", group: "Contract", header: "Contract" },
  scope: { width: "150px", renderer: "text", group: "Contract" },
  contract_status: { width: "110px", renderer: "text", group: "Contract", header: "Status" },
  referral_source: { width: "150px", renderer: "text", group: "Contract", header: "Referral" },

  // ---- Term ----
  start_date: { width: "96px", renderer: "date", group: "Term", header: "Start" },
  term_length_months: {
    width: "72px",
    renderer: "number",
    group: "Term",
    header: "Months",
    compact: true,
  },
  term_end: {
    width: "96px",
    renderer: "date",
    group: "Term",
    header: "Term End",
    title: "Calculated by the database: Start Date + Term Length. Read-only",
  },
  termination_notice_days: {
    width: "76px",
    renderer: "number",
    group: "Term",
    header: "Notice (d)",
    compact: true,
  },
  notice_date: {
    width: "96px",
    renderer: "date",
    group: "Term",
    header: "Notice Date",
    title: "Calculated by the database: Term End − Termination Notice days. Read-only",
  },
  auto_renew: { width: "76px", renderer: "bool", group: "Term", header: "Auto-Renew", compact: true },
  renewal_date: { width: "96px", renderer: "date", group: "Term", header: "Renewal" },

  // ---- Retainer ----
  quarterly_retainer: {
    width: "130px",
    renderer: "money",
    group: "Retainer",
    header: "Qtr Retainer",
  },
  currency: { width: "72px", renderer: "text", group: "Retainer", compact: true },

  // ---- Termination ----
  termination_date: {
    width: "100px",
    renderer: "date",
    group: "Termination",
    header: "Terminated",
    title: "The date the contract ACTUALLY ended — distinct from Term End",
  },
  termination_reason: { width: "200px", renderer: "text", group: "Termination", header: "Reason" },

  // ---- Notes ----
  notes: { width: "260px", renderer: "text", group: "Notes" },

  // ---- System ----
  origin: {
    width: "90px",
    renderer: "text",
    group: "System",
    title: "'dashboard' = created here (editable); 'dynamics' = synced, read-only until cutover",
  },
  created_by: { width: "92px", renderer: "person", group: "System" },
  modified_by_name: { width: "96px", renderer: "person", group: "System", header: "Modified By" },
  created_at: { width: "96px", renderer: "date", group: "System", header: "Created" },
  updated_at: { width: "96px", renderer: "date", group: "System", header: "Updated" },
}

/** The full catalog, in drawer order. */
export const CONTRACT_CATALOG: ContractColumnDef[] = CONTRACT_SECTIONS.flatMap((section) =>
  section.fields.flatMap((f) => {
    const src = SOURCE[f.sourceKey]
    if (!src) return []
    return [
      {
        key: String(f.sourceKey),
        label: f.label,
        header: src.header,
        title: src.title,
        section: src.group,
        type: FILTER_TYPE[f.type],
        width: src.width,
        renderer: src.renderer,
        compact: src.compact,
      } satisfies ContractColumnDef,
    ]
  }),
)

const BY_KEY = new Map(CONTRACT_CATALOG.map((c) => [c.key, c]))

export function getContractColumn(key: string): ContractColumnDef | undefined {
  return BY_KEY.get(key)
}

/** Catalog grouped for the picker — one heading per group, in group order. */
export function contractCatalogBySection(): { section: string; columns: ContractColumnDef[] }[] {
  return CONTRACT_COLUMN_GROUPS.map((g) => ({
    section: g as string,
    columns: CONTRACT_CATALOG.filter((c) => c.section === g),
  })).filter((g) => g.columns.length > 0)
}

/**
 * The default columns. Order decides the header bands:
 * Client | Contract (Contract, Scope, Status) | Term (Start, Months, Term End,
 * Notice Date, Auto-Renew, Renewal) | Retainer (Qtr Retainer).
 */
export const CONTRACT_DEFAULT_COLUMNS: string[] = [
  "client_name",
  "contract_name",
  "scope",
  "contract_status",
  "start_date",
  "term_length_months",
  "term_end",
  "notice_date",
  "auto_renew",
  "renewal_date",
  "quarterly_retainer",
]

/**
 * Always fetched: identity, the client id for the link, the ticker it shows,
 * the client + contract names (always in the Excel export), currency for the
 * money cell, and origin/is_test for the badges.
 */
export const CONTRACT_ALWAYS_SELECT = [
  "contract_id",
  "account_id",
  "client_ticker",
  "client_name",
  "contract_name",
  "currency",
  "origin",
  "is_test",
] as const

/** Latest term first. */
export const CONTRACT_DEFAULT_SORT: ViewSort = { field: "start_date", dir: "desc" }

/** Built-in views — code, not rows, so they always exist and need no seeding. */
export const CONTRACT_BUILTIN_VIEWS: BuiltinView[] = [
  {
    id: `${BUILTIN_PREFIX}all`,
    name: "All contracts",
    isFallbackDefault: true,
    config: { columns: CONTRACT_DEFAULT_COLUMNS, filters: [], sort: CONTRACT_DEFAULT_SORT },
  },
  {
    id: `${BUILTIN_PREFIX}upcoming_notice`,
    name: "Upcoming notice dates",
    config: {
      columns: CONTRACT_DEFAULT_COLUMNS,
      filters: [{ field: "notice_date", op: "after", value: TODAY_TOKEN }],
      sort: { field: "notice_date", dir: "asc" },
    },
  },
  {
    id: `${BUILTIN_PREFIX}upcoming_renewals`,
    name: "Upcoming renewals",
    config: {
      columns: CONTRACT_DEFAULT_COLUMNS,
      filters: [{ field: "renewal_date", op: "after", value: TODAY_TOKEN }],
      sort: { field: "renewal_date", dir: "asc" },
    },
  },
  {
    id: `${BUILTIN_PREFIX}dashboard`,
    name: "Created in dashboard",
    config: {
      columns: [...CONTRACT_DEFAULT_COLUMNS, "created_by", "created_at"],
      filters: [{ field: "origin", op: "eq", value: "dashboard" }],
      sort: { field: "created_at", dir: "desc" },
    },
  },
]

/** The Contracts entity, bound to the shared machinery. */
export const CONTRACTS_SPEC: EntitySpec = {
  key: "contracts",
  viewName: "v_admin_contracts_all",
  idColumn: "contract_id",
  alwaysSelect: CONTRACT_ALWAYS_SELECT,
  getColumn: getContractColumn,
  catalog: CONTRACT_CATALOG,
  defaultSort: CONTRACT_DEFAULT_SORT,
  builtins: CONTRACT_BUILTIN_VIEWS,
  savedViewsTable: "contract_saved_views",
  optionsView: "v_admin_contracts_filter_options",
}

/** Is this value a PERSON we can draw initials for? Same test as the other pages. */
export function isPersonName(value: string | null | undefined): boolean {
  return !!value && value.trim().includes(" ")
}

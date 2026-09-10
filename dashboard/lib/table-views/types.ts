/**
 * Shared vocabulary for the CRM admin tables (Meetings, Events, …).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Meetings and Events are the same page over different rows: a virtualised
 * table, saved views (system + personal, with a default), a server-side filter
 * builder, quick-filter dropdowns, a detail drawer and an Excel export. All of
 * that logic is identical; only the columns, the source view and the built-in
 * presets differ.
 *
 * So the machinery lives here and in its siblings (config.ts, query.ts,
 * saved-views.ts), parameterised by an `EntitySpec`. Each entity supplies a spec
 * and its own column catalog; nothing about filtering, validation, paging or
 * authorisation is written twice — which matters most for saved-views.ts, where
 * a second copy of the authorisation rules is a second place for them to be
 * wrong.
 */

/**
 * How a field renders, and what input it would become if these tables ever
 * became editable. Drives the operator set the filter builder offers.
 */
export type FieldType =
  | "text"
  | "date"
  | "person"
  | "toggle"
  | "notes"
  | "link"
  // A column that is an INTEGER on the source view. Its own type because the
  // text operators are not merely useless on one, they are fatal: PostgREST
  // sends `contains` as ilike, and `integer ~~* unknown` is error 42883, which
  // blanks the page rather than returning nothing.
  | "number"

/** One column a table can show. Entities extend this with their own renderers. */
export type ColumnDef = {
  /** Stable id — the column name on the source view, and what a saved view stores. */
  key: string
  /** Full label, shown in the column picker and used as the Excel header. */
  label: string
  /** Shorter label for the table header, when the full one will not fit. */
  header?: string
  /** Header tooltip — spells out an abbreviated column's real meaning. */
  title?: string
  /** The band this column sits under. */
  section: string
  type: FieldType
  width: string
  /** Centre + tighter padding: for columns painting a mark, not a sentence. */
  compact?: boolean
  /** Extension point: a column sourced from a 1-1 related table. Not built. */
  related?: { table: string; foreignKey: string; column: string }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * The operators a filter condition can use. A small, closed set: every one maps
 * to exactly one PostgREST method in query.ts, so nothing a user builds can turn
 * into arbitrary query syntax.
 */
export type FilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "startsWith"
  | "isEmpty"
  | "isNotEmpty"
  | "before" // date <
  | "after" // date >=
  | "isTrue"
  | "isFalse"

export type FilterCondition = {
  /** A column key from the entity's catalog. */
  field: string
  op: FilterOp
  /** Ignored by the value-less operators (isEmpty / isTrue / …). */
  value?: string
}

export type SortDir = "asc" | "desc"
export type ViewSort = { field: string; dir: SortDir }

export type ViewConfig = {
  /** Ordered column keys — this IS the table's column order. */
  columns: string[]
  /** Combined with AND. An empty list means "no filter". */
  filters: FilterCondition[]
  sort: ViewSort
}

/** Which operators make sense for a field type. Drives the builder's dropdown. */
export const OPS_FOR_TYPE: Record<FieldType, FilterOp[]> = {
  text: ["eq", "neq", "contains", "startsWith", "isEmpty", "isNotEmpty"],
  // No contains/startsWith: see the note on FieldType. Every op here maps to a
  // PostgREST method that an integer column accepts.
  number: ["eq", "neq", "isEmpty", "isNotEmpty"],
  link: ["eq", "neq", "contains", "startsWith", "isEmpty", "isNotEmpty"],
  person: ["contains", "eq", "isEmpty", "isNotEmpty"],
  date: ["after", "before", "isEmpty", "isNotEmpty"],
  toggle: ["isTrue", "isFalse", "isEmpty"],
  notes: ["contains", "isEmpty", "isNotEmpty"],
}

export const OP_LABELS: Record<FilterOp, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  startsWith: "starts with",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  before: "is before",
  after: "is on or after",
  isTrue: "is Yes",
  isFalse: "is No",
}

/** Operators that carry no value — the builder hides the value box for these. */
export const VALUELESS_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>([
  "isEmpty",
  "isNotEmpty",
  "isTrue",
  "isFalse",
])

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

export const BUILTIN_PREFIX = "builtin:"

/**
 * `$today` is substituted server-side with the Eastern calendar day at request
 * time. Not a general expression language — the one token the built-ins need,
 * which is what lets a saved view stay rolling rather than frozen to the day it
 * was saved. `$tomorrow` is its partner, for same-day ranges.
 */
export const TODAY_TOKEN = "$today"
export const TOMORROW_TOKEN = "$tomorrow"

export type BuiltinView = {
  id: string
  name: string
  config: ViewConfig
  /** The one the page falls back to when nothing else is defaulted. */
  isFallbackDefault?: boolean
}

export type SavedViewScope = "system" | "personal"

/** A view as the switcher sees it — built-in or row, both flattened to this. */
export type SavedView = {
  id: string
  scope: SavedViewScope
  name: string
  config: ViewConfig
  isDefault: boolean
  /** Built-ins cannot be edited, deleted, or defaulted. */
  builtin: boolean
  /** True when the signed-in caller owns this personal view. */
  mine: boolean
}

// ---------------------------------------------------------------------------
// The entity contract
// ---------------------------------------------------------------------------

/**
 * Everything the shared machinery needs to know about one CRM table.
 *
 * Adding a third page should mean writing one of these plus a column catalog —
 * not another copy of the query, validation and authorisation layers.
 */
export type EntitySpec = {
  /** For messages and debugging, e.g. "meetings". */
  key: string
  /** The Postgres view the list reads. */
  viewName: string
  /** Primary key column — the row identity and the pagination tiebreaker. */
  idColumn: string
  /** Always fetched whatever the view asks for (ids the table needs for links). */
  alwaysSelect: readonly string[]
  /** Resolve a column key against this entity's catalog. */
  getColumn: (key: string) => ColumnDef | undefined
  /** Every column the entity knows, for the picker. */
  catalog: ColumnDef[]
  /** Sort used when a view names a column the deployed view does not have. */
  defaultSort: ViewSort
  /** The read-only presets, always present, never editable. */
  builtins: BuiltinView[]
  /** The saved-views table for this entity. */
  savedViewsTable: string
  /** The distinct-values view backing the quick-filter dropdowns. */
  optionsView: string
}

/** Every operator valid for a field, per the entity's catalog. */
export function opsForField(spec: EntitySpec, field: string): FilterOp[] {
  const col = spec.getColumn(field)
  return col ? OPS_FOR_TYPE[col.type] : OPS_FOR_TYPE.text
}

/** The entity's fallback view — what opens when nothing is defaulted. */
export function fallbackView(spec: EntitySpec): BuiltinView {
  return spec.builtins.find((v) => v.isFallbackDefault) ?? spec.builtins[0]
}

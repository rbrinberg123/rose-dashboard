/**
 * Turn a view config into an actual query — server-side, which is the point.
 *
 * Filters are applied in the DATABASE, never in the browser: these views are
 * thousands of rows and a page must only fetch the active view's set. The
 * built-in presets are expressed as ordinary filter conditions, so there is one
 * filter path per entity, not a preset path plus a filter path.
 *
 * ── THE CLOSED SET ─────────────────────────────────────────────────────────
 * `field` is always checked against the entity's catalog and `op` against a
 * fixed switch. Nothing a user types reaches PostgREST as syntax:
 *   * a field not in the catalog is dropped,
 *   * an operator outside the switch cannot exist (closed union + parseConfig),
 *   * values only ever arrive as the ARGUMENT to a builder method.
 * The one place a value enters PostgREST grammar is the `contains` /
 * `startsWith` ilike pattern, which escapes the metacharacters. See
 * `likePattern`.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  OPS_FOR_TYPE,
  TODAY_TOKEN,
  TOMORROW_TOKEN,
  VALUELESS_OPS,
  type EntitySpec,
  type FilterCondition,
  type ViewConfig,
} from "./types"

const NY_TZ = "America/New_York"

const EASTERN_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: NY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** How far Eastern is from UTC at `date`, in ms (negative: -5h EST / -4h EDT). */
export function easternOffsetMs(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  // hour12:false renders midnight as "24" in some engines; %24 normalises it.
  const wallAsUtc = Date.UTC(
    g("year"),
    g("month") - 1,
    g("day"),
    g("hour") % 24,
    g("minute"),
    g("second"),
  )
  return wallAsUtc - date.getTime()
}

/**
 * The UTC instant at which an Eastern calendar day begins, as an ISO string
 * PostgREST can compare against a timestamptz.
 *
 * This is what lets an Eastern-day filter be a plain timestamp range: "the row's
 * Eastern day is >= today" is exactly "the instant is >= Eastern midnight
 * today". No per-row time-zone conversion, so a date index still applies. Two
 * passes, so a day starting on a DST changeover lands on the right side.
 */
export function easternDayStartIso(y: number, m: number, d: number): string {
  const wall = Date.UTC(y, m - 1, d)
  let t = wall - easternOffsetMs(new Date(wall))
  t = wall - easternOffsetMs(new Date(t))
  return new Date(t).toISOString()
}

/** `$today` / `$tomorrow` / a literal YYYY-MM-DD → the matching Eastern midnight. */
function resolveDateValue(value: string | undefined, now: Date): string | null {
  if (!value) return null
  const [y, m, d] = EASTERN_YMD.format(now).split("-").map(Number)
  if (value === TODAY_TOKEN) return easternDayStartIso(y, m, d)
  if (value === TOMORROW_TOKEN) return easternDayStartIso(y, m, d + 1)
  const literal = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (literal) {
    return easternDayStartIso(Number(literal[1]), Number(literal[2]), Number(literal[3]))
  }
  // Anything else: hand it over and let Postgres parse or reject it.
  return value.trim()
}

/**
 * Escape PostgREST's `ilike` metacharacters so a value matches literally.
 *
 * `%` and `_` are wildcards; a comma would end the filter argument and a
 * parenthesis or dot can be read as structure. Values carrying those are why
 * this exists rather than a template literal at the call site.
 */
function likePattern(value: string, shape: "contains" | "startsWith"): string {
  const escaped = value.trim().replace(/([%_\\])/g, "\\$1")
  return shape === "contains" ? `%${escaped}%` : `${escaped}%`
}

/** Values PostgREST cannot carry inside a filter argument unquoted. */
function needsQuoting(value: string): boolean {
  return /[,.():\s"]/.test(value)
}

/** Wrap a value in double quotes for PostgREST when it contains structure. */
export function quoteValue(value: string): string {
  return needsQuoting(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

/**
 * A PostgREST filter builder, structurally.
 *
 * Typed this way rather than against the concrete `PostgrestFilterBuilder` so
 * one function serves the row query and the `head: true` count query, whose
 * select() overloads differ. Expressing "returns this" as a generic bound makes
 * TypeScript recurse until it gives up, so the casts at the boundaries confine a
 * typing problem rather than papering over a real one.
 */
export type Filterable = {
  eq(column: string, value: unknown): Filterable
  neq(column: string, value: unknown): Filterable
  is(column: string, value: null | boolean): Filterable
  not(column: string, op: string, value: unknown): Filterable
  gte(column: string, value: string): Filterable
  lt(column: string, value: string): Filterable
  ilike(column: string, pattern: string): Filterable
  or(filters: string): Filterable
  in(column: string, values: readonly string[]): Filterable
}

/** True when a column can actually be queried right now. */
export function usable(key: string, available: Set<string> | null): boolean {
  return available === null || available.has(key)
}

/**
 * Apply one condition. Returns the builder unchanged when the condition cannot
 * be expressed — parseConfig has already rejected the malformed cases, so what
 * reaches here and still cannot apply is a retired or undeployed column, which
 * should widen the result rather than error the page.
 */
function applyCondition(
  spec: EntitySpec,
  q: Filterable,
  c: FilterCondition,
  now: Date,
  available: Set<string> | null,
): Filterable {
  const col = spec.getColumn(c.field)
  if (!col) return q
  // Extension point: a related-table column would need a PostgREST embed rather
  // than a top-level filter. None exist yet; skip rather than mis-filter.
  if (col.related) return q
  // Not in the deployed view yet: skipping WIDENS the result, which is the safe
  // direction — the alternative is a query error that blanks the page.
  if (!usable(col.key, available)) return q

  const field = col.key
  const value = c.value?.trim() ?? ""

  // Belt-and-braces for the integer columns. parseConfig already drops both of
  // these before a config is ever stored or read, so nothing the UI builds gets
  // here — but the failure mode is a query ERROR, which blanks the page, rather
  // than an empty result, so the query layer does not rely on that alone.
  //   - a text operator on an integer is 42883 (integer ~~* unknown)
  //   - a non-numeric value on an integer is 22P02
  // Skipping widens the result, the same choice the undeployed-column guard
  // above makes. Note Number("") is 0, so emptiness is a SEPARATE test.
  if (col.type === "number" && !VALUELESS_OPS.has(c.op)) {
    if (!OPS_FOR_TYPE.number.includes(c.op)) return q
    if (value === "" || !Number.isFinite(Number(value))) return q
  }

  switch (c.op) {
    case "eq":
      return q.eq(field, value)
    case "neq":
      // `neq` alone would also exclude NULL rows, which reads wrong for "is not
      // X" — a row with no value is not the thing being excluded.
      return q.or(`${field}.neq.${quoteValue(value)},${field}.is.null`)
    case "contains":
      return q.ilike(field, likePattern(value, "contains"))
    case "startsWith":
      return q.ilike(field, likePattern(value, "startsWith"))
    case "isEmpty":
      return q.is(field, null)
    case "isNotEmpty":
      return q.not(field, "is", null)
    case "after": {
      const iso = resolveDateValue(c.value, now)
      return iso ? q.gte(field, iso) : q
    }
    case "before": {
      const iso = resolveDateValue(c.value, now)
      return iso ? q.lt(field, iso) : q
    }
    case "isTrue":
      return q.is(field, true)
    case "isFalse":
      return q.is(field, false)
    default:
      return q
  }
}

/** Apply every condition in the config — combined with AND. */
export function applyFilters<Q>(
  spec: EntitySpec,
  q: Q,
  config: ViewConfig,
  now: Date,
  available: Set<string> | null = null,
): Q {
  let out = q as unknown as Filterable
  for (const c of config.filters) out = applyCondition(spec, out, c, now, available)
  return out as unknown as Q
}

/**
 * The `select()` list for a view: its visible columns, the always-needed ids and
 * the sort field (which can be a column the view does not display).
 *
 * Explicitly NOT `*`. These views carry long-text notes columns that a
 * 14-column layout never shows; `*` would drag them into every row of every
 * query.
 */
export function selectListFor(
  spec: EntitySpec,
  config: ViewConfig,
  available: Set<string> | null = null,
): string {
  const keys = new Set<string>()
  keys.add(spec.idColumn)
  for (const key of spec.alwaysSelect) {
    if (key !== spec.idColumn && usable(key, available)) keys.add(key)
  }
  for (const key of config.columns) {
    const col = spec.getColumn(key)
    if (col && !col.related && usable(col.key, available)) keys.add(col.key)
  }
  const sortCol = spec.getColumn(config.sort.field)
  if (sortCol && !sortCol.related && usable(sortCol.key, available)) keys.add(sortCol.key)
  return [...keys].join(",")
}

/** PostgREST caps a response at db-max-rows (1,000 on Supabase Cloud). */
const PAGE_SIZE = 1000

/**
 * The most rows a PAGE will fetch, however big the view is.
 *
 * The table only ever paints ~30 rows, and nobody finds a record by scrolling to
 * row 9,000 — they filter. When the cap bites the toolbar says so. The Excel
 * export is NOT capped: see fetchAllRows.
 */
export const ROW_CAP = 2000

/** An entity-specific narrowing applied on top of the view's own filters. */
export type ExtraFilter = <Q>(q: Q) => Q

const identity: ExtraFilter = (q) => q

/**
 * Fetch a view's rows, paging past the response cap and stopping at `cap`.
 *
 * The id column is the tiebreaker on every sort: the sort column is rarely
 * unique and often nullable, and without a stable tiebreaker pagination can drop
 * or repeat rows at a page boundary.
 */
export async function fetchRows<T>(
  sb: SupabaseClient,
  spec: EntitySpec,
  config: ViewConfig,
  now: Date,
  available: Set<string> | null = null,
  extra: ExtraFilter = identity,
  /** null = no cap (the export path). */
  cap: number | null = ROW_CAP,
): Promise<{ rows: T[]; error: string | null; truncated: boolean }> {
  const select = selectListFor(spec, config, available)
  // ORDER BY on a column the view does not have is an error too, so an
  // unavailable sort field falls back to the entity's default.
  const sortField = usable(config.sort.field, available)
    ? config.sort.field
    : spec.defaultSort.field
  const rows: T[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    // Ask for ONE more than the cap on the last page, so a full result and a
    // truncated one are distinguishable without a second count query.
    const remaining = cap === null ? PAGE_SIZE : Math.min(PAGE_SIZE, cap + 1 - rows.length)
    if (remaining <= 0) break

    const { data, error } = await extra(
      applyFilters(spec, sb.from(spec.viewName).select(select), config, now, available),
    )
      .order(sortField, { ascending: config.sort.dir === "asc", nullsFirst: false })
      .order(spec.idColumn, { ascending: true })
      .range(offset, offset + remaining - 1)

    if (error) return { rows, error: error.message, truncated: false }
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < remaining) break
  }

  const truncated = cap !== null && rows.length > cap
  return { rows: truncated ? rows.slice(0, cap) : rows, error: null, truncated }
}

/**
 * The UNCAPPED fetch, for the Excel export only.
 *
 * The export is an explicit click with a spinner, so it may pull the whole
 * filtered set even when the screen showed the first ROW_CAP of it — otherwise
 * capping the page would quietly start truncating people's spreadsheets.
 */
export async function fetchAllRows<T>(
  sb: SupabaseClient,
  spec: EntitySpec,
  config: ViewConfig,
  now: Date,
  available: Set<string> | null = null,
  extra: ExtraFilter = identity,
): Promise<{ rows: T[]; error: string | null }> {
  const { rows, error } = await fetchRows<T>(sb, spec, config, now, available, extra, null)
  return { rows, error }
}

/** Row count for a view without fetching any rows. */
export async function countRows(
  sb: SupabaseClient,
  spec: EntitySpec,
  config: ViewConfig,
  now: Date,
  available: Set<string> | null = null,
  extra: ExtraFilter = identity,
): Promise<number | null> {
  const { count, error } = await extra(
    applyFilters(
      spec,
      sb.from(spec.viewName).select(spec.idColumn, { count: "exact", head: true }),
      config,
      now,
      available,
    ),
  )
  return error ? null : (count ?? null)
}

/**
 * Which columns the DEPLOYED view actually has, memoised per process in
 * production and probed every time in development (see the note below).
 *
 * The catalog can be bigger than the view until a migration runs, and naming a
 * column PostgREST does not know is a hard ERROR — not an empty column. One
 * missing column would take the whole page down. Asking the database what it has
 * makes every SQL state loadable: unavailable columns are dropped from the
 * select list and their filters skipped.
 *
 * Memoised because it asks the database for its own column names, which change
 * only when a migration runs. A deploy restarts the process, which is the same
 * deal every other schema assumption here has.
 *
 * Returns null when it CANNOT tell (an error, or a view with no rows), and null
 * means "do not filter anything out" — the optimistic branch.
 */
const columnCache = new Map<string, Set<string>>()

export async function availableColumns(
  sb: SupabaseClient,
  spec: EntitySpec,
): Promise<Set<string> | null> {
  // NOT cached in development. A deploy restarts the process, so in production
  // the cache can only ever be as stale as the running build — but in dev the
  // server outlives the database, and running a migration by hand against a live
  // `next dev` left the page silently blank in the new columns until someone
  // restarted it. Blank cells with correct headers is a genuinely confusing
  // symptom, and one probe per request is nothing next to a dev recompile.
  const hit = columnCache.get(spec.viewName)
  if (hit && process.env.NODE_ENV === "production") return hit
  const { data, error } = await sb.from(spec.viewName).select("*").limit(1)
  if (error) return null
  const row = (data ?? [])[0]
  if (!row) return null
  const cols = new Set(Object.keys(row))
  columnCache.set(spec.viewName, cols)
  return cols
}

/* ---------------------------------------------------------------------------
 * Quick-filter dropdown options
 * ------------------------------------------------------------------------ */

export type FilterOption = { value: string; label: string; count: number }

/** Raw rows from an entity's `*_filter_options` view, grouped by `kind`. */
export type FilterOptionGroups = Record<string, FilterOption[]>

/**
 * The distinct values behind an entity's quick-filter dropdowns.
 *
 * One request against the entity's options view — a few hundred rows with the
 * distinct-ing done in Postgres, because PostgREST has no DISTINCT and scanning
 * the whole table to build a dropdown is exactly the cost these views remove.
 *
 * Returns an empty map on error rather than throwing: the dropdowns degrade to
 * "unavailable" and the table is unaffected. Callers fetch this OFF the critical
 * path (see each page's actions file) — nothing on screen needs it to paint.
 */
export async function loadFilterOptionGroups(
  sb: SupabaseClient,
  spec: EntitySpec,
  countColumn: string,
): Promise<FilterOptionGroups> {
  const { data, error } = await sb
    .from(spec.optionsView)
    .select(`kind, value, label, ${countColumn}`)
    .order("label", { ascending: true })
  if (error || !data) return {}

  const out: FilterOptionGroups = {}
  for (const r of data as unknown as Record<string, unknown>[]) {
    const kind = String(r.kind ?? "")
    const value = r.value == null ? "" : String(r.value)
    if (!kind || !value) continue
    ;(out[kind] ??= []).push({
      value,
      label: r.label == null ? value : String(r.label),
      count: Number(r[countColumn]) || 0,
    })
  }
  return out
}

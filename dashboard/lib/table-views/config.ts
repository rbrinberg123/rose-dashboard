/**
 * View-config VALIDATION and DEFAULT RESOLUTION, shared by every CRM table.
 *
 * Pure — no React, no I/O — so the same rules run in the server action that
 * writes a view and in the client that builds one. The action layer is the only
 * thing that trusts a config, and it only trusts one that came through
 * `parseConfig` here.
 */

import {
  BUILTIN_PREFIX,
  VALUELESS_OPS,
  fallbackView,
  opsForField,
  type EntitySpec,
  type FilterCondition,
  type FilterOp,
  type SavedView,
  type ViewConfig,
} from "./types"

/**
 * Narrow an untrusted config — a request body, or a jsonb blob written by an
 * older build — into a `ViewConfig` for this entity.
 *
 * FAILS LOUD on anything structurally wrong (a non-array `columns`, a filter
 * that is not an object), because a silently-repaired config is how a saved view
 * starts quietly showing the wrong rows. It does DROP individual unknown column
 * keys and operators, which is the one forgiving case on purpose: a column
 * retired from the catalog should not brick every saved view that mentioned it.
 */
export function parseConfig(
  spec: EntitySpec,
  input: unknown,
): { ok: true; config: ViewConfig } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Config must be an object." }
  }
  const raw = input as Record<string, unknown>
  const known = (k: string) => spec.getColumn(k) !== undefined

  if (!Array.isArray(raw.columns)) return { ok: false, error: "Config.columns must be an array." }
  const columns = raw.columns.filter((c): c is string => typeof c === "string" && known(c))
  // De-duplicate but keep first-seen order — a repeated key would render the
  // same cell twice and break the column/index pairing in the table.
  const seen = new Set<string>()
  const uniqueColumns = columns.filter((c) => (seen.has(c) ? false : (seen.add(c), true)))
  if (uniqueColumns.length === 0) {
    return { ok: false, error: "A view must show at least one column." }
  }

  const rawFilters = raw.filters === undefined ? [] : raw.filters
  if (!Array.isArray(rawFilters)) return { ok: false, error: "Config.filters must be an array." }
  const filters: FilterCondition[] = []
  for (const f of rawFilters) {
    if (!f || typeof f !== "object") return { ok: false, error: "Each filter must be an object." }
    const c = f as Record<string, unknown>
    if (typeof c.field !== "string" || !known(c.field)) continue // retired column
    if (typeof c.op !== "string") return { ok: false, error: "Each filter needs an operator." }
    const op = c.op as FilterOp
    if (!opsForField(spec, c.field).includes(op)) continue // no longer valid for the type
    const value = typeof c.value === "string" ? c.value : undefined
    if (!VALUELESS_OPS.has(op) && (value === undefined || value.trim() === "")) {
      return { ok: false, error: `Filter on "${c.field}" needs a value.` }
    }
    filters.push({ field: c.field, op, value })
  }

  const rawSort = (raw.sort ?? {}) as Record<string, unknown>
  const sortField =
    typeof rawSort.field === "string" && known(rawSort.field)
      ? rawSort.field
      : spec.defaultSort.field
  const sortDir = rawSort.dir === "asc" || rawSort.dir === "desc" ? rawSort.dir : spec.defaultSort.dir

  return {
    ok: true,
    config: { columns: uniqueColumns, filters, sort: { field: sortField, dir: sortDir } },
  }
}

/**
 * An UNSAVED working config, carried in the URL as `?cfg=`.
 *
 * Column and filter edits have to reach the SERVER — filters are applied in the
 * query, so "Apply" cannot just be local state. Rather than persisting a draft
 * row, the working config rides in the URL: the page validates it with
 * `parseConfig` and uses it in place of the named view's own config. That keeps
 * one filter path (server-side), makes an in-progress view shareable, and leaves
 * the saved row untouched until someone presses Save.
 *
 * Plain JSON rather than base64 — URLSearchParams handles the escaping, and a
 * legible `?cfg=` is far easier to debug.
 */
export function encodeConfig(config: ViewConfig): string {
  return JSON.stringify(config)
}

/** Decode a `?cfg=` param. Anything unparseable is ignored, not fatal. */
export function decodeConfig(spec: EntitySpec, raw: string | null | undefined): ViewConfig | null {
  if (!raw) return null
  try {
    const parsed = parseConfig(spec, JSON.parse(raw))
    return parsed.ok ? parsed.config : null
  } catch {
    return null
  }
}

/** True when the working config differs from the saved view it started from. */
export function configsDiffer(a: ViewConfig, b: ViewConfig): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

/**
 * Which view the page opens on:
 *
 *   1. an explicit `?view=<id>` (the switcher's own navigation), else
 *   2. the caller's PERSONAL default, else
 *   3. the SYSTEM default, else
 *   4. the entity's built-in fallback.
 *
 * A `?view=` naming something the caller cannot see — another user's personal
 * view, or a deleted one — falls through the same chain rather than erroring. An
 * unreachable id is a stale bookmark, not an attack worth a 500.
 */
export function resolveActiveView(
  spec: EntitySpec,
  views: SavedView[],
  requestedId?: string | null,
): SavedView {
  if (requestedId) {
    const hit = views.find((v) => v.id === requestedId)
    if (hit) return hit
  }
  const personalDefault = views.find((v) => v.scope === "personal" && v.mine && v.isDefault)
  if (personalDefault) return personalDefault

  const systemDefault = views.find((v) => v.scope === "system" && v.isDefault && !v.builtin)
  if (systemDefault) return systemDefault

  const fb = fallbackView(spec)
  return views.find((v) => v.id === fb.id) ?? views[0]
}

/** The entity's built-ins as SavedViews, for merging with the rows from the table. */
export function builtinSavedViews(spec: EntitySpec): SavedView[] {
  return spec.builtins.map((b) => ({
    id: b.id,
    scope: "system" as const,
    name: b.name,
    config: b.config,
    isDefault: false,
    builtin: true,
    mine: false,
  }))
}

/** True for the code-defined views, which have no row to edit. */
export function isBuiltinId(id: string): boolean {
  return id.startsWith(BUILTIN_PREFIX)
}

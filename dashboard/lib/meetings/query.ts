/**
 * Meetings' query layer — a BINDING over lib/table-views/query.ts, plus the one
 * genuinely meetings-specific piece: the Client / Host / Feedback quick filters.
 *
 * Everything generic (select-list building, filter translation, paging, the row
 * cap, the column probe) lives in the shared module. If you are changing HOW a
 * filter becomes SQL, change lib/table-views/query.ts — not this file.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  ROW_CAP,
  applyFilters as sharedApplyFilters,
  availableColumns as sharedAvailableColumns,
  countRows,
  fetchAllRows,
  fetchRows,
  loadFilterOptionGroups,
  quoteValue,
  selectListFor as sharedSelectListFor,
  usable,
  type ExtraFilter,
  type FilterOption,
  type Filterable,
} from "@/lib/table-views/query"
import type { ViewConfig } from "@/lib/table-views/types"
import { MEETINGS_SPEC } from "./spec"

export { ROW_CAP, easternDayStartIso } from "@/lib/table-views/query"
export type { FilterOption } from "@/lib/table-views/query"

export const MEETINGS_VIEW = MEETINGS_SPEC.viewName

export function applyFilters<Q>(
  q: Q,
  config: ViewConfig,
  now: Date,
  available: Set<string> | null = null,
): Q {
  return sharedApplyFilters(MEETINGS_SPEC, q, config, now, available)
}

export function selectListFor(config: ViewConfig, available: Set<string> | null = null): string {
  return sharedSelectListFor(MEETINGS_SPEC, config, available)
}

export async function availableColumns(sb: SupabaseClient): Promise<Set<string> | null> {
  return sharedAvailableColumns(sb, MEETINGS_SPEC)
}

/* ---------------------------------------------------------------------------
 * QUICK FILTERS — the Client / Host / Feedback dropdowns in the toolbar
 *
 * These sit ON TOP of the active view's own filters and AND with them (and with
 * the keyword box, which stays in the browser over the already-narrowed set).
 *
 * Deliberately NOT part of ViewConfig. A saved view is a shape you return to;
 * these are ad-hoc narrowing you apply and drop. Keeping them out means
 * selecting a host does not mark the view "edited" or offer to save "Upcoming,
 * but only Kate's". They ride in their own URL params instead, so they are still
 * shareable and still server-side.
 * ------------------------------------------------------------------------ */

export type QuickFilters = {
  /** accounts.account_id — the id, not the name (two accounts could share one). */
  client?: string
  /** A host's CANONICAL user id, expanded to the whole alias group. */
  host?: string
  /** The feedback assignee's name — an indexed column since the 2026-09-10 patch. */
  feedback?: string
}

/** canonical host id -> every systemuser id that is the same person. */
export type HostAliasGroups = Map<string, string[]>

export const EMPTY_QUICK_FILTERS: QuickFilters = {}

export function hasQuickFilters(f: QuickFilters): boolean {
  return !!(f.client || f.host || f.feedback)
}

/**
 * Every host_id that belongs to the same person as `canonicalId`.
 *
 * Live data has 28 distinct host_ids but only 26 distinct host NAMES: two people
 * carry duplicate Dynamics systemuser records, both registered in
 * public.user_id_aliases. Filtering on a single host_id would silently return
 * half of either person's meetings. So the dropdown's value is the CANONICAL id
 * and it expands here to every id in that group — still a plain index scan on
 * idx_meetings_host's leading column.
 */
function hostIdsFor(canonicalId: string, aliasGroups: HostAliasGroups): string[] {
  return aliasGroups.get(canonicalId) ?? [canonicalId]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The PRE-PATCH host filter: match a host NAME as a whole token inside
 * host_names.
 *
 * A fallback for the window before sql/patches/2026-09-10_meetings_perf.sql
 * runs. In that state the view has no host_id column, so the indexed path is not
 * available — and naming a column PostgREST does not know is a hard error, which
 * would blank the page rather than merely slow it.
 *
 * host_names is a ", "-joined list, so "is host X" is four cases: X alone, X
 * first, X last, X in the middle. Correct, but unindexable — which is exactly
 * why the patch exists.
 */
function hostTokenFilter(name: string): string {
  const v = name.trim()
  const lk = v.replace(/([%_\\])/g, "\\$1")
  return [
    `host_names.eq.${quoteValue(v)}`,
    `host_names.like.${quoteValue(`${lk}, %`)}`,
    `host_names.like.${quoteValue(`%, ${lk}`)}`,
    `host_names.like.${quoteValue(`%, ${lk}, %`)}`,
  ].join(",")
}

export function applyQuickFilters<Q>(
  q: Q,
  filters: QuickFilters,
  aliasGroups: HostAliasGroups = new Map(),
  available: Set<string> | null = null,
): Q {
  let out = q as unknown as Filterable
  if (filters.client) out = out.eq("client_account_id", filters.client)
  if (filters.host) {
    const indexed = usable("host_id", available) && UUID_RE.test(filters.host)
    out = indexed
      ? out.in("host_id", hostIdsFor(filters.host, aliasGroups))
      : out.or(hostTokenFilter(filters.host))
  }
  if (filters.feedback) out = out.eq("feedback_name", filters.feedback)
  return out as unknown as Q
}

/** Wrap the quick filters as the shared fetcher's `extra` step. */
function quickExtra(
  quick: QuickFilters,
  aliasGroups: HostAliasGroups,
  available: Set<string> | null,
): ExtraFilter {
  return ((q: unknown) => applyQuickFilters(q, quick, aliasGroups, available)) as ExtraFilter
}

/**
 * Load the host alias groups: canonical id -> [canonical, ...its aliases].
 * Mirrors public.canonical_user_id, the same way lib/graph/hosts.ts does. Tiny
 * table, memoised for the life of the process.
 */
let cachedAliasGroups: HostAliasGroups | null = null

export async function loadHostAliasGroups(sb: SupabaseClient): Promise<HostAliasGroups> {
  if (cachedAliasGroups) return cachedAliasGroups
  const groups: HostAliasGroups = new Map()
  const { data, error } = await sb
    .from("user_id_aliases")
    .select("alias_user_id, canonical_user_id")
  if (error) return groups // fail soft: filter degrades to the canonical id alone
  for (const r of (data ?? []) as { alias_user_id: string; canonical_user_id: string }[]) {
    const list = groups.get(r.canonical_user_id) ?? [r.canonical_user_id]
    if (!list.includes(r.alias_user_id)) list.push(r.alias_user_id)
    groups.set(r.canonical_user_id, list)
  }
  cachedAliasGroups = groups
  return groups
}

/* ------------------------------------------------------------------------ */

export async function fetchViewRows<T>(
  sb: SupabaseClient,
  config: ViewConfig,
  now: Date,
  available: Set<string> | null = null,
  quick: QuickFilters = EMPTY_QUICK_FILTERS,
  aliasGroups: HostAliasGroups = new Map(),
  cap: number | null = ROW_CAP,
): Promise<{ rows: T[]; error: string | null; truncated: boolean }> {
  return fetchRows<T>(
    sb,
    MEETINGS_SPEC,
    config,
    now,
    available,
    quickExtra(quick, aliasGroups, available),
    cap,
  )
}

/** The UNCAPPED fetch, for the Excel export only. */
export async function fetchAllViewRows<T>(
  sb: SupabaseClient,
  config: ViewConfig,
  now: Date,
  available: Set<string> | null = null,
  quick: QuickFilters = EMPTY_QUICK_FILTERS,
  aliasGroups: HostAliasGroups = new Map(),
): Promise<{ rows: T[]; error: string | null }> {
  return fetchAllRows<T>(
    sb,
    MEETINGS_SPEC,
    config,
    now,
    available,
    quickExtra(quick, aliasGroups, available),
  )
}

export async function countViewRows(
  sb: SupabaseClient,
  config: ViewConfig,
  now: Date,
  available: Set<string> | null = null,
  quick: QuickFilters = EMPTY_QUICK_FILTERS,
  aliasGroups: HostAliasGroups = new Map(),
): Promise<number | null> {
  return countRows(
    sb,
    MEETINGS_SPEC,
    config,
    now,
    available,
    quickExtra(quick, aliasGroups, available),
  )
}

/* ---------------------------------------------------------------------------
 * Filter-dropdown options
 * ------------------------------------------------------------------------ */

export type FilterOptions = {
  clients: FilterOption[]
  hosts: FilterOption[]
  feedback: FilterOption[]
}

export const EMPTY_FILTER_OPTIONS: FilterOptions = { clients: [], hosts: [], feedback: [] }

/**
 * The three dropdowns' choices.
 *
 * Prefers v_admin_meetings_filter_options — one request, a few hundred rows,
 * the distinct-ing done in Postgres. Falls back to a THREE-COLUMN scan of the
 * admin view when that patch has not been run: still server-side and still only
 * three narrow columns, but it walks every row, which is precisely the cost the
 * view exists to remove. Callers fetch this OFF the critical path.
 */
export async function loadFilterOptions(sb: SupabaseClient): Promise<FilterOptions> {
  const groups = await loadFilterOptionGroups(sb, MEETINGS_SPEC, "meeting_count")
  if (groups.client || groups.host || groups.feedback) {
    return {
      clients: groups.client ?? [],
      hosts: groups.host ?? [],
      feedback: groups.feedback ?? [],
    }
  }
  return loadFilterOptionsFallback(sb)
}

/** The no-patch path — see loadFilterOptions. */
async function loadFilterOptionsFallback(sb: SupabaseClient): Promise<FilterOptions> {
  const clients = new Map<string, FilterOption>()
  const hosts = new Map<string, FilterOption>()
  const feedback = new Map<string, FilterOption>()

  const bump = (m: Map<string, FilterOption>, value: string, label: string) => {
    const hit = m.get(value)
    if (hit) hit.count += 1
    else m.set(value, { value, label, count: 1 })
  }

  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from(MEETINGS_VIEW)
      .select("client_account_id, client_account_name, host_names, feedback_name")
      .range(offset, offset + PAGE - 1)
    if (error) return EMPTY_FILTER_OPTIONS
    const page = (data ?? []) as {
      client_account_id: string | null
      client_account_name: string | null
      host_names: string | null
      feedback_name: string | null
    }[]
    for (const r of page) {
      if (r.client_account_id && r.client_account_name?.trim()) {
        bump(clients, r.client_account_id, r.client_account_name.trim())
      }
      for (const h of (r.host_names ?? "").split(", ").map((x) => x.trim()).filter(Boolean)) {
        bump(hosts, h, h)
      }
      const fb = r.feedback_name?.trim()
      if (fb) bump(feedback, fb, fb)
    }
    if (page.length < PAGE) break
  }

  const sorted = (m: Map<string, FilterOption>) =>
    [...m.values()].sort((a, b) => a.label.localeCompare(b.label))
  return { clients: sorted(clients), hosts: sorted(hosts), feedback: sorted(feedback) }
}

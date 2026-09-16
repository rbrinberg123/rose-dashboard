/**
 * Notes' quick filters — the toolbar's Client / Status / Risk Driver / Owner /
 * Review Cycle dropdowns.
 *
 * These sit ON TOP of the active view's own filters and AND with them (and with
 * the keyword box, which stays in the browser over the already-narrowed set).
 *
 * Deliberately NOT part of ViewConfig, for the same reason as the other four CRM
 * tables: a saved view is a shape you return to, these are ad-hoc narrowing you
 * apply and drop. They ride in their own URL params, so they are still shareable
 * and still server-side.
 *
 * All five land on indexed columns — see the indexes in
 * sql/patches/2026-09-15_admin_notes.sql. Three of those are EXPRESSION indexes
 * on `btrim(...)`, because the view exposes the trimmed value and a plain index
 * on the raw column could not serve a filter on it.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Filterable } from "@/lib/table-views/query"

export type NoteQuickFilters = {
  /** accounts.account_id — the id, not the name. */
  client?: string
  /** A TRIMMED status_text value, e.g. "At Risk". */
  status?: string
  /** A TRIMMED primary_risk_driver value, e.g. "Execution/Meeting Volume". */
  risk?: string
  /** The author's CANONICAL user id, expanded across their alias group. */
  owner?: string
  /** A review-cycle name, e.g. "Client Review - June 2026". */
  cycle?: string
}

/** canonical user id -> every systemuser id that is the same person. */
export type UserAliasGroups = Map<string, string[]>

export const EMPTY_NOTE_QUICK_FILTERS: NoteQuickFilters = {}

export function hasNoteQuickFilters(f: NoteQuickFilters): boolean {
  return !!(f.client || f.status || f.risk || f.owner || f.cycle)
}

/**
 * Every user id that belongs to the same person as `canonicalId`.
 *
 * The same alias trap the other CRM pages hit: two people in this CRM carry
 * duplicate Dynamics systemuser records, so filtering on one raw id would
 * silently return part of that person's notes. The options view emits the
 * CANONICAL id (public.canonical_user_id) and it expands here — `IN (…)` is
 * still a plain index scan on idx_client_notes_owner_id.
 *
 * Only two people author notes today, so this is very nearly a no-op — but it is
 * the same code path as the other four pages, and the cost of getting it wrong
 * later is silent under-reporting rather than an error.
 */
function userIdsFor(canonicalId: string, aliasGroups: UserAliasGroups): string[] {
  return aliasGroups.get(canonicalId) ?? [canonicalId]
}

/**
 * Load the user alias groups: canonical id -> [canonical, ...its aliases].
 *
 * Mirrors public.canonical_user_id, the same way lib/touchpoints/filters.ts and
 * lib/tasks/filters.ts do. Tiny table (2 rows today), memoised for the life of
 * the process — it only changes when someone reconciles a duplicate CRM person.
 *
 * SERVER-ONLY in practice: it takes the service-role client as an argument, so
 * this module still imports nothing but a type and stays safe to import from a
 * client component for `NoteQuickFilters` alone.
 *
 * Fails soft: on a read error the filter degrades to the canonical id by itself,
 * which is the pre-alias behaviour — narrower than ideal, never wrong-open.
 */
let cachedAliasGroups: UserAliasGroups | null = null

export async function loadUserAliasGroups(sb: SupabaseClient): Promise<UserAliasGroups> {
  if (cachedAliasGroups) return cachedAliasGroups
  const groups: UserAliasGroups = new Map()
  const { data, error } = await sb
    .from("user_id_aliases")
    .select("alias_user_id, canonical_user_id")
  if (error) return groups
  for (const r of (data ?? []) as { alias_user_id: string; canonical_user_id: string }[]) {
    const list = groups.get(r.canonical_user_id) ?? [r.canonical_user_id]
    if (!list.includes(r.alias_user_id)) list.push(r.alias_user_id)
    groups.set(r.canonical_user_id, list)
  }
  cachedAliasGroups = groups
  return groups
}

/**
 * Apply the five dropdowns.
 *
 * Nothing here interpolates a user-typed string into query grammar: the values
 * come from the option lists the database itself produced, and each is used as
 * the ARGUMENT to a builder method.
 *
 * The status / risk / cycle values are the TRIMMED ones — the options view
 * btrims and so does v_admin_notes_all, so `eq` matches on both sides. Filtering
 * on an untrimmed value would return nothing, which is why neither side may drop
 * the btrim independently.
 */
export function applyNoteQuickFilters<Q>(
  q: Q,
  filters: NoteQuickFilters,
  aliasGroups: UserAliasGroups = new Map(),
): Q {
  let out = q as unknown as Filterable
  if (filters.client) out = out.eq("client_account_id", filters.client)
  if (filters.status) out = out.eq("status_text", filters.status)
  if (filters.risk) out = out.eq("primary_risk_driver", filters.risk)
  if (filters.cycle) out = out.eq("review_cycle", filters.cycle)
  if (filters.owner) {
    out = out.in("owner_id", userIdsFor(filters.owner, aliasGroups))
  }
  return out as unknown as Q
}

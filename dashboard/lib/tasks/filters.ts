/**
 * Tasks' quick filters — the toolbar's Client / Task Type / Sub-type / Owner /
 * Status dropdowns.
 *
 * These sit ON TOP of the active view's own filters and AND with them (and with
 * the keyword box, which stays in the browser over the already-narrowed set).
 *
 * Deliberately NOT part of ViewConfig, for the same reason as Meetings and
 * Events: a saved view is a shape you return to, these are ad-hoc narrowing you
 * apply and drop. They ride in their own URL params, so they are still shareable
 * and still server-side.
 *
 * All five land on indexed columns — see the indexes in
 * sql/patches/2026-09-11_admin_tasks.sql.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Filterable } from "@/lib/table-views/query"

export type TaskQuickFilters = {
  /** accounts.account_id — the id, not the name. */
  client?: string
  /** A task_type_label value, e.g. "Outreach". */
  task_type?: string
  /** A task_subtype_label value, e.g. "Marketing Memo". */
  subtype?: string
  /** An owner's CANONICAL user id, expanded across their alias group. */
  owner?: string
  /** A status_label value, e.g. "Not Started". */
  status?: string
}

/** canonical user id -> every systemuser id that is the same person. */
export type OwnerAliasGroups = Map<string, string[]>

export const EMPTY_TASK_QUICK_FILTERS: TaskQuickFilters = {}

export function hasTaskQuickFilters(f: TaskQuickFilters): boolean {
  return !!(f.client || f.task_type || f.subtype || f.owner || f.status)
}

/**
 * Every owner id that belongs to the same person as `canonicalId`.
 *
 * The same alias trap Meetings and Events hit: two people in this CRM carry
 * duplicate Dynamics systemuser records, so filtering on one raw id would
 * silently return part of that person's tasks. The options view emits the
 * CANONICAL id (public.canonical_user_id) and it expands here — `IN (…)` is
 * still a plain index scan on idx_tasks_owner_id.
 */
function ownerIdsFor(canonicalId: string, aliasGroups: OwnerAliasGroups): string[] {
  return aliasGroups.get(canonicalId) ?? [canonicalId]
}

/**
 * Load the owner alias groups: canonical id -> [canonical, ...its aliases].
 *
 * Mirrors public.canonical_user_id, the same way lib/meetings/query.ts does for
 * hosts. Tiny table (2 rows today), memoised for the life of the process — it
 * only changes when someone reconciles a duplicate CRM person.
 *
 * SERVER-ONLY in practice: it takes the service-role client as an argument, so
 * this module still imports nothing but a type and stays safe to import from a
 * client component for `TaskQuickFilters` alone.
 *
 * Fails soft: on a read error the filter degrades to the canonical id by itself,
 * which is the pre-alias behaviour — narrower than ideal, never wrong-open.
 */
let cachedAliasGroups: OwnerAliasGroups | null = null

export async function loadOwnerAliasGroups(sb: SupabaseClient): Promise<OwnerAliasGroups> {
  if (cachedAliasGroups) return cachedAliasGroups
  const groups: OwnerAliasGroups = new Map()
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
 */
export function applyTaskQuickFilters<Q>(
  q: Q,
  filters: TaskQuickFilters,
  aliasGroups: OwnerAliasGroups = new Map(),
): Q {
  let out = q as unknown as Filterable
  if (filters.client) out = out.eq("client_account_id", filters.client)
  if (filters.task_type) out = out.eq("task_type_label", filters.task_type)
  if (filters.subtype) out = out.eq("task_subtype_label", filters.subtype)
  if (filters.status) out = out.eq("status_label", filters.status)
  if (filters.owner) {
    out = out.in("owner_id", ownerIdsFor(filters.owner, aliasGroups))
  }
  return out as unknown as Q
}

/**
 * Touchpoints' quick filters — the toolbar's Client / Type / Contact / Created By
 * / Status dropdowns.
 *
 * These sit ON TOP of the active view's own filters and AND with them (and with
 * the keyword box, which stays in the browser over the already-narrowed set).
 *
 * Deliberately NOT part of ViewConfig, for the same reason as Meetings, Events
 * and Tasks: a saved view is a shape you return to, these are ad-hoc narrowing
 * you apply and drop. They ride in their own URL params, so they are still
 * shareable and still server-side.
 *
 * All five land on indexed columns — see the indexes in
 * sql/patches/2026-09-15_admin_touchpoints.sql.
 *
 * ── WHY THERE IS NO "OWNER" DROPDOWN ───────────────────────────────────────
 * The brief asked for Client / Type / Owner. On this entity `owner` is not a
 * person: `_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname` is the literal
 * string "team" on every row, and the team is named after the CLIENT — measured,
 * owner_name has 142 distinct values, all account names, it matches
 * client_account_name on ~94% of sampled rows, and none of its ids resolve to a
 * public.users row. An Owner dropdown would therefore be a second, worse copy of
 * the Client dropdown.
 *
 * `created_by` is the real staff filter — 23 distinct people, 100% populated —
 * so it takes that slot. The owner team is still available as a COLUMN
 * (`owner_team_name`) and as a saved-view filter for anyone who wants it.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Filterable } from "@/lib/table-views/query"

export type TouchpointQuickFilters = {
  /** accounts.account_id — the id, not the name. */
  client?: string
  /** A touchpoint_type_label value, e.g. "Virtual". */
  type?: string
  /** A contact_type_label value — the whole multi-select string, e.g. "CFO; IRO". */
  contact_type?: string
  /** The creating staff member's CANONICAL user id, expanded across their alias group. */
  created_by?: string
  /** A status_label value, e.g. "Made". */
  status?: string
}

/** canonical user id -> every systemuser id that is the same person. */
export type UserAliasGroups = Map<string, string[]>

export const EMPTY_TOUCHPOINT_QUICK_FILTERS: TouchpointQuickFilters = {}

export function hasTouchpointQuickFilters(f: TouchpointQuickFilters): boolean {
  return !!(f.client || f.type || f.contact_type || f.created_by || f.status)
}

/**
 * Every user id that belongs to the same person as `canonicalId`.
 *
 * The same alias trap Meetings, Events and Tasks hit: two people in this CRM
 * carry duplicate Dynamics systemuser records, so filtering on one raw id would
 * silently return part of that person's touchpoints. The options view emits the
 * CANONICAL id (public.canonical_user_id) and it expands here — `IN (…)` is still
 * a plain index scan on idx_touchpoints_created_by_id.
 */
function userIdsFor(canonicalId: string, aliasGroups: UserAliasGroups): string[] {
  return aliasGroups.get(canonicalId) ?? [canonicalId]
}

/**
 * Load the user alias groups: canonical id -> [canonical, ...its aliases].
 *
 * Mirrors public.canonical_user_id, the same way lib/tasks/filters.ts does for
 * task owners. Tiny table (2 rows today), memoised for the life of the process —
 * it only changes when someone reconciles a duplicate CRM person.
 *
 * SERVER-ONLY in practice: it takes the service-role client as an argument, so
 * this module still imports nothing but a type and stays safe to import from a
 * client component for `TouchpointQuickFilters` alone.
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
 */
export function applyTouchpointQuickFilters<Q>(
  q: Q,
  filters: TouchpointQuickFilters,
  aliasGroups: UserAliasGroups = new Map(),
): Q {
  let out = q as unknown as Filterable
  if (filters.client) out = out.eq("client_account_id", filters.client)
  if (filters.type) out = out.eq("touchpoint_type_label", filters.type)
  // Matches the whole stored multi-select string, which is what the options view
  // emits — "CFO; IRO" is its own choice, distinct from "CFO" and from "IRO".
  if (filters.contact_type) out = out.eq("contact_type_label", filters.contact_type)
  if (filters.status) out = out.eq("status_label", filters.status)
  if (filters.created_by) {
    out = out.in("created_by_id", userIdsFor(filters.created_by, aliasGroups))
  }
  return out as unknown as Q
}

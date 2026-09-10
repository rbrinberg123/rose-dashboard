/**
 * Events' quick filters — the toolbar's Client / Event State / Account Manager
 * dropdowns.
 *
 * These sit ON TOP of the active view's own filters and AND with them (and with
 * the keyword box, which stays in the browser over the already-narrowed set).
 *
 * Deliberately NOT part of ViewConfig, for the same reason as Meetings: a saved
 * view is a shape you return to, these are ad-hoc narrowing you apply and drop.
 * They ride in their own URL params, so they are still shareable and still
 * server-side.
 *
 * All three land on indexed columns — see the indexes in
 * sql/patches/2026-09-10_admin_events.sql.
 */

import type { Filterable } from "@/lib/table-views/query"

export type EventQuickFilters = {
  /** accounts.account_id — the id, not the name. */
  client?: string
  /** An event_state_label value, e.g. "Live Outreach". */
  event_state?: string
  /** An account manager's CANONICAL user id, expanded across their alias group. */
  manager?: string
}

/** canonical user id -> every systemuser id that is the same person. */
export type ManagerAliasGroups = Map<string, string[]>

export const EMPTY_EVENT_QUICK_FILTERS: EventQuickFilters = {}

export function hasEventQuickFilters(f: EventQuickFilters): boolean {
  return !!(f.client || f.event_state || f.manager)
}

/**
 * Every account-manager id that belongs to the same person as `canonicalId`.
 *
 * The same alias trap Meetings hit: two people in this CRM carry duplicate
 * Dynamics systemuser records, so filtering on one raw id would silently return
 * part of that person's events. The options view emits the CANONICAL id
 * (public.canonical_user_id) and it expands here — `IN (…)` is still a plain
 * index scan on idx_events_sales_lead_primary.
 */
function managerIdsFor(canonicalId: string, aliasGroups: ManagerAliasGroups): string[] {
  return aliasGroups.get(canonicalId) ?? [canonicalId]
}

/**
 * Apply the three dropdowns.
 *
 * Nothing here interpolates a user-typed string into query grammar: the values
 * come from the option lists the database itself produced, and each is used as
 * the ARGUMENT to a builder method.
 */
export function applyEventQuickFilters<Q>(
  q: Q,
  filters: EventQuickFilters,
  aliasGroups: ManagerAliasGroups = new Map(),
): Q {
  let out = q as unknown as Filterable
  if (filters.client) out = out.eq("client_account_id", filters.client)
  if (filters.event_state) out = out.eq("event_state_label", filters.event_state)
  if (filters.manager) {
    out = out.in("account_manager_id", managerIdsFor(filters.manager, aliasGroups))
  }
  return out as unknown as Q
}

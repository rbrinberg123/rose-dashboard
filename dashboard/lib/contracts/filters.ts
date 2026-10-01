/**
 * Contracts' quick filters — the toolbar's Client / Scope / Status / Currency /
 * Auto-Renew dropdowns. Same contract as lib/notes/filters.ts: they AND with the
 * active view's own filters, ride in their own URL params, and are applied
 * server-side. Values come from v_admin_contracts_filter_options, which reads
 * the SAME view the list does, so `eq` always matches.
 */

import type { Filterable } from "@/lib/table-views/query"

export type ContractQuickFilters = {
  /** accounts.account_id. */
  client?: string
  scope?: string
  status?: string
  currency?: string
  /** "true" | "false" */
  autoRenew?: string
}

export function hasContractQuickFilters(f: ContractQuickFilters): boolean {
  return !!(f.client || f.scope || f.status || f.currency || f.autoRenew)
}

/**
 * Apply the dropdowns. Each value is an ARGUMENT to a builder method — nothing
 * is interpolated into query grammar.
 */
export function applyContractQuickFilters<Q>(q: Q, filters: ContractQuickFilters): Q {
  let out = q as unknown as Filterable
  if (filters.client) out = out.eq("account_id", filters.client)
  if (filters.scope) out = out.eq("scope", filters.scope)
  if (filters.status) out = out.eq("contract_status", filters.status)
  if (filters.currency) out = out.eq("currency", filters.currency)
  if (filters.autoRenew === "true") out = out.is("auto_renew", true)
  if (filters.autoRenew === "false") out = out.is("auto_renew", false)
  return out as unknown as Q
}

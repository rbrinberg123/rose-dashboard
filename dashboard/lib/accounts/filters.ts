/**
 * Clients' quick filters — the toolbar's Active / Client Status / Sector /
 * Industry / Region / Market Cap / Account Mgr / Secondary / Associate /
 * Feedback / Logistics dropdowns.
 *
 * These sit ON TOP of the active view's own filters and AND with them (and with
 * the keyword box, which stays in the browser over the already-narrowed set).
 *
 * Deliberately NOT part of ViewConfig, for the same reason as the other six CRM
 * tables: a saved view is a shape you return to, these are ad-hoc narrowing you
 * apply and drop. They ride in their own URL params, so they are still shareable
 * and still server-side.
 *
 * ── THE FIVE TEAM FILTERS MATCH ON THE NAME, NOT THE USER ID ───────────────
 * The sibling pages expand an owner filter across `public.canonical_user_id`,
 * because two people in this CRM carry duplicate systemuser records: filtering
 * on one of their ids silently returns half their rows.
 *
 * This page sidesteps that instead of re-implementing it. The five account-team
 * dropdowns are keyed on the DISPLAY NAME — both duplicate records carry the
 * same name, so matching on it unions them for free, and there is no alias
 * table to load. The options view emits the same names (see the patch), so a
 * dropdown choice always matches something.
 *
 * The trade-off: two genuinely different people sharing a display name would
 * merge into one filter. Nobody in this directory does, and if it ever happened
 * the collision would be visible as a duplicate entry in the dropdown — whereas
 * a split id is invisible and reads as missing clients. If an id-keyed team
 * filter is ever needed, copy lib/notes/filters.ts rather than filtering on the
 * raw id.
 *
 * ── TWO OF THE ELEVEN FILTER ON DERIVED COLUMNS ────────────────────────────
 * `region` and `market_cap` match `region_label` / `market_cap_label`, which the
 * view COMPUTES rather than stores. That is fine — they are ordinary columns as
 * far as PostgREST is concerned — but it is why the options view reads
 * v_admin_accounts_all rather than public.accounts: the buckets in the dropdown
 * and the buckets in the list have to come from the same expression.
 *
 * Every other filter lands on an indexed column — see the indexes in
 * sql/patches/2026-09-17_admin_accounts.sql.
 */

import type { Filterable } from "@/lib/table-views/query"

export type AccountQuickFilters = {
  /** A Dynamics state code as text: "0" = Active, "1" = Inactive. */
  state?: string
  /** The Rose business field: Current / Past. NOT the same as `state`. */
  client_status?: string
  sector?: string
  industry?: string
  /** Americas / APAC / EMEA — derived in the view. */
  region?: string
  /** Mega / Large / Mid / Small / Micro — derived in the view. */
  market_cap?: string
  /** The five account-team roles, matched on the display NAME. See the header. */
  account_manager?: string
  secondary?: string
  associate?: string
  feedback?: string
  logistics?: string
}

export const EMPTY_ACCOUNT_QUICK_FILTERS: AccountQuickFilters = {}

/** Every key, in toolbar order. One list so the page, the URL builder and the
 *  "any filter set?" test cannot drift apart. */
export const ACCOUNT_QUICK_FILTER_KEYS = [
  "state",
  "client_status",
  "sector",
  "industry",
  "region",
  "market_cap",
  "account_manager",
  "secondary",
  "associate",
  "feedback",
  "logistics",
] as const

export function hasAccountQuickFilters(f: AccountQuickFilters): boolean {
  return ACCOUNT_QUICK_FILTER_KEYS.some((k) => !!f[k])
}

/**
 * Apply the eleven dropdowns.
 *
 * Nothing here interpolates a user-typed string into query grammar: the values
 * come from the option lists the database itself produced, and each is used as
 * the ARGUMENT to a builder method.
 *
 * THE NUMERIC CONVERSION MATTERS. A URL param is always a string, but
 * `state_code` is a real integer. Passing the string through would make
 * PostgREST compare `integer = '0'`, which either errors or silently matches
 * nothing. Anything that is not a whole number is DROPPED rather than guessed,
 * so a mangled URL widens the result instead of erroring the page.
 */
export function applyAccountQuickFilters<Q>(q: Q, filters: AccountQuickFilters): Q {
  let out = q as unknown as Filterable

  if (filters.state) {
    const code = Number(filters.state)
    if (Number.isInteger(code)) out = out.eq("state_code", code)
  }

  if (filters.client_status) out = out.eq("client_status_label", filters.client_status)
  if (filters.sector) out = out.eq("sector_label", filters.sector)
  if (filters.industry) out = out.eq("industry_option_label", filters.industry)
  if (filters.region) out = out.eq("region_label", filters.region)
  if (filters.market_cap) out = out.eq("market_cap_label", filters.market_cap)

  if (filters.account_manager) out = out.eq("sales_lead_primary_name", filters.account_manager)
  if (filters.secondary) out = out.eq("secondary_manager_name", filters.secondary)
  if (filters.associate) out = out.eq("associate_name", filters.associate)
  if (filters.feedback) out = out.eq("feedback_report_name", filters.feedback)
  if (filters.logistics) out = out.eq("logistics_coordinator_name", filters.logistics)

  return out as unknown as Q
}

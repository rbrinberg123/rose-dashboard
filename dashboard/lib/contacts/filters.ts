/**
 * Contacts' quick filters — the toolbar's Client / Contact Type / Industry /
 * Internal Assignment / City / Lead State / Active / IR Only / PoC / Do Not Call /
 * Distribution List dropdowns.
 *
 * These sit ON TOP of the active view's own filters and AND with them (and with
 * the keyword box, which stays in the browser over the already-narrowed set).
 *
 * Deliberately NOT part of ViewConfig, for the same reason as the other five CRM
 * tables: a saved view is a shape you return to, these are ad-hoc narrowing you
 * apply and drop. They ride in their own URL params, so they are still shareable
 * and still server-side.
 *
 * ── NO ALIAS EXPANSION HERE ────────────────────────────────────────────────
 * The sibling pages expand an owner filter across `public.canonical_user_id`,
 * because two people in this CRM carry duplicate systemuser records. Contacts
 * has no person-valued filter at all — the contact IS the row, and none of these
 * eleven dropdowns is a systemuser — so there is nothing to expand and no alias
 * loading step. If an Owner filter is ever added, copy lib/notes/filters.ts
 * rather than filtering on the raw id.
 *
 * All eleven land on indexed columns — see sql/23_contacts_table.sql and the
 * additional indexes in sql/patches/2026-09-16_admin_contacts.sql.
 */

import type { Filterable } from "@/lib/table-views/query"

export type ContactQuickFilters = {
  /** contacts.parent_customer_id — the id, not the name. */
  client?: string
  contact_type?: string
  industry?: string
  internal_assignment?: string
  /** A city name from address1_city. */
  city?: string
  lead_state?: string
  /** A Dynamics state code as text: "0" = Active, "1" = Inactive. */
  state?: string
  /** "true" / "false" — the options view emits the boolean as text. */
  ir_only?: string
  poc?: string
  do_not_call?: string
  distribution_list?: string
}

export const EMPTY_CONTACT_QUICK_FILTERS: ContactQuickFilters = {}

/** Every key, in toolbar order. One list so the page, the URL builder and the
 *  "any filter set?" test cannot drift apart. */
export const CONTACT_QUICK_FILTER_KEYS = [
  "client",
  "contact_type",
  "industry",
  "internal_assignment",
  "city",
  "lead_state",
  "state",
  "ir_only",
  "poc",
  "do_not_call",
  "distribution_list",
] as const

export function hasContactQuickFilters(f: ContactQuickFilters): boolean {
  return CONTACT_QUICK_FILTER_KEYS.some((k) => !!f[k])
}

/**
 * Apply the eleven dropdowns.
 *
 * Nothing here interpolates a user-typed string into query grammar: the values
 * come from the option lists the database itself produced, and each is used as
 * the ARGUMENT to a builder method.
 *
 * THE BOOLEAN AND NUMERIC CONVERSIONS MATTER. A URL param is always a string,
 * but `ir_only` is a real boolean column and `state_code` a real integer.
 * Passing the string through would make PostgREST compare `boolean = 'true'` and
 * `integer = '0'` — which either errors or silently matches nothing. Anything
 * that is not a recognised value is DROPPED rather than guessed, so a mangled
 * URL widens the result instead of erroring the page.
 */
export function applyContactQuickFilters<Q>(q: Q, filters: ContactQuickFilters): Q {
  let out = q as unknown as Filterable

  if (filters.client) out = out.eq("parent_customer_id", filters.client)
  if (filters.contact_type) out = out.eq("contact_type_label", filters.contact_type)
  if (filters.industry) out = out.eq("industry_label", filters.industry)
  if (filters.internal_assignment) {
    out = out.eq("internal_assignment_label", filters.internal_assignment)
  }
  if (filters.city) out = out.eq("city", filters.city)
  if (filters.lead_state) out = out.eq("lead_state_label", filters.lead_state)

  if (filters.state) {
    const code = Number(filters.state)
    if (Number.isInteger(code)) out = out.eq("state_code", code)
  }

  for (const key of ["ir_only", "poc", "do_not_call", "distribution_list"] as const) {
    const raw = filters[key]
    if (raw === "true") out = out.eq(key, true)
    else if (raw === "false") out = out.eq(key, false)
  }

  return out as unknown as Q
}

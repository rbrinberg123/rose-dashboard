"use server"

/**
 * Contacts' server actions: the record drawer's on-demand fetch, the uncapped
 * export, the saved-view writes and the filter-dropdown options.
 *
 * ══ SECURITY ═══════════════════════════════════════════════════════════════
 * Every function here re-checks that the EFFECTIVE role is super_user before it
 * builds a query. `v_admin_contacts_all` is unscoped and read with the
 * service-role key (RLS bypassed), so a successful call hands back every contact
 * at every client. This is the only CRM table that is mostly PERSONAL data —
 * names, job titles, employers, and the do-not-call flag — so treat it at least
 * as carefully as Notes.
 *
 * The page gate and the proxy gate are not enough on their own: a server action
 * is its own entry point and can be invoked directly.
 *
 * The saved-view writes delegate to lib/table-views/saved-views.ts, which is
 * where the who-may-do-what rules live — shared with the other five CRM tables
 * so there is one implementation, not six. Read that file's header before
 * changing them.
 *
 * READ-ONLY. Nothing here creates or updates a contact; Dynamics is the system
 * of record and the "Add New Contact" button is an inert placeholder (see
 * components/crm-add-new.tsx).
 */

import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { availableColumns, fetchAllRows, loadFilterOptionGroups } from "@/lib/table-views/query"
import type { QuickFilterOptions } from "@/components/table-views/quick-filters"
import {
  createSavedView as sharedCreate,
  deleteSavedView as sharedDelete,
  listSavedViews as sharedList,
  setDefaultSavedView as sharedSetDefault,
  updateSavedView as sharedUpdate,
} from "@/lib/table-views/saved-views"
import { parseConfig } from "@/lib/table-views/config"
import type { SavedView, SavedViewScope } from "@/lib/table-views/types"
import { CONTACTS_SPEC } from "@/lib/contacts/spec"
import {
  applyContactQuickFilters,
  CONTACT_QUICK_FILTER_KEYS,
  type ContactQuickFilters,
} from "@/lib/contacts/filters"
import type { ContactRecord } from "@/lib/contacts/record"
import type { AdminContactRow } from "@/lib/types"

/* ---------------------------------------------------------------- saved views */

export async function listSavedViews(): Promise<ActionResult<SavedView[]>> {
  return sharedList(CONTACTS_SPEC)
}

export async function createSavedView(input: {
  name: string
  scope: SavedViewScope
  config: unknown
}): Promise<ActionResult<{ id: string }>> {
  return sharedCreate(CONTACTS_SPEC, input)
}

export async function updateSavedView(input: {
  id: string
  name?: string
  config?: unknown
}): Promise<ActionResult> {
  return sharedUpdate(CONTACTS_SPEC, input)
}

export async function setDefaultSavedView(input: {
  id: string | null
  scope: SavedViewScope
}): Promise<ActionResult> {
  return sharedSetDefault(CONTACTS_SPEC, input)
}

export async function deleteSavedView(input: { id: string }): Promise<ActionResult> {
  return sharedDelete(CONTACTS_SPEC, input)
}

/* ------------------------------------------------------------ filter options */

/**
 * The eleven dropdown choice lists.
 *
 * Fetched by the CLIENT after the table renders, never by the page loader —
 * nothing on screen needs a dropdown's contents in order to paint a table. Reads
 * v_admin_contacts_filter_options, where the distinct-ing is done in Postgres.
 *
 * The four flag kinds and `state` come back as TEXT ("true"/"false", "0"/"1")
 * because the options view is one UNION and every branch must share a type.
 * lib/contacts/filters.ts converts them back before querying.
 */
export async function loadContactFilterOptions(): Promise<ActionResult<QuickFilterOptions>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const groups = await loadFilterOptionGroups(
    getSupabaseServer(),
    CONTACTS_SPEC,
    "contact_count",
  )

  // One entry per declared filter key, so a kind the view has no rows for still
  // renders as an empty dropdown rather than disappearing from the toolbar.
  return ok(
    Object.fromEntries(
      CONTACT_QUICK_FILTER_KEYS.map((k) => [k, groups[k] ?? []]),
    ) as QuickFilterOptions,
  )
}

/* ------------------------------------------------------------------- export */

/**
 * Every row of the current view, UNCAPPED — for the Excel export only.
 *
 * The page stops at ROW_CAP; the export must not, or capping the page would
 * silently start truncating spreadsheets. `config` arrives from the client, so
 * it goes through `parseConfig`, which admits only known column keys and a
 * closed operator set. The quick filters are re-applied here too, so the export
 * matches the ACTIVE VIEW exactly — dropdowns included.
 */
export async function loadContactRowsForExport(input: {
  config: unknown
  quick?: ContactQuickFilters
}): Promise<ActionResult<AdminContactRow[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const parsed = parseConfig(CONTACTS_SPEC, input.config)
  if (!parsed.ok) return fail(parsed.error)

  const sb = getSupabaseServer()
  const available = await availableColumns(sb, CONTACTS_SPEC)
  const quick = input.quick ?? {}

  const { rows, error } = await fetchAllRows<AdminContactRow>(
    sb,
    CONTACTS_SPEC,
    parsed.config,
    new Date(),
    available,
    ((q: unknown) => applyContactQuickFilters(q, quick)) as <Q>(q: Q) => Q,
  )
  if (error) return fail(error)
  return ok(rows)
}

/* ------------------------------------------------------------ record drawer */

/**
 * Load ONE contact's full record for the drawer.
 *
 * Fetched on demand rather than shipped with the list — which is what lets this
 * query, and ONLY this query, select `_raw`.
 *
 * ── WHY `_raw` IS HERE AND NOT ON THE LIST ─────────────────────────────────
 * The mirror deliberately leaves a set of contact fields unflattened: the
 * activity-pointer lookups (last appointment / email / phone / task activity),
 * primary opportunity, segment id, the country lookup and parent_contactid (see
 * sql/23_contacts_table.sql). `_raw` is where they live, so the drawer carries
 * the COMPLETE record and promoting one of them to a rendered field later needs
 * no second fetch.
 *
 * Nothing renders it today — the drawer's four sections are all flattened
 * columns. It is one row, behind the same super_user gate as everything else on
 * this page, which is the only reason shipping the whole payload is acceptable:
 * on the LIST it would be thousands of rows of unfiltered personal data crossing
 * the wire for nothing, which is why `selectListFor` never asks for it.
 */
const RECORD_COLUMNS = [
  "contact_id",
  "full_name",
  "first_name",
  "last_name",
  "job_title",
  "parent_customer_id",
  "parent_customer_name",
  "parent_customer_type",
  "company_master_record_id",
  "company_master_record_name",
  "client_account_id",
  "client_account_name",
  "client_ticker",
  "contact_type_label",
  "industry_label",
  "internal_assignment_label",
  "lead_state_label",
  "state_for_address_label",
  "previous_company",
  "ticker_symbol",
  // Contact info + provenance, flattened 2026-09-16.
  "email",
  "mobile_phone",
  "direct_phone",
  "city",
  "street",
  "owner_id",
  "owner_name",
  "created_by_id",
  "created_by_name",
  "modified_by_id",
  "modified_by_name",
  "ir_only",
  "poc",
  "do_not_call",
  "distribution_list",
  "ex_employee",
  "last_activity_subject",
  "last_activity_type_label",
  "last_activity_time",
  "verified_on",
  "is_active",
  "state_code",
  "state_label",
  "status_code",
  "status_label",
  "created_on",
  "modified_on",
].join(", ")

export async function loadContactRecord(
  contactId: string,
): Promise<ActionResult<ContactRecord>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  if (!contactId) return fail("No contact id.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from(CONTACTS_SPEC.viewName)
    .select(RECORD_COLUMNS)
    .eq("contact_id", contactId)
    .maybeSingle()

  if (error) return fail(describeError(error))
  if (!data) return fail("Contact not found.")

  // `_raw` is not on v_admin_contacts_all (the list view must never expose it),
  // so it is read separately, straight off the mirror table, and only for this
  // one row. A failure here is NOT fatal: every rendered field came from the
  // query above, so the drawer opens fine without it.
  const { data: rawRow } = await sb
    .from("contacts")
    .select("_raw")
    .eq("contact_id", contactId)
    .maybeSingle()

  return ok({
    ...(data as unknown as Omit<ContactRecord, "_raw">),
    _raw: (rawRow?._raw as Record<string, unknown> | undefined) ?? null,
  })
}

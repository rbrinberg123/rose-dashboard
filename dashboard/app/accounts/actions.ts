"use server"

/**
 * Clients' server actions: the record drawer's on-demand fetch, the uncapped
 * export, the saved-view writes and the filter-dropdown options.
 *
 * ══ SECURITY ═══════════════════════════════════════════════════════════════
 * Every function here re-checks that the EFFECTIVE role is super_user before it
 * builds a query. `v_admin_accounts_all` is unscoped and read with the
 * service-role key (RLS bypassed), so a successful call hands back every client
 * Rose has — active and inactive, with the full account team and every
 * engagement date on the record.
 *
 * The page gate and the proxy gate are not enough on their own: a server action
 * is its own entry point and can be invoked directly.
 *
 * The saved-view writes delegate to lib/table-views/saved-views.ts, which is
 * where the who-may-do-what rules live — shared with the other six CRM tables
 * so there is one implementation, not seven. Read that file's header before
 * changing them.
 *
 * READ-ONLY. Nothing here creates or updates an account; Dynamics is the system
 * of record and the "Add New Client" button is an inert placeholder (see
 * components/crm-add-new.tsx). In particular nothing here touches
 * public.account_status or public.account_team_members — the two dashboard-owned
 * accounts-overlay tables — in either direction.
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
import { ACCOUNTS_SPEC } from "@/lib/accounts/spec"
import {
  applyAccountQuickFilters,
  ACCOUNT_QUICK_FILTER_KEYS,
  type AccountQuickFilters,
} from "@/lib/accounts/filters"
import type { AccountRecord } from "@/lib/accounts/record"
import type { AdminAccountRow } from "@/lib/types"

/* ---------------------------------------------------------------- saved views */

export async function listSavedViews(): Promise<ActionResult<SavedView[]>> {
  return sharedList(ACCOUNTS_SPEC)
}

export async function createSavedView(input: {
  name: string
  scope: SavedViewScope
  config: unknown
}): Promise<ActionResult<{ id: string }>> {
  return sharedCreate(ACCOUNTS_SPEC, input)
}

export async function updateSavedView(input: {
  id: string
  name?: string
  config?: unknown
}): Promise<ActionResult> {
  return sharedUpdate(ACCOUNTS_SPEC, input)
}

export async function setDefaultSavedView(input: {
  id: string | null
  scope: SavedViewScope
}): Promise<ActionResult> {
  return sharedSetDefault(ACCOUNTS_SPEC, input)
}

export async function deleteSavedView(input: { id: string }): Promise<ActionResult> {
  return sharedDelete(ACCOUNTS_SPEC, input)
}

/* ------------------------------------------------------------ filter options */

/**
 * The eleven dropdown choice lists.
 *
 * Fetched by the CLIENT after the table renders, never by the page loader —
 * nothing on screen needs a dropdown's contents in order to paint a table. Reads
 * v_admin_accounts_filter_options, where the distinct-ing is done in Postgres.
 *
 * `state` comes back as TEXT ("0"/"1") because the options view is one UNION and
 * every branch must share a type; lib/accounts/filters.ts converts it back to an
 * integer before querying. The five team kinds come back as display NAMES rather
 * than user ids — deliberately, so the duplicate systemuser records two people
 * carry are unioned without an alias-expansion step. See the filters header.
 */
export async function loadAccountFilterOptions(): Promise<ActionResult<QuickFilterOptions>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const groups = await loadFilterOptionGroups(
    getSupabaseServer(),
    ACCOUNTS_SPEC,
    "account_count",
  )

  // One entry per declared filter key, so a kind the view has no rows for still
  // renders as an empty dropdown rather than disappearing from the toolbar.
  return ok(
    Object.fromEntries(
      ACCOUNT_QUICK_FILTER_KEYS.map((k) => [k, groups[k] ?? []]),
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
 *
 * With ~228 accounts the cap does not bite today. The path exists anyway, for
 * the same reason it does on the other six: the day it starts to matter should
 * not also be the day someone discovers their export was short.
 */
export async function loadAccountRowsForExport(input: {
  config: unknown
  quick?: AccountQuickFilters
}): Promise<ActionResult<AdminAccountRow[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const parsed = parseConfig(ACCOUNTS_SPEC, input.config)
  if (!parsed.ok) return fail(parsed.error)

  const sb = getSupabaseServer()
  const available = await availableColumns(sb, ACCOUNTS_SPEC)
  const quick = input.quick ?? {}

  const { rows, error } = await fetchAllRows<AdminAccountRow>(
    sb,
    ACCOUNTS_SPEC,
    parsed.config,
    new Date(),
    available,
    ((q: unknown) => applyAccountQuickFilters(q, quick)) as <Q>(q: Q) => Q,
  )
  if (error) return fail(error)
  return ok(rows)
}

/* ------------------------------------------------------------ record drawer */

/**
 * Load ONE client's full record for the drawer.
 *
 * Fetched on demand rather than shipped with the list — which is what lets this
 * query, and ONLY this query, reach `_raw`.
 *
 * ── WHY `_raw` IS HERE AND NOT ON THE LIST ─────────────────────────────────
 * The mirror still leaves ~40 accounts fields unflattened — the staff-initials
 * cluster, the address1_* block, and others — pending a dedicated accounts
 * flatten pass. `_raw` is where they live, so the drawer carries the COMPLETE
 * record and promoting one of them to a rendered field later needs no second
 * fetch.
 *
 * Nothing renders it today — every field in the drawer's six sections is a
 * flattened column. It is one row, behind the same super_user gate as everything
 * else on this page, which is the only reason shipping the whole payload is
 * acceptable: on the LIST it would be the entire CRM's account payload crossing
 * the wire for nothing, which is why `selectListFor` never asks for it.
 */
const RECORD_COLUMNS = [
  "account_id",
  "client_account_id",
  "client_account_name",
  "client_ticker",
  // identity
  "name",
  "ticker_symbol",
  "ipreo_ticker",
  "website_url",
  "email",
  "company_master_id",
  "company_master_name",
  // classification / size / geography
  "client_status_label",
  "client_status_code",
  "sector_label",
  "industry_option_label",
  "fs_sector",
  "fs_industry",
  "exchange_label",
  "market_cap_b",
  "market_cap_label",
  "hq_country_name",
  "region_label",
  "city",
  "state_province",
  "country",
  // account team
  "sales_lead_primary_id",
  "sales_lead_primary_name",
  "secondary_manager_id",
  "secondary_manager_name",
  "associate_id",
  "associate_name",
  "feedback_report_id",
  "feedback_report_name",
  "logistics_coordinator_id",
  "logistics_coordinator_name",
  "targeting_id",
  "targeting_name",
  "teaser_id",
  "teaser_name",
  "primary_contact_id",
  "primary_contact_name",
  "owner_id",
  "owner_name",
  // engagement
  "current_event_id",
  "current_event_name",
  "current_project_id",
  "current_project_name",
  "last_touchpoint_date",
  "next_touchpoint_date",
  "last_event_date",
  "next_event_date",
  "ongoing_event_date",
  "last_targeting_date",
  "last_teaser_date",
  "days_since_last_review",
  "original_start_date",
  "onboarding_call",
  "last_data_upload",
  "teach_in",
  "teach_in_date",
  "shareholder_report_received_date",
  // flags
  "do_not_call",
  "ir_only",
  "bda_peers",
  "calendar",
  "calendar_confirmed",
  "distro",
  "meeting_history_received",
  "mgmt_review",
  "recurring_call_scheduled",
  "report",
  "rep_short_interest",
  "sh_report",
  // free text
  "dietary_restrictions",
  "onboarding_notes",
  "peers",
  // status / system
  "is_active",
  "state_code",
  "state_label",
  "status_code",
  "status_label",
  "created_by_id",
  "created_by_name",
  "modified_by_id",
  "modified_by_name",
  "created_on",
  "modified_on",
].join(", ")

export async function loadAccountRecord(
  accountId: string,
): Promise<ActionResult<AccountRecord>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  if (!accountId) return fail("No client id.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from(ACCOUNTS_SPEC.viewName)
    .select(RECORD_COLUMNS)
    .eq("account_id", accountId)
    .maybeSingle()

  if (error) return fail(describeError(error))
  if (!data) return fail("Client not found.")

  // `_raw` is not on v_admin_accounts_all (the list view must never expose it),
  // so it is read separately, straight off the mirror table, and only for this
  // one row. A failure here is NOT fatal: every rendered field came from the
  // query above, so the drawer opens fine without it.
  const { data: rawRow } = await sb
    .from("accounts")
    .select("_raw")
    .eq("account_id", accountId)
    .maybeSingle()

  return ok({
    ...(data as unknown as Omit<AccountRecord, "_raw">),
    _raw: (rawRow?._raw as Record<string, unknown> | undefined) ?? null,
  })
}

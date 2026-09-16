"use server"

/**
 * Touchpoints' server actions: the record drawer's on-demand fetch, the uncapped
 * export, the saved-view writes and the filter-dropdown options.
 *
 * ══ SECURITY ═══════════════════════════════════════════════════════════════
 * Every function here re-checks that the EFFECTIVE role is super_user before it
 * builds a query. `v_admin_touchpoints_all` is unscoped and read with the
 * service-role key (RLS bypassed), so a successful call hands back every client's
 * touchpoints — including the free-text call notes, which are the most sensitive
 * thing on the record. The page gate and the proxy gate are not enough on their
 * own: a server action is its own entry point and can be invoked directly.
 *
 * The saved-view writes delegate to lib/table-views/saved-views.ts, which is
 * where the who-may-do-what rules live — shared with Meetings, Events and Tasks
 * so there is one implementation, not four. Read that file's header before
 * changing them.
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
import { TOUCHPOINTS_SPEC } from "@/lib/touchpoints/spec"
import {
  applyTouchpointQuickFilters,
  loadUserAliasGroups,
  type TouchpointQuickFilters,
} from "@/lib/touchpoints/filters"
import type { TouchpointRecord } from "@/lib/touchpoints/record"
import type { AdminTouchpointRow } from "@/lib/types"

/* ---------------------------------------------------------------- saved views */

export async function listSavedViews(): Promise<ActionResult<SavedView[]>> {
  return sharedList(TOUCHPOINTS_SPEC)
}

export async function createSavedView(input: {
  name: string
  scope: SavedViewScope
  config: unknown
}): Promise<ActionResult<{ id: string }>> {
  return sharedCreate(TOUCHPOINTS_SPEC, input)
}

export async function updateSavedView(input: {
  id: string
  name?: string
  config?: unknown
}): Promise<ActionResult> {
  return sharedUpdate(TOUCHPOINTS_SPEC, input)
}

export async function setDefaultSavedView(input: {
  id: string | null
  scope: SavedViewScope
}): Promise<ActionResult> {
  return sharedSetDefault(TOUCHPOINTS_SPEC, input)
}

export async function deleteSavedView(input: { id: string }): Promise<ActionResult> {
  return sharedDelete(TOUCHPOINTS_SPEC, input)
}

/* ------------------------------------------------------------ filter options */

/**
 * Client / Type / Contact / Created By / Status choices.
 *
 * Fetched by the CLIENT after the table renders, never by the page loader —
 * nothing on screen needs a dropdown's contents in order to paint a table. Reads
 * v_admin_touchpoints_filter_options, where the distinct-ing is done in Postgres
 * rather than by scanning every row into the server process.
 *
 * There is no `owner` group: owner on this entity is a per-account team named
 * after the client, so the dropdown would duplicate Client. See the header of
 * lib/touchpoints/filters.ts.
 */
export async function loadTouchpointFilterOptions(): Promise<ActionResult<QuickFilterOptions>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const groups = await loadFilterOptionGroups(
    getSupabaseServer(),
    TOUCHPOINTS_SPEC,
    "touchpoint_count",
  )
  return ok({
    client: groups.client ?? [],
    type: groups.type ?? [],
    contact_type: groups.contact_type ?? [],
    created_by: groups.created_by ?? [],
    status: groups.status ?? [],
  })
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
export async function loadTouchpointRowsForExport(input: {
  config: unknown
  quick?: TouchpointQuickFilters
}): Promise<ActionResult<AdminTouchpointRow[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const parsed = parseConfig(TOUCHPOINTS_SPEC, input.config)
  if (!parsed.ok) return fail(parsed.error)

  const sb = getSupabaseServer()
  const [available, aliasGroups] = await Promise.all([
    availableColumns(sb, TOUCHPOINTS_SPEC),
    loadUserAliasGroups(sb),
  ])
  const quick = input.quick ?? {}

  const { rows, error } = await fetchAllRows<AdminTouchpointRow>(
    sb,
    TOUCHPOINTS_SPEC,
    parsed.config,
    new Date(),
    available,
    ((q: unknown) => applyTouchpointQuickFilters(q, quick, aliasGroups)) as <Q>(q: Q) => Q,
  )
  if (error) return fail(error)
  return ok(rows)
}

/* ------------------------------------------------------------ record drawer */

/**
 * Load ONE touchpoint's full record for the drawer.
 *
 * Fetched on demand rather than shipped with the list: the list carries only its
 * seven display columns, and the single biggest field on the record — the
 * free-text call notes, often several paragraphs and present on 93% of rows — is
 * never shown in the table at all. One row on open is far cheaper than a
 * thousand rows of notes nobody reads.
 *
 * No `_raw` here. The view already digs `modified_by_name` out of it (the mirror
 * flattens created_by but not modified_by), so every field the drawer wants is a
 * real column by the time this query runs; `_raw` is deliberately NOT selected by
 * either this query or the list.
 */
const RECORD_COLUMNS = [
  "touchpoint_id",
  "client_account_id",
  "subject",
  "description",
  "touchpoint_type_label",
  "contact_type_label",
  "direction_label",
  "status_label",
  "state_label",
  "touchpoint_date",
  "scheduled_end",
  "duration_minutes",
  "client_account_name",
  "client_ticker",
  "regarding_id",
  "created_by_id",
  "created_by_name",
  "modified_by_name",
  "owner_team_name",
  "created_on",
  "modified_on",
  "is_recent",
].join(", ")

export async function loadTouchpointRecord(
  touchpointId: string,
): Promise<ActionResult<TouchpointRecord>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  if (!touchpointId) return fail("No touch id.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from(TOUCHPOINTS_SPEC.viewName)
    .select(RECORD_COLUMNS)
    .eq("touchpoint_id", touchpointId)
    .maybeSingle()

  if (error) return fail(describeError(error))
  if (!data) return fail("Touch not found.")

  return ok(data as unknown as TouchpointRecord)
}

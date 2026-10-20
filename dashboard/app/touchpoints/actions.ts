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
 *
 * ══ TOUCH WRITES ════════════════════════════════════════════════════════════
 * `createTouch` and `purgeTestTouches` (bottom of this file) write touches,
 * via the ungated core in lib/touchpoints/write.ts (shared with the Onboarding
 * page's scope-gated cells) and the dashboard-write plumbing in lib/crm-write.ts (the same as
 * Add New Contact / Add New Note). Rows are origin='dashboard', which the
 * reconciliation sweep skips. See content/docs/22-cutover-ownership-boundary.md.
 */

import { getSupabaseServer } from "@/lib/supabase"
import {
  countTestRows,
  isUuid,
  loadActiveAccountOptions,
  purgeTestRows,
  requireCrmWriter,
} from "@/lib/crm-write"
import type { NewTouchInput, TouchContact } from "@/lib/touchpoints/create"
import type { AccountOption } from "@/lib/types"
import { getEffectiveRole } from "@/lib/effective-identity"
import { fail, ok, type ActionResult } from "@/lib/actions"
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
import {
  insertTouch,
  readTouchContacts,
  readTouchForEdit,
  readTouchRecord,
  updateTouchRow,
} from "@/lib/touchpoints/write"
import { hasSuperUserPrivileges } from "@/lib/access-control"
import { actionsScopeFilter, canSeeActionsRow } from "@/lib/access/actions-scope"

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
  if (!hasSuperUserPrivileges(role)) return fail("Not authorised.")

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
  if (!hasSuperUserPrivileges(role)) return fail("Not authorised.")

  const parsed = parseConfig(TOUCHPOINTS_SPEC, input.config)
  if (!parsed.ok) return fail(parsed.error)

  const sb = getSupabaseServer()
  const [available, aliasGroups, scoped] = await Promise.all([
    availableColumns(sb, TOUCHPOINTS_SPEC),
    loadUserAliasGroups(sb),
    actionsScopeFilter("touchpoints"),
  ])
  const quick = input.quick ?? {}

  const { rows, error } = await fetchAllRows<AdminTouchpointRow>(
    sb,
    TOUCHPOINTS_SPEC,
    parsed.config,
    new Date(),
    available,
    ((q: unknown) => scoped(applyTouchpointQuickFilters(q, quick, aliasGroups))) as <Q>(q: Q) => Q,
  )
  if (error) return fail(error)
  return ok(rows)
}

/* ------------------------------------------------------------ record drawer */

/** Load ONE touchpoint's full record for the drawer (see readTouchRecord). */
export async function loadTouchpointRecord(
  touchpointId: string,
): Promise<ActionResult<TouchpointRecord>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (!hasSuperUserPrivileges(role)) return fail("Not authorised.")
  // ROW SCOPE — the same rule as the list (lib/access/actions-scope.ts).
  if (!(await canSeeActionsRow("touchpoints", touchpointId))) return fail("Not authorised.")
  return readTouchRecord(touchpointId)
}

/* ------------------------------------------------------------- touch writes */
// The same shared plumbing as every live CRM entity (lib/crm-write.ts): write
// gate, client re-read, ownership stamp, guarded edit, audited purge.

/** Clients for the form's picker: every account, by name. */
/**
 * The Client picker: ACTIVE clients only (accounts.state_label = 'Active') —
 * the same shared helper as the Event, Meeting, Note and Task forms. An edited
 * touchpoint keeps its own client listed even if that client has since gone
 * inactive. Client stays REQUIRED on touchpoints.
 */
export async function loadTouchClientOptions(includeAccountId?: string | null): Promise<ActionResult<AccountOption[]>> {
  return loadActiveAccountOptions(includeAccountId)
}

/* ------------------------------------------------------ client contacts */

/** The drawer's Client Contacts list (any origin; always empty for Dynamics rows). */
export async function loadTouchContacts(touchpointId: string): Promise<ActionResult<TouchContact[]>> {
  const role = await getEffectiveRole()
  if (!hasSuperUserPrivileges(role)) return fail("Not authorised.")
  if (!isUuid(touchpointId)) return fail("Unknown touchpoint.")
  if (!(await canSeeActionsRow("touchpoints", touchpointId))) return fail("Not authorised.")
  return readTouchContacts(touchpointId)
}

/** "Add New Touch" — insert ONE dashboard-authored touchpoint (see insertTouch). */
export async function createTouch(input: NewTouchInput): Promise<ActionResult<{ touchpointId: string }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("creating or deleting touchpoints")
  if (!gate.ok) return fail(gate.error)
  return insertTouch(input, gate, "/touchpoints · Add New Touch")
}

/** A DASHBOARD touch, as form input — Dynamics rows are refused. */
export async function loadTouchForEdit(id: string): Promise<ActionResult<NewTouchInput>> {
  const role = await getEffectiveRole()
  if (!hasSuperUserPrivileges(role)) return fail("Not authorised.")
  if (!(await canSeeActionsRow("touchpoints", id))) return fail("Not authorised.")
  return readTouchForEdit(id)
}

/** Edit a DASHBOARD touch. The origin guard lives in updateDashboardRow. */
export async function updateTouch(id: string, input: NewTouchInput): Promise<ActionResult<{ changed: number }>> {
  const gate = await requireCrmWriter("editing touchpoints")
  if (!gate.ok) return fail(gate.error)
  if (!(await canSeeActionsRow("touchpoints", id))) return fail("Not authorised.")
  return updateTouchRow(id, input, gate, "/touchpoints · Edit touch")
}

/** How many test touches the purge would remove — for the confirm prompt. */
export async function countTestTouches(): Promise<ActionResult<number>> {
  return countTestRows("touchpoints", "touchpoint_id")
}

/** Delete every dashboard-created TEST touch (see purgeTestRows). */
export async function purgeTestTouches(): Promise<ActionResult<{ deleted: number }>> {
  return purgeTestRows({
    table: "touchpoints",
    pk: "touchpoint_id",
    snapshot: "client_account_name, subject, scheduled_start, touchpoint_type_label, created_on, created_by_name",
    path: "/touchpoints",
    context: "/touchpoints · Delete test touches",
  })
}

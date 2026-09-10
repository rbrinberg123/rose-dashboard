"use server"

/**
 * Tasks' server actions: the record drawer's on-demand fetch, the uncapped
 * export, the saved-view writes and the filter-dropdown options.
 *
 * ══ SECURITY ═══════════════════════════════════════════════════════════════
 * Every function here re-checks that the EFFECTIVE role is super_user before it
 * builds a query. `v_admin_tasks_all` is unscoped and read with the service-role
 * key (RLS bypassed), so a successful call hands back every client's tasks. The
 * page gate and the proxy gate are not enough on their own: a server action is
 * its own entry point and can be invoked directly.
 *
 * The saved-view writes delegate to lib/table-views/saved-views.ts, which is
 * where the who-may-do-what rules live — shared with Meetings and Events so
 * there is one implementation, not three. Read that file's header before
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
import { TASKS_SPEC } from "@/lib/tasks/spec"
import {
  applyTaskQuickFilters,
  loadOwnerAliasGroups,
  type TaskQuickFilters,
} from "@/lib/tasks/filters"
import type { TaskRecord } from "@/lib/tasks/record"
import type { AdminTaskRow } from "@/lib/types"

/* ---------------------------------------------------------------- saved views */

export async function listSavedViews(): Promise<ActionResult<SavedView[]>> {
  return sharedList(TASKS_SPEC)
}

export async function createSavedView(input: {
  name: string
  scope: SavedViewScope
  config: unknown
}): Promise<ActionResult<{ id: string }>> {
  return sharedCreate(TASKS_SPEC, input)
}

export async function updateSavedView(input: {
  id: string
  name?: string
  config?: unknown
}): Promise<ActionResult> {
  return sharedUpdate(TASKS_SPEC, input)
}

export async function setDefaultSavedView(input: {
  id: string | null
  scope: SavedViewScope
}): Promise<ActionResult> {
  return sharedSetDefault(TASKS_SPEC, input)
}

export async function deleteSavedView(input: { id: string }): Promise<ActionResult> {
  return sharedDelete(TASKS_SPEC, input)
}

/* ------------------------------------------------------------ filter options */

/**
 * Client / Task Type / Sub-type / Owner / Status choices.
 *
 * Fetched by the CLIENT after the table renders, never by the page loader —
 * nothing on screen needs a dropdown's contents in order to paint a table. Reads
 * v_admin_tasks_filter_options, where the distinct-ing is done in Postgres
 * rather than by scanning 3,920 rows into the server process.
 */
export async function loadTaskFilterOptions(): Promise<ActionResult<QuickFilterOptions>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const groups = await loadFilterOptionGroups(getSupabaseServer(), TASKS_SPEC, "task_count")
  return ok({
    client: groups.client ?? [],
    task_type: groups.task_type ?? [],
    subtype: groups.subtype ?? [],
    owner: groups.owner ?? [],
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
export async function loadTaskRowsForExport(input: {
  config: unknown
  quick?: TaskQuickFilters
}): Promise<ActionResult<AdminTaskRow[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const parsed = parseConfig(TASKS_SPEC, input.config)
  if (!parsed.ok) return fail(parsed.error)

  const sb = getSupabaseServer()
  const [available, aliasGroups] = await Promise.all([
    availableColumns(sb, TASKS_SPEC),
    loadOwnerAliasGroups(sb),
  ])
  const quick = input.quick ?? {}

  const { rows, error } = await fetchAllRows<AdminTaskRow>(
    sb,
    TASKS_SPEC,
    parsed.config,
    new Date(),
    available,
    ((q: unknown) => applyTaskQuickFilters(q, quick, aliasGroups)) as <Q>(q: Q) => Q,
  )
  if (error) return fail(error)
  return ok(rows)
}

/* ------------------------------------------------------------ record drawer */

/**
 * Load ONE task's full record for the drawer.
 *
 * Fetched on demand rather than shipped with the list: the list carries only its
 * nine display columns, and most of what the drawer shows (the description, the
 * whole Workflow block) is never looked at. One row on open is far cheaper than
 * thousands of rows of detail.
 *
 * No `_raw` anywhere — public.tasks is a fully flattened mirror, so every field
 * the drawer wants is a real column on the view. `_raw` is deliberately NOT
 * selected by either this query or the list.
 */
const RECORD_COLUMNS = [
  "task_id",
  "client_account_id",
  "subject",
  "description",
  "task_type_label",
  "task_subtype_label",
  "priority_label",
  "priority_stock_label",
  "priority_rose_label",
  "status_label",
  "state_label",
  "percent_complete",
  "due_date",
  "scheduled_start",
  "actual_start",
  "actual_end",
  "created_on",
  "modified_on",
  "regarding_name",
  "regarding_type",
  "regarding_type_label",
  "client_account_name",
  "client_ticker",
  "event_id",
  "event_name",
  "owner_id",
  "owner_name",
  "created_by_name",
  "modified_by_name",
  "claimed_by_name",
  "current_assignment_name",
  "outreach_status_label",
  "drafting",
  "draft_complete",
  "review_complete",
  "processed",
  "feedback_received",
  "notified",
].join(", ")

export async function loadTaskRecord(taskId: string): Promise<ActionResult<TaskRecord>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  if (!taskId) return fail("No task id.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from(TASKS_SPEC.viewName)
    .select(RECORD_COLUMNS)
    .eq("task_id", taskId)
    .maybeSingle()

  if (error) return fail(describeError(error))
  if (!data) return fail("Task not found.")

  return ok(data as unknown as TaskRecord)
}

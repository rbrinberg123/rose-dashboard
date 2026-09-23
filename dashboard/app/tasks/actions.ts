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
import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { recordAudit } from "@/lib/audit"
import {
  DASHBOARD_ROW_BASE,
  cleanText,
  countTestRows,
  easternLocalToIso,
  isIsoDate,
  loadAccountOptions,
  loadClientEventOptions,
  loadUserOptions,
  purgeTestRows,
  requireCrmWriter,
  updateDashboardRow,
  loadDashboardRowForEdit,
  asText,
  isoToEasternDate,
  resolveAccount,
  resolveClientEvent,
  resolveUser,
} from "@/lib/crm-write"
import {
  TASK_OUTREACH_STATUS_OPTIONS,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  TASK_TYPE_OPTIONS,
  type NewTaskInput,
} from "@/lib/tasks/create"
import type { AccountOption, UserOption } from "@/lib/types"
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

  // is_test for the drawer TEST badge, read off the table (the view lacks it).
  const { data: flag } = await sb
    .from("tasks")
    .select("is_test, origin, crdfa_feedback_received_date")
    .eq("task_id", taskId)
    .maybeSingle()

  return ok({ ...(data as unknown as TaskRecord), is_test: flag?.is_test === true, origin: (flag?.origin as string | undefined) ?? null, feedback_received_date: (flag?.crdfa_feedback_received_date as string | undefined) ?? null })
}

/* -------------------------------------------------------------- task writes */
// The same shared plumbing as every live CRM entity (lib/crm-write.ts): write
// gate, re-reads, ownership stamp, guarded edit, audited purge.

export async function loadTaskClientOptions(): Promise<ActionResult<AccountOption[]>> {
  return loadAccountOptions()
}

export async function loadTaskUserOptions(): Promise<ActionResult<UserOption[]>> {
  return loadUserOptions()
}

export async function loadTaskEventOptions(accountId: string) {
  return loadClientEventOptions(accountId)
}

/**
 * Validate + build the FLATTENED task columns — shared by create and edit.
 * `defaultOwnerId` is the caller, used when the form leaves Owner blank.
 */
async function buildTaskColumns(
  input: NewTaskInput,
  defaultOwnerId: string | null,
): Promise<ActionResult<Record<string, unknown>>> {
  if (!cleanText(input.clientAccountId)) return fail("Pick a client.")
  const clientRes = await resolveAccount(input.clientAccountId)
  if (!clientRes.ok) return fail(clientRes.error)
  const client = clientRes.data!

  const subject = cleanText(input.subject)
  if (!subject) return fail("Enter a subject.")

  const type = TASK_TYPE_OPTIONS.find((t) => t.code === input.typeCode)
  if (!type) return fail("Pick a task type.")
  const subtype = (type.subtypes as readonly { code: number; label: string }[]).find(
    (s) => s.code === input.subtypeCode,
  )
  if (!subtype) return fail("Pick a sub-type for that task type.")

  const priority =
    input.priorityCode == null ? null : TASK_PRIORITY_OPTIONS.find((p) => p.code === input.priorityCode)
  if (input.priorityCode != null && !priority) return fail("Unknown priority.")

  const status = TASK_STATUS_OPTIONS.find((s) => s.key === input.statusKey)
  if (!status) return fail("Pick a status.")

  const due = cleanText(input.dueDate)
  if (due && !isIsoDate(due)) return fail("The due date isn't a valid date.")

  // The Event link: the Regarding event when Regarding is one, else the
  // optional Event picker. Either way it must be one of the client's events.
  const regardingEvent = input.regarding && input.regarding !== "client" ? input.regarding : null
  const evRes = await resolveClientEvent(regardingEvent ?? input.eventId, client.account_id)
  if (!evRes.ok) return fail(evRes.error)
  const event = evRes.data

  const pctText = cleanText(input.percentComplete)
  const pct = pctText === null ? null : Number(pctText)
  if (pct !== null && (!Number.isInteger(pct) || pct < 0 || pct > 100)) return fail("% Complete must be 0–100.")

  const days: Record<string, string | null> = {}
  for (const [k, label] of [
    ["scheduledStart", "Scheduled Start"],
    ["actualStart", "Actual Start"],
    ["actualEnd", "Actual End"],
  ] as const) {
    const v = cleanText(input[k])
    if (v && !isIsoDate(v)) return fail(`${label} isn't a valid date.`)
    days[k] = v ? easternLocalToIso(`${v}T00:00`) : null
  }

  const claimedRes = await resolveUser(input.claimedById)
  if (!claimedRes.ok) return fail(claimedRes.error)
  const assignRes = await resolveUser(input.currentAssignmentId)
  if (!assignRes.ok) return fail(assignRes.error)

  const fbRecDay = cleanText(input.feedbackReceivedDate)
  if (fbRecDay && !isIsoDate(fbRecDay)) return fail("Feedback Received Date isn't a valid date.")

  const outreach =
    input.outreachStatusCode == null
      ? null
      : TASK_OUTREACH_STATUS_OPTIONS.find((o) => o.code === input.outreachStatusCode)
  if (input.outreachStatusCode != null && !outreach) return fail("Unknown outreach task status.")

  const ownerRes = await resolveUser(input.ownerId ?? defaultOwnerId)
  if (!ownerRes.ok) return fail(ownerRes.error)
  const owner = ownerRes.data

  return ok({
    subject,
    description: cleanText(input.description),
    bcs_task_type_code: type.code,
    bcs_task_type_label: type.label,
    bcs_task_subtype_code: subtype.code,
    bcs_task_subtype_label: subtype.label,
    bcs_task_priority_code: priority?.code ?? null,
    bcs_task_priority_label: priority?.label ?? null,
    scheduled_end: due ? easternLocalToIso(`${due}T00:00`) : null,
    bcs_account_id: client.account_id,
    bcs_account_name: client.name,
    bcs_event_id: event?.event_id ?? null,
    bcs_event_name: event?.name ?? null,
    regarding_id: regardingEvent && event ? event.event_id : client.account_id,
    regarding_name: regardingEvent && event ? event.name : client.name,
    regarding_type: regardingEvent && event ? "bcs_event" : "account",
    percent_complete: pct,
    scheduled_start: days.scheduledStart,
    actual_start: days.actualStart,
    actual_end: days.actualEnd,
    bcs_claimed_by_id: claimedRes.data?.user_id ?? null,
    bcs_claimed_by_name: claimedRes.data?.display_name ?? null,
    bcs_current_assignment_id: assignRes.data?.user_id ?? null,
    bcs_current_assignment_name: assignRes.data?.display_name ?? null,
    bcs_outreach_task_status_code: outreach?.code ?? null,
    bcs_outreach_task_status_label: outreach?.label ?? null,
    bcs_drafting: input.drafting === true,
    bcs_draft_complete: input.draftComplete === true,
    bcs_review_complete: input.reviewComplete === true,
    bcs_processed: input.processed === true,
    bcs_feedback_received: input.feedbackReceived === true,
    // Drives the feedback pipeline's Open bucket (v_feedback_pipeline).
    crdfa_feedback_received_date: fbRecDay ? easternLocalToIso(`${fbRecDay}T00:00`) : null,
    bcs_notified: input.notified === true,
    owner_id: owner?.user_id ?? null,
    owner_name: owner?.display_name ?? null,
    state_code: status.state,
    state_label: status.stateLabel,
    status_code: status.status,
    status_label: status.statusLabel,
  })
}

/**
 * "Add New Task" — insert ONE dashboard-authored task.
 *
 * Constraints on public.tasks (checked live 2026-09-23): task_id is the only
 * required column with no default; there are NO foreign keys, so the client,
 * event and owner are re-read and validated here. Shaped like a Dynamics task:
 * bcs_account = the client; regarding = the client or one of its events; due
 * date = scheduled_end; stock priority "Normal" (every live task).
 *
 * NOT FILTERED ANYWHERE. Containment is the ZVZZT test client.
 */
export async function createTask(input: NewTaskInput): Promise<ActionResult<{ taskId: string }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("creating or deleting tasks")
  if (!gate.ok) return fail(gate.error)

  const built = await buildTaskColumns(input, gate.userId)
  if (!built.ok) return fail(built.error)

  const now = new Date().toISOString()
  const row = {
    task_id: randomUUID(),
    ...DASHBOARD_ROW_BASE,
    is_test: input.isTest === true,
    activity_type_code: "task",
    priority_code: 1,
    priority_label: "Normal",
    ...built.data,
    created_by_id: gate.userId,
    created_by_name: gate.name,
    modified_by_id: gate.userId,
    modified_by_name: gate.name,
    created_on: now,
    modified_on: now,
  }

  const { error } = await getSupabaseServer().from("tasks").insert(row)
  if (error) return fail(describeError(error))

  const { _raw, ...snapshot } = row
  void _raw
  await recordAudit({
    action: "create",
    entity: "tasks",
    recordId: row.task_id,
    changes: snapshot,
    context: "/tasks · Add New Task",
  })

  revalidatePath("/tasks")
  return ok({ taskId: row.task_id })
}

/** A DASHBOARD task, as form input — Dynamics rows are refused. */
export async function loadTaskForEdit(id: string): Promise<ActionResult<NewTaskInput>> {
  const res = await loadDashboardRowForEdit(
    "tasks",
    "task_id",
    id,
    "bcs_account_id, subject, description, bcs_task_type_code, bcs_task_subtype_code, bcs_task_priority_code, status_code, scheduled_end, bcs_event_id, owner_id, regarding_type, percent_complete, scheduled_start, actual_start, actual_end, bcs_claimed_by_id, bcs_current_assignment_id, bcs_outreach_task_status_code, bcs_drafting, bcs_draft_complete, bcs_review_complete, bcs_processed, bcs_feedback_received, bcs_notified, crdfa_feedback_received_date",
  )
  if (!res.ok) return fail(res.error)
  const r = res.data
  const status = TASK_STATUS_OPTIONS.find((s) => s.status === r.status_code) ?? TASK_STATUS_OPTIONS[0]
  return ok({
    clientAccountId: (r.bcs_account_id as string | null) ?? null,
    subject: asText(r.subject),
    description: asText(r.description),
    typeCode: Number(r.bcs_task_type_code),
    subtypeCode: Number(r.bcs_task_subtype_code),
    priorityCode: r.bcs_task_priority_code == null ? null : Number(r.bcs_task_priority_code),
    statusKey: status.key,
    dueDate: isoToEasternDate(r.scheduled_end),
    regarding: r.regarding_type === "bcs_event" && r.bcs_event_id ? (r.bcs_event_id as string) : "client",
    ownerId: (r.owner_id as string | null) ?? null,
    eventId: (r.bcs_event_id as string | null) ?? null,
    percentComplete: asText(r.percent_complete),
    scheduledStart: isoToEasternDate(r.scheduled_start),
    actualStart: isoToEasternDate(r.actual_start),
    actualEnd: isoToEasternDate(r.actual_end),
    claimedById: (r.bcs_claimed_by_id as string | null) ?? null,
    currentAssignmentId: (r.bcs_current_assignment_id as string | null) ?? null,
    outreachStatusCode:
      r.bcs_outreach_task_status_code == null ? null : Number(r.bcs_outreach_task_status_code),
    drafting: r.bcs_drafting === true,
    draftComplete: r.bcs_draft_complete === true,
    reviewComplete: r.bcs_review_complete === true,
    processed: r.bcs_processed === true,
    feedbackReceived: r.bcs_feedback_received === true,
    feedbackReceivedDate: isoToEasternDate(r.crdfa_feedback_received_date),
    notified: r.bcs_notified === true,
    isTest: r.is_test === true,
  })
}

/** Edit a DASHBOARD task. The origin guard lives in updateDashboardRow. */
export async function updateTask(id: string, input: NewTaskInput): Promise<ActionResult<{ changed: number }>> {
  const gate = await requireCrmWriter("editing tasks")
  if (!gate.ok) return fail(gate.error)
  const built = await buildTaskColumns(input, gate.userId)
  if (!built.ok) return fail(built.error)
  return updateDashboardRow({
    table: "tasks",
    pk: "task_id",
    id,
    patch: built.data,
    path: "/tasks",
    context: "/tasks · Edit task",
    verb: "editing tasks",
  })
}

export async function countTestTasks(): Promise<ActionResult<number>> {
  return countTestRows("tasks", "task_id")
}

export async function purgeTestTasks(): Promise<ActionResult<{ deleted: number }>> {
  return purgeTestRows({
    table: "tasks",
    pk: "task_id",
    snapshot: "subject, bcs_account_name, bcs_task_type_label, scheduled_end, created_on, created_by_name",
    path: "/tasks",
    context: "/tasks · Delete test tasks",
  })
}

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
 * through the shared dashboard-write plumbing in lib/crm-write.ts (the same as
 * Add New Contact / Add New Note). Rows are origin='dashboard', which the
 * reconciliation sweep skips. See content/docs/22-cutover-ownership-boundary.md.
 */

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import {
  DASHBOARD_ROW_BASE,
  cleanText,
  countTestRows,
  easternLocalToIso,
  loadAccountOptions,
  purgeTestRows,
  requireCrmWriter,
  updateDashboardRow,
  loadDashboardRowForEdit,
  asText,
  isoToEasternLocal,
  resolveAccount,
} from "@/lib/crm-write"
import {
  TOUCH_CONTACT_TYPE_OPTIONS,
  TOUCH_STATUS_OPTIONS,
  TOUCH_TYPE_OPTIONS,
  type NewTouchInput,
} from "@/lib/touchpoints/create"
import type { AccountOption } from "@/lib/types"
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

  // is_test for the drawer TEST badge, read off the table (not the view) so the
  // drawer does not depend on the view patch. Non-fatal if it fails.
  const { data: flag } = await sb
    .from("touchpoints")
    .select("is_test, origin")
    .eq("touchpoint_id", touchpointId)
    .maybeSingle()

  return ok({ ...(data as unknown as TouchpointRecord), is_test: flag?.is_test === true, origin: (flag?.origin as string | undefined) ?? null })
}

/* ------------------------------------------------------------- touch writes */
// The same shared plumbing as every live CRM entity (lib/crm-write.ts): write
// gate, client re-read, ownership stamp, guarded edit, audited purge.

/** Clients for the form's picker: every account, by name. */
export async function loadTouchClientOptions(): Promise<ActionResult<AccountOption[]>> {
  return loadAccountOptions()
}

/** Validate + build the FLATTENED touch columns — shared by create and edit. */
async function buildTouchColumns(input: NewTouchInput): Promise<ActionResult<Record<string, unknown>>> {
  if (!cleanText(input.clientAccountId)) return fail("Pick a client.")
  const clientRes = await resolveAccount(input.clientAccountId)
  if (!clientRes.ok) return fail(clientRes.error)
  const client = clientRes.data!

  const subject = cleanText(input.subject)
  if (!subject) return fail("Enter a subject.")

  const type = TOUCH_TYPE_OPTIONS.find((o) => o.code === input.typeCode)
  if (!type) return fail("Pick a touch type.")

  const picked = new Set(input.contactTypeCodes ?? [])
  const contactTypes = TOUCH_CONTACT_TYPE_OPTIONS.filter((o) => picked.has(o.code))
  if (contactTypes.length !== picked.size) return fail("Unknown contact type.")

  const start = easternLocalToIso(input.start)
  if (!start) return fail("Enter the date and time.")

  const durText = cleanText(input.durationMinutes)
  const duration = durText === null ? null : Number(durText)
  if (duration !== null && (!Number.isInteger(duration) || duration < 0 || duration > 1440)) {
    return fail("Duration must be whole minutes (0–1440).")
  }

  const status = TOUCH_STATUS_OPTIONS.find((s) => s.key === input.statusKey)
  if (!status) return fail("Pick a status.")

  // Owner Team: on touches the owner is a per-client Dynamics TEAM (named after
  // the account), never a person, and there is no teams table to pick from. So
  // it is DERIVED: the team the client's own synced touches use (97% have one).
  const { data: teamRows } = await getSupabaseServer()
    .from("touchpoints")
    .select("owner_id, owner_name")
    .eq("client_account_id", client.account_id)
    .eq("origin", "dynamics")
    .not("owner_id", "is", null)
    .order("modified_on", { ascending: false })
    .limit(1)
  const team = (teamRows?.[0] as { owner_id: string; owner_name: string | null } | undefined) ?? null

  return ok({
    owner_id: team?.owner_id ?? null,
    owner_name: team?.owner_name ?? null,
    state_code: status.state,
    state_label: status.stateLabel,
    status_code: status.status,
    status_label: status.statusLabel,
    subject,
    description: cleanText(input.description),
    touchpoint_type_code: type.code,
    touchpoint_type_label: type.label,
    contact_type_code: contactTypes.length ? contactTypes.map((o) => o.code).join(",") : null,
    contact_type_label: contactTypes.length ? contactTypes.map((o) => o.label).join("; ") : null,
    client_account_id: client.account_id,
    client_account_name: client.name,
    regarding_id: client.account_id,
    direction_code: input.outgoing !== false,
    scheduled_start: start,
    scheduled_end:
      duration !== null ? new Date(Date.parse(start) + duration * 60_000).toISOString() : start,
    actual_duration_minutes: duration,
  })
}

/**
 * "Add New Touch" — insert ONE dashboard-authored touchpoint (phonecall mirror).
 *
 * Constraints on public.touchpoints (checked live 2026-09-23): touchpoint_id is
 * the only required column with no default; client_account_id → accounts is
 * the one enforced FK. owner is left NULL on purpose: on this entity the owner
 * is a per-client TEAM named after the account, never a person. regarding_id =
 * the client (97% of Dynamics touches); state "Open" (96% of live rows).
 *
 * NOT FILTERED ANYWHERE. Containment is the ZVZZT test client.
 */
export async function createTouch(input: NewTouchInput): Promise<ActionResult<{ touchpointId: string }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("creating or deleting touches")
  if (!gate.ok) return fail(gate.error)

  const built = await buildTouchColumns(input)
  if (!built.ok) return fail(built.error)

  const now = new Date().toISOString()
  const row = {
    touchpoint_id: randomUUID(),
    ...DASHBOARD_ROW_BASE,
    is_test: input.isTest === true,
    ...built.data,
    created_by_id: gate.userId,
    created_by_name: gate.name,
    modified_by_id: gate.userId,
    modified_by_name: gate.name,
    created_on: now,
    modified_on: now,
  }

  const { error } = await getSupabaseServer().from("touchpoints").insert(row)
  if (error) return fail(describeError(error))

  const { _raw, ...snapshot } = row
  void _raw
  await recordAudit({
    action: "create",
    entity: "touchpoints",
    recordId: row.touchpoint_id,
    changes: snapshot,
    context: "/touchpoints · Add New Touch",
  })

  revalidatePath("/touchpoints")
  return ok({ touchpointId: row.touchpoint_id })
}

/** A DASHBOARD touch, as form input — Dynamics rows are refused. */
export async function loadTouchForEdit(id: string): Promise<ActionResult<NewTouchInput>> {
  const res = await loadDashboardRowForEdit(
    "touchpoints",
    "touchpoint_id",
    id,
    "client_account_id, subject, description, touchpoint_type_code, contact_type_code, direction_code, scheduled_start, actual_duration_minutes, status_code",
  )
  if (!res.ok) return fail(res.error)
  const r = res.data
  return ok({
    clientAccountId: (r.client_account_id as string | null) ?? null,
    subject: asText(r.subject),
    description: asText(r.description),
    typeCode: asText(r.touchpoint_type_code),
    contactTypeCodes: asText(r.contact_type_code).split(",").filter(Boolean),
    outgoing: r.direction_code !== false,
    start: isoToEasternLocal(r.scheduled_start),
    durationMinutes: asText(r.actual_duration_minutes),
    statusKey: (TOUCH_STATUS_OPTIONS.find((s) => s.status === r.status_code) ?? TOUCH_STATUS_OPTIONS[0]).key,
    isTest: r.is_test === true,
  })
}

/** Edit a DASHBOARD touch. The origin guard lives in updateDashboardRow. */
export async function updateTouch(id: string, input: NewTouchInput): Promise<ActionResult<{ changed: number }>> {
  const gate = await requireCrmWriter("editing touches")
  if (!gate.ok) return fail(gate.error)
  const built = await buildTouchColumns(input)
  if (!built.ok) return fail(built.error)
  return updateDashboardRow({
    table: "touchpoints",
    pk: "touchpoint_id",
    id,
    patch: built.data,
    path: "/touchpoints",
    context: "/touchpoints · Edit touch",
    verb: "editing touches",
  })
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

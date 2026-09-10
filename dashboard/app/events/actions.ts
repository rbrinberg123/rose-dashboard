"use server"

/**
 * Events' server actions: the record drawer's on-demand fetch, the uncapped
 * export, the saved-view writes and the filter-dropdown options.
 *
 * ══ SECURITY ═══════════════════════════════════════════════════════════════
 * Every function here re-checks that the EFFECTIVE role is super_user before it
 * builds a query. `v_admin_events_all` is unscoped and read with the
 * service-role key (RLS bypassed), so a successful call hands back every
 * client's events. The page gate and the proxy gate are not enough on their own:
 * a server action is its own entry point and can be invoked directly.
 *
 * The saved-view writes delegate to lib/table-views/saved-views.ts, which is
 * where the who-may-do-what rules live — shared with Meetings so there is one
 * implementation, not two. Read that file's header before changing them.
 */

import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import {
  availableColumns,
  fetchAllRows,
  loadFilterOptionGroups,
} from "@/lib/table-views/query"
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
import { EVENTS_SPEC } from "@/lib/events/spec"
import { applyEventQuickFilters, type EventQuickFilters } from "@/lib/events/filters"
import type { EventRecord } from "@/lib/events/record"
import type { AdminEventRow } from "@/lib/types"

/* ---------------------------------------------------------------- saved views */

export async function listSavedViews(): Promise<ActionResult<SavedView[]>> {
  return sharedList(EVENTS_SPEC)
}

export async function createSavedView(input: {
  name: string
  scope: SavedViewScope
  config: unknown
}): Promise<ActionResult<{ id: string }>> {
  return sharedCreate(EVENTS_SPEC, input)
}

export async function updateSavedView(input: {
  id: string
  name?: string
  config?: unknown
}): Promise<ActionResult> {
  return sharedUpdate(EVENTS_SPEC, input)
}

export async function setDefaultSavedView(input: {
  id: string | null
  scope: SavedViewScope
}): Promise<ActionResult> {
  return sharedSetDefault(EVENTS_SPEC, input)
}

export async function deleteSavedView(input: { id: string }): Promise<ActionResult> {
  return sharedDelete(EVENTS_SPEC, input)
}

/* ------------------------------------------------------------ filter options */

/**
 * Client / Event State / Account Manager choices.
 *
 * Fetched by the CLIENT after the table renders, never by the page loader —
 * nothing on screen needs a dropdown's contents in order to paint a table. Reads
 * v_admin_events_filter_options, where the distinct-ing is done in Postgres.
 */
export async function loadEventFilterOptions(): Promise<ActionResult<QuickFilterOptions>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const groups = await loadFilterOptionGroups(getSupabaseServer(), EVENTS_SPEC, "event_count")
  return ok({
    client: groups.client ?? [],
    event_state: groups.event_state ?? [],
    manager: groups.manager ?? [],
  })
}

/* ------------------------------------------------------------------- export */

/**
 * Every row of the current view, UNCAPPED — for the Excel export only.
 *
 * The page stops at ROW_CAP; the export must not, or capping the page would
 * silently start truncating spreadsheets. `config` arrives from the client, so
 * it goes through `parseConfig`, which admits only known column keys and a
 * closed operator set.
 */
export async function loadEventRowsForExport(input: {
  config: unknown
  quick?: EventQuickFilters
}): Promise<ActionResult<AdminEventRow[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const parsed = parseConfig(EVENTS_SPEC, input.config)
  if (!parsed.ok) return fail(parsed.error)

  const sb = getSupabaseServer()
  const available = await availableColumns(sb, EVENTS_SPEC)
  const quick = input.quick ?? {}

  const { rows, error } = await fetchAllRows<AdminEventRow>(
    sb,
    EVENTS_SPEC,
    parsed.config,
    new Date(),
    available,
    ((q: unknown) => applyEventQuickFilters(q, quick)) as <Q>(q: Q) => Q,
  )
  if (error) return fail(error)
  return ok(rows)
}

/* ------------------------------------------------------------ record drawer */

/**
 * Load ONE event's full record for the drawer.
 *
 * Fetched on demand rather than shipped with the list: the list carries only its
 * seven display columns, and most of what the drawer shows (notes, the whole
 * Planning block) is never looked at. One row on open is far cheaper than
 * hundreds of rows of detail.
 *
 * Unlike the meetings drawer this needs no `_raw` at all — public.events is a
 * fully flattened mirror, so every field the drawer wants is a real column.
 */
const RECORD_COLUMNS = [
  "event_id",
  "client_account_id",
  "event_title",
  "event_state_label",
  "marketing_state_label",
  "client_account_name",
  "client_ticker",
  "event_location",
  "tbc",
  "event_dates",
  "account_manager_name",
  "logistics_coordinator_name",
  "feedback_team_name",
  "feedback_report_name",
  "leads_labels",
  "team",
  "event_notes",
  "meetings_start",
  "meetings_end",
  "event_parameters",
  "of_slots",
  "confirmed_meetings",
  "slots_remaining",
  "urgency_label",
  "launch_week",
  "memo_date",
  "last_data_upload",
  "shareholder_report_received_date",
  "targeting_not_required",
  "memo_not_required",
  "targeting_date",
  "targeting_url",
  "profile_link",
  "targeting_notes",
  "launch",
  "outreach_complete",
  "user_team_lead",
  "state_label",
  "created_on",
  "modified_on",
].join(", ")

export async function loadEventRecord(eventId: string): Promise<ActionResult<EventRecord>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  if (!eventId) return fail("No event id.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from(EVENTS_SPEC.viewName)
    .select(RECORD_COLUMNS)
    .eq("event_id", eventId)
    .maybeSingle()

  if (error) return fail(describeError(error))
  if (!data) return fail("Event not found.")

  return ok(data as unknown as EventRecord)
}

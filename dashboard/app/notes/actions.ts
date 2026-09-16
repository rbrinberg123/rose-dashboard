"use server"

/**
 * Notes' server actions: the record drawer's on-demand fetch, the uncapped
 * export, the saved-view writes and the filter-dropdown options.
 *
 * ══ SECURITY ═══════════════════════════════════════════════════════════════
 * Every function here re-checks that the EFFECTIVE role is super_user before it
 * builds a query. `v_admin_notes_all` is unscoped and read with the service-role
 * key (RLS bypassed), so a successful call hands back every client's notes —
 * the firm's candid internal assessment of each relationship, which makes this
 * the most sensitive of the five CRM tables. The page gate and the proxy gate are
 * not enough on their own: a server action is its own entry point and can be
 * invoked directly.
 *
 * The saved-view writes delegate to lib/table-views/saved-views.ts, which is
 * where the who-may-do-what rules live — shared with the other four CRM tables
 * so there is one implementation, not five. Read that file's header before
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
import { NOTES_SPEC } from "@/lib/notes/spec"
import {
  applyNoteQuickFilters,
  loadUserAliasGroups,
  type NoteQuickFilters,
} from "@/lib/notes/filters"
import type { NoteRecord } from "@/lib/notes/record"
import type { AdminNoteRow } from "@/lib/types"

/* ---------------------------------------------------------------- saved views */

export async function listSavedViews(): Promise<ActionResult<SavedView[]>> {
  return sharedList(NOTES_SPEC)
}

export async function createSavedView(input: {
  name: string
  scope: SavedViewScope
  config: unknown
}): Promise<ActionResult<{ id: string }>> {
  return sharedCreate(NOTES_SPEC, input)
}

export async function updateSavedView(input: {
  id: string
  name?: string
  config?: unknown
}): Promise<ActionResult> {
  return sharedUpdate(NOTES_SPEC, input)
}

export async function setDefaultSavedView(input: {
  id: string | null
  scope: SavedViewScope
}): Promise<ActionResult> {
  return sharedSetDefault(NOTES_SPEC, input)
}

export async function deleteSavedView(input: { id: string }): Promise<ActionResult> {
  return sharedDelete(NOTES_SPEC, input)
}

/* ------------------------------------------------------------ filter options */

/**
 * Client / Status / Risk Driver / Owner / Review Cycle choices.
 *
 * Fetched by the CLIENT after the table renders, never by the page loader —
 * nothing on screen needs a dropdown's contents in order to paint a table. Reads
 * v_admin_notes_filter_options, where the distinct-ing is done in Postgres.
 *
 * That view btrims every text value, matching v_admin_notes_all. Without it the
 * Status dropdown would offer "Stable" and "Stable\n" as two choices, each
 * returning part of the rows. Neither side may drop the btrim on its own.
 */
export async function loadNoteFilterOptions(): Promise<ActionResult<QuickFilterOptions>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const groups = await loadFilterOptionGroups(getSupabaseServer(), NOTES_SPEC, "note_count")
  return ok({
    client: groups.client ?? [],
    status: groups.status ?? [],
    risk: groups.risk ?? [],
    owner: groups.owner ?? [],
    cycle: groups.cycle ?? [],
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
export async function loadNoteRowsForExport(input: {
  config: unknown
  quick?: NoteQuickFilters
}): Promise<ActionResult<AdminNoteRow[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const parsed = parseConfig(NOTES_SPEC, input.config)
  if (!parsed.ok) return fail(parsed.error)

  const sb = getSupabaseServer()
  const [available, aliasGroups] = await Promise.all([
    availableColumns(sb, NOTES_SPEC),
    loadUserAliasGroups(sb),
  ])
  const quick = input.quick ?? {}

  const { rows, error } = await fetchAllRows<AdminNoteRow>(
    sb,
    NOTES_SPEC,
    parsed.config,
    new Date(),
    available,
    ((q: unknown) => applyNoteQuickFilters(q, quick, aliasGroups)) as <Q>(q: Q) => Q,
  )
  if (error) return fail(error)
  return ok(rows)
}

/* ------------------------------------------------------------ record drawer */

/**
 * Load ONE note's full record for the drawer.
 *
 * Fetched on demand rather than shipped with the list. That matters more here
 * than on the other CRM tables: a note IS its body, and the body averages 256
 * characters and runs to 1,465 — shipping both the line-broken and the flattened
 * copy for every row would dominate the payload of a list that shows a truncated
 * one-liner.
 *
 * No `_raw` here. The view already digs out `note_body`, `owner_name`,
 * `created_by_name` and `modified_by_name` (the mapper flattened none of them),
 * so every field the drawer wants is a real column by the time this query runs;
 * `_raw` is deliberately NOT selected by either this query or the list.
 */
const RECORD_COLUMNS = [
  "note_id",
  "client_account_id",
  "review_cycle",
  "note_date",
  "note_body",
  "notes_text",
  "status_text",
  "primary_risk_driver",
  "action_step",
  "action_owner",
  "action_deadline",
  "client_account_name",
  "client_ticker",
  "owner_id",
  "owner_name",
  "created_by_name",
  "modified_by_name",
  "state_label",
  "status_label",
  "created_on",
  "modified_on",
  "is_recent",
].join(", ")

export async function loadNoteRecord(noteId: string): Promise<ActionResult<NoteRecord>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  if (!noteId) return fail("No note id.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from(NOTES_SPEC.viewName)
    .select(RECORD_COLUMNS)
    .eq("note_id", noteId)
    .maybeSingle()

  if (error) return fail(describeError(error))
  if (!data) return fail("Note not found.")

  return ok(data as unknown as NoteRecord)
}

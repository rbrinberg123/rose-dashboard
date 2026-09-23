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
 *
 * ══ NOTE WRITES ═════════════════════════════════════════════════════════════
 * `createNote` and `purgeTestNotes` (bottom of this file) write notes, through
 * the shared dashboard-write plumbing in lib/crm-write.ts (the same as Add New
 * Contact). Rows are origin='dashboard' — the first dashboard rows on a table
 * the reconciliation sweep covers. See content/docs/22-cutover-ownership-boundary.md.
 */

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import {
  DASHBOARD_ROW_BASE,
  cleanText,
  countTestRows,
  isIsoDate,
  loadAccountOptions,
  purgeTestRows,
  requireCrmWriter,
  loadUserOptions,
  resolveUser,
  updateDashboardRow,
  loadDashboardRowForEdit,
  asText,
  resolveAccount,
} from "@/lib/crm-write"
import { defaultReviewCycle, type NewNoteInput } from "@/lib/notes/create"
import type { AccountOption, UserOption } from "@/lib/types"
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

  // is_test for the drawer TEST badge, read off the table (not the view) so the
  // drawer does not depend on the view patch. Non-fatal if it fails.
  const { data: flag } = await sb
    .from("client_notes")
    .select("is_test, origin")
    .eq("note_id", noteId)
    .maybeSingle()

  return ok({ ...(data as unknown as NoteRecord), is_test: flag?.is_test === true, origin: (flag?.origin as string | undefined) ?? null })
}

/* -------------------------------------------------------------- note writes */
// The same shared plumbing as every live CRM entity (lib/crm-write.ts): write
// gate, client re-read, ownership stamp, guarded edit, audited purge.

/** Clients for the form's picker: every account, by name. */
export async function loadNoteClientOptions(): Promise<ActionResult<AccountOption[]>> {
  return loadAccountOptions()
}

/** People for the Owner picker. */
export async function loadNoteUserOptions(): Promise<ActionResult<UserOption[]>> {
  return loadUserOptions()
}

/** Validate + build the FLATTENED note columns — shared by create and edit. */
async function buildNoteColumns(
  input: NewNoteInput,
  defaultOwnerId: string | null,
): Promise<ActionResult<Record<string, unknown>>> {
  if (!cleanText(input.clientAccountId)) return fail("Pick a client.")
  const clientRes = await resolveAccount(input.clientAccountId)
  if (!clientRes.ok) return fail(clientRes.error)
  const client = clientRes.data!

  const noteDate = cleanText(input.noteDate)
  if (!noteDate || !isIsoDate(noteDate)) return fail("Enter a note date.")

  const body = cleanText(input.body)
  if (!body) return fail("Write the note.")

  const deadline = cleanText(input.actionDeadline)
  if (deadline && !isIsoDate(deadline)) return fail("The action deadline isn't a valid date.")

  // Owner = the note's AUTHOR on this entity (see mapClientNote).
  const ownerRes = await resolveUser(input.ownerId ?? defaultOwnerId)
  if (!ownerRes.ok) return fail(ownerRes.error)
  const owner = ownerRes.data

  return ok({
    owner_id: owner?.user_id ?? null,
    owner_name: owner?.display_name ?? null,
    name: cleanText(input.reviewCycle) ?? defaultReviewCycle(noteDate),
    note_date: noteDate,
    // note_body keeps line breaks; notes_text is Dynamics' collapsed copy.
    note_body: body,
    notes_text: body.replace(/\s+/g, " "),
    status_text: cleanText(input.statusText),
    primary_risk_driver: cleanText(input.primaryRiskDriver),
    action_step: cleanText(input.actionStep),
    action_owner: cleanText(input.actionOwner),
    action_deadline: deadline,
    client_account_id: client.account_id,
    client_account_name: client.name,
  })
}

/**
 * "Add New Note" — insert ONE dashboard-authored client note.
 *
 * Constraints on public.client_notes (checked live 2026-09-23): note_id is the
 * only required column with no default; client_account_id → accounts is the
 * one enforced FK (required here and re-read). owner is the note's AUTHOR (see
 * mapClientNote), set once at create.
 *
 * NOT FILTERED ANYWHERE: flows to Portfolio, Client Detail, the AI summary and
 * Live Outreach like a Dynamics note. Containment is the ZVZZT test client.
 */
export async function createNote(input: NewNoteInput): Promise<ActionResult<{ noteId: string }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("creating or deleting notes")
  if (!gate.ok) return fail(gate.error)

  const built = await buildNoteColumns(input, gate.userId)
  if (!built.ok) return fail(built.error)

  const now = new Date().toISOString()
  const row = {
    note_id: randomUUID(),
    ...DASHBOARD_ROW_BASE,
    is_test: input.isTest === true,
    ...built.data,
    created_by_id: gate.userId,
    created_by_name: gate.name,
    modified_by_id: gate.userId,
    modified_by_name: gate.name,
    state_code: 0,
    state_label: "Active",
    status_code: 1,
    status_label: "Active",
    created_on: now,
    modified_on: now,
  }

  const { error } = await getSupabaseServer().from("client_notes").insert(row)
  if (error) return fail(describeError(error))

  const { _raw, ...snapshot } = row
  void _raw
  await recordAudit({
    action: "create",
    entity: "client_notes",
    recordId: row.note_id,
    changes: snapshot,
    context: "/notes · Add New Note",
  })

  revalidatePath("/notes")
  return ok({ noteId: row.note_id })
}

/** A DASHBOARD note, as form input — Dynamics rows are refused. */
export async function loadNoteForEdit(id: string): Promise<ActionResult<NewNoteInput>> {
  const res = await loadDashboardRowForEdit(
    "client_notes",
    "note_id",
    id,
    "client_account_id, note_date, name, note_body, status_text, primary_risk_driver, action_step, action_owner, action_deadline, owner_id",
  )
  if (!res.ok) return fail(res.error)
  const r = res.data
  return ok({
    clientAccountId: (r.client_account_id as string | null) ?? null,
    noteDate: asText(r.note_date).slice(0, 10),
    reviewCycle: asText(r.name),
    body: asText(r.note_body),
    statusText: asText(r.status_text).trim(),
    primaryRiskDriver: asText(r.primary_risk_driver).trim(),
    actionStep: asText(r.action_step),
    actionOwner: asText(r.action_owner),
    actionDeadline: asText(r.action_deadline).slice(0, 10),
    ownerId: (r.owner_id as string | null) ?? null,
    isTest: r.is_test === true,
  })
}

/** Edit a DASHBOARD note. The origin guard lives in updateDashboardRow. */
export async function updateNote(id: string, input: NewNoteInput): Promise<ActionResult<{ changed: number }>> {
  const gate = await requireCrmWriter("editing notes")
  if (!gate.ok) return fail(gate.error)
  const built = await buildNoteColumns(input, gate.userId)
  if (!built.ok) return fail(built.error)
  return updateDashboardRow({
    table: "client_notes",
    pk: "note_id",
    id,
    patch: built.data,
    path: "/notes",
    context: "/notes · Edit note",
    verb: "editing notes",
  })
}

/** How many test notes the purge would remove — for the confirm prompt. */
export async function countTestNotes(): Promise<ActionResult<number>> {
  return countTestRows("client_notes", "note_id")
}

/** Delete every dashboard-created TEST note (see purgeTestRows). */
export async function purgeTestNotes(): Promise<ActionResult<{ deleted: number }>> {
  return purgeTestRows({
    table: "client_notes",
    pk: "note_id",
    snapshot: "client_account_name, note_date, name, status_text, created_on, created_by_name",
    path: "/notes",
    context: "/notes · Delete test notes",
  })
}

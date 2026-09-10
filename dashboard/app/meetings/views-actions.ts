"use server"

/**
 * Meetings' saved-view writes — a BINDING over lib/table-views/saved-views.ts.
 *
 * ══ WHERE THE SECURITY LIVES ═══════════════════════════════════════════════
 * NOT here. Every rule — identity resolved server-side, personal views private,
 * system views super-user-write, impersonation read-only, configs validated —
 * is implemented ONCE in lib/table-views/saved-views.ts and shared with Events.
 * Read that file's header before changing anything about who may do what.
 *
 * This file exists only because a "use server" module may export nothing but
 * async functions, so the spec has to be bound on this side of the boundary
 * rather than passed in from the client.
 */

import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { fail, ok, type ActionResult } from "@/lib/actions"
import {
  createSavedView as sharedCreate,
  deleteSavedView as sharedDelete,
  listSavedViews as sharedList,
  setDefaultSavedView as sharedSetDefault,
  updateSavedView as sharedUpdate,
} from "@/lib/table-views/saved-views"
import type { SavedView, SavedViewScope } from "@/lib/table-views/types"
import { MEETINGS_SPEC } from "@/lib/meetings/spec"
import { loadFilterOptions, type FilterOptions } from "@/lib/meetings/query"

export async function listSavedViews(): Promise<ActionResult<SavedView[]>> {
  return sharedList(MEETINGS_SPEC)
}

export async function createSavedView(input: {
  name: string
  scope: SavedViewScope
  config: unknown
}): Promise<ActionResult<{ id: string }>> {
  return sharedCreate(MEETINGS_SPEC, input)
}

export async function updateSavedView(input: {
  id: string
  name?: string
  config?: unknown
}): Promise<ActionResult> {
  return sharedUpdate(MEETINGS_SPEC, input)
}

export async function setDefaultSavedView(input: {
  id: string | null
  scope: SavedViewScope
}): Promise<ActionResult> {
  return sharedSetDefault(MEETINGS_SPEC, input)
}

export async function deleteSavedView(input: { id: string }): Promise<ActionResult> {
  return sharedDelete(MEETINGS_SPEC, input)
}

/**
 * The Client / Host / Feedback dropdown choices.
 *
 * Fetched by the CLIENT after the table renders, not by the page loader:
 * sourcing them can take seconds when v_admin_meetings_filter_options is
 * missing, and nothing on screen needs them to paint. Same super-user gate as
 * everything else here.
 */
export async function loadMeetingFilterOptions(): Promise<ActionResult<FilterOptions>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
  return ok(await loadFilterOptions(getSupabaseServer()))
}

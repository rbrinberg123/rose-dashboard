"use server"

/**
 * The Onboarding page's Onboarding Call / Teach-in cells → touchpoints.
 *
 * ══ SECURITY — A NARROW PATH, NOT A GENERAL OPENING OF TOUCHPOINTS ══════════
 * Every other touchpoint action (app/touchpoints/actions.ts) is super_user
 * only. These are gated instead by the viewer's CLIENT SCOPE, and only for
 * touchpoints of the two onboarding types:
 *
 *   1. the effective role may reach /onboarding (canAccessRoute + the Roles
 *      matrix) — a server action is its own entry point;
 *   2. the client is inside resolveClientScope(effective identity) — the same
 *      filter the Onboarding page itself applies (null = all clients);
 *   3. the touchpoint's type is Onboarding Call or Teach-in, both on what is
 *      loaded and on what is written (ONBOARDING_TOUCH_TYPE_CODES);
 *   4. writes refuse while in "View as" (the requireCrmWriter rule).
 *
 * Dynamics-origin touchpoints stay READ-ONLY: edits go through
 * updateDashboardRow, whose origin guard refuses any non-dashboard row, and
 * new touchpoints are always origin='dashboard' (insertTouch). Nothing here
 * writes accounts.onboarding_call / teach_in_date — the view derives the date.
 * The service-role key bypasses RLS, so these checks ARE the gate.
 */

import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { getEffectiveAllowedRoutes } from "@/lib/effective-identity"
import { canAccessRoute } from "@/lib/access-control"
import { resolveClientScope } from "@/lib/access/data-scope"
import { isUuid, readActiveAccountOptions } from "@/lib/crm-write"
import {
  insertTouch,
  readTouchContactOptions,
  readTouchContacts,
  readTouchForEdit,
  readTouchRecord,
  updateTouchRow,
  type TouchActor,
  type TouchContactOption,
} from "@/lib/touchpoints/write"
import type { NewTouchInput, TouchContact } from "@/lib/touchpoints/create"
import type { TouchpointRecord } from "@/lib/touchpoints/record"
import type { AccountOption } from "@/lib/types"
import {
  ONBOARDING_TOUCH_KINDS,
  ONBOARDING_TOUCH_TYPE_CODES,
  ONBOARDING_TOUCH_TYPE_LABELS,
  isOnboardingTouchKind,
  type OnboardingTouchKind,
} from "@/lib/onboarding/touch-link"

const PAGE = "/onboarding"
const CONTEXT = "/onboarding · touchpoint cell"

type Gate = { ok: true; actor: TouchActor; scope: Set<string> | null } | { ok: false; error: string }

/** Steps 1 + 4 (page access, View-as) and the scope itself. */
async function gateViewer(write: boolean): Promise<Gate> {
  const [role, identity] = await Promise.all([getEffectiveRole(), getEffectiveIdentity()])
  if (!canAccessRoute(role, PAGE, await getEffectiveAllowedRoutes())) return { ok: false, error: "Not authorised." }
  if (write && identity.impersonated) return { ok: false, error: "Exit “View as” before saving touchpoints." }
  const scope = await resolveClientScope(identity)
  return { ok: true, actor: { userId: identity.userId, name: identity.name }, scope }
}

/** Step 2 for one client. */
async function gateClient(accountId: string | null | undefined, write: boolean): Promise<Gate> {
  if (!accountId || !isUuid(accountId)) return { ok: false, error: "Unknown client." }
  const g = await gateViewer(write)
  if (!g.ok) return g
  if (g.scope && !g.scope.has(accountId)) return { ok: false, error: "That client is not in your client scope." }
  return g
}

/** Step 3 + 2 for an existing touchpoint: it must be an onboarding type at an in-scope client. */
async function gateTouch(
  touchpointId: string,
  write: boolean,
): Promise<(Gate & { ok: true; clientAccountId: string; origin: string | null }) | { ok: false; error: string }> {
  if (!isUuid(touchpointId)) return { ok: false, error: "Unknown touchpoint." }
  const { data, error } = await getSupabaseServer()
    .from("touchpoints")
    .select("client_account_id, touchpoint_type_label, origin")
    .eq("touchpoint_id", touchpointId)
    .maybeSingle()
  if (error) return { ok: false, error: describeError(error) }
  if (!data) return { ok: false, error: "Touchpoint not found." }
  const row = data as { client_account_id: string | null; touchpoint_type_label: string | null; origin: string | null }
  if (!ONBOARDING_TOUCH_TYPE_LABELS.includes(row.touchpoint_type_label ?? "")) {
    return { ok: false, error: "Only Onboarding Call and Teach-in touchpoints open from this page." }
  }
  const g = await gateClient(row.client_account_id, write)
  if (!g.ok) return g
  return { ...g, clientAccountId: row.client_account_id!, origin: row.origin }
}

/* -------------------------------------------------------------- the click */

/**
 * What a cell click should open. Branches on whether a touchpoint of that type
 * EXISTS for the client — not on whether the cell shows a date, since a date
 * can come from the stored account column with no touchpoint behind it.
 * "Most recently entered" uses the same ordering as the view's LATERAL join
 * (created_on DESC NULLS LAST, touchpoint_id DESC), so the opened touchpoint
 * is the one whose date the cell shows.
 */
export async function findOnboardingTouch(input: {
  accountId: string
  kind: OnboardingTouchKind
}): Promise<ActionResult<{ touchpointId: string; origin: string | null } | null>> {
  if (!isOnboardingTouchKind(input.kind)) return fail("Unknown onboarding step.")
  const g = await gateClient(input.accountId, false)
  if (!g.ok) return fail(g.error)
  const { data, error } = await getSupabaseServer()
    .from("touchpoints")
    .select("touchpoint_id, origin")
    .eq("client_account_id", input.accountId)
    .eq("touchpoint_type_label", ONBOARDING_TOUCH_KINDS[input.kind].label)
    .order("created_on", { ascending: false, nullsFirst: false })
    .order("touchpoint_id", { ascending: false })
    .limit(1)
  if (error) return fail(describeError(error))
  const hit = (data?.[0] as { touchpoint_id: string; origin: string | null } | undefined) ?? null
  return ok(hit ? { touchpointId: hit.touchpoint_id, origin: hit.origin } : null)
}

/* --------------------------------------------------------- read (any origin) */

/** The read-only drawer (Dynamics-origin rows, until cutover). */
export async function loadOnboardingTouchRecord(touchpointId: string): Promise<ActionResult<TouchpointRecord>> {
  const g = await gateTouch(touchpointId, false)
  if (!g.ok) return fail(g.error)
  return readTouchRecord(touchpointId)
}

/** The drawer's Client Contacts list. */
export async function loadOnboardingTouchContacts(touchpointId: string): Promise<ActionResult<TouchContact[]>> {
  const g = await gateTouch(touchpointId, false)
  if (!g.ok) return fail(g.error)
  return readTouchContacts(touchpointId)
}

/* ------------------------------------------------------- the form's lookups */

/** Client picker: ACTIVE clients inside the viewer's scope (plus the row's own). */
export async function loadOnboardingTouchClients(includeAccountId?: string | null): Promise<ActionResult<AccountOption[]>> {
  const g = await gateViewer(false)
  if (!g.ok) return fail(g.error)
  const keep = includeAccountId && (!g.scope || g.scope.has(includeAccountId)) ? includeAccountId : null
  return readActiveAccountOptions(keep, g.scope ? [...g.scope] : null)
}

/** Client Contact picker: that client's active contacts, client in scope. */
export async function loadOnboardingTouchContactOptions(input: {
  clientAccountId: string | null
  all: boolean
}): Promise<ActionResult<TouchContactOption[]>> {
  if (!input.clientAccountId) return ok([])
  const g = await gateClient(input.clientAccountId, false)
  if (!g.ok) return fail(g.error)
  return readTouchContactOptions(input.clientAccountId)
}

/* ------------------------------------------------- write (dashboard only) */

const typeError = "From the Onboarding page a touchpoint must be an Onboarding Call or a Teach-in."

/** Create — always origin='dashboard'. The view picks the new date up itself. */
export async function createOnboardingTouch(input: NewTouchInput): Promise<ActionResult<{ touchpointId: string }>> {
  // ---- GATE (must stay first) ----
  const g = await gateClient(input.clientAccountId, true)
  if (!g.ok) return fail(g.error)
  if (!ONBOARDING_TOUCH_TYPE_CODES.includes(input.typeCode)) return fail(typeError)
  const res = await insertTouch(input, g.actor, CONTEXT)
  if (res.ok) revalidatePath(PAGE)
  return res
}

/** A DASHBOARD onboarding touchpoint as form input — Dynamics rows are refused. */
export async function loadOnboardingTouchForEdit(touchpointId: string): Promise<ActionResult<NewTouchInput>> {
  const g = await gateTouch(touchpointId, false)
  if (!g.ok) return fail(g.error)
  return readTouchForEdit(touchpointId)
}

/** Edit — dashboard rows only (updateDashboardRow's origin guard). */
export async function updateOnboardingTouch(
  touchpointId: string,
  input: NewTouchInput,
): Promise<ActionResult<{ changed: number }>> {
  // ---- GATE (must stay first) ----
  const g = await gateTouch(touchpointId, true)
  if (!g.ok) return fail(g.error)
  // Moving it to another client: that client must be in scope too.
  if (input.clientAccountId !== g.clientAccountId) {
    const g2 = await gateClient(input.clientAccountId, true)
    if (!g2.ok) return fail(g2.error)
  }
  if (!ONBOARDING_TOUCH_TYPE_CODES.includes(input.typeCode)) return fail(typeError)
  const res = await updateTouchRow(touchpointId, input, g.actor, CONTEXT)
  if (res.ok) revalidatePath(PAGE)
  return res
}

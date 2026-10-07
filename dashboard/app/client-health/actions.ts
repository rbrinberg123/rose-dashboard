"use server"

/**
 * Clients → Client Health — the ONLY writer of the override_* columns of
 * public.client_health_assessments, and the only place a "Needs review" flag is
 * CLEARED. (The ai_* columns are written only by lib/client-health.ts via
 * /api/client-health/refresh, which may also RAISE a review flag.)
 *
 * Every human action here re-baselines the review: override_reviewed_at = now,
 * review_baseline_ai_rating = the current AI rating, flag cleared — so the same
 * unchanged situation does not nag again (rules: lib/client-health-review.ts).
 *
 * Firm order: reorderHealthCategory is the only writer of manual_rank values;
 * a save / revert that moves the client to a different category clears it
 * (same rule as the regeneration — lib/client-health-order.ts).
 *
 * Gate: requireCrmWriter — effective super_user AND not in "View as". Every
 * save / keep / revert is audited.
 */

import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { diffRows, recordAudit } from "@/lib/audit"
import { cleanText, isUuid, requireCrmWriter } from "@/lib/crm-write"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { isHealthRating } from "@/lib/client-health-prompt"
import { isOverrideMode, type OverrideMode } from "@/lib/client-health-review"
import { HEALTH_TABLE } from "@/lib/client-health"
import {
  categoryChanged,
  categoryOf,
  compareFirmOrder,
  FIRM_CATEGORY_LABEL,
  isFirmCategory,
} from "@/lib/client-health-order"

const PATH = "/client-health"
const OVERRIDE_COLS =
  "account_id, ai_rating, manual_rank, override_rating, override_note, overridden_by, overridden_at, override_mode, review_suggested, review_reason, review_flagged_at, override_reviewed_at, review_baseline_ai_rating"

/** Clears an open flag and re-baselines against the AI rating as it stands now. */
const rebaseline = (aiRating: string | null, now: string) => ({
  override_reviewed_at: now,
  review_baseline_ai_rating: aiRating,
  review_suggested: false,
  review_reason: null,
  review_flagged_at: null,
})

/**
 * { manual_rank: null } when the new effective rating puts the client in a
 * different firm-order category (it drops to the bottom, awaiting placement).
 */
function rankResetFor(prev: Record<string, unknown> | null, nextEffective: string | null) {
  if (!prev || prev.manual_rank == null) return {}
  const prevEffective = ((prev.override_rating ?? prev.ai_rating) as string | null) ?? null
  return categoryChanged(prevEffective, nextEffective) ? { manual_rank: null } : {}
}

/** The client must be ACTIVE — never accept an arbitrary id from the browser. */
async function isActiveClient(accountId: string): Promise<boolean> {
  const { data } = await getSupabaseServer()
    .from("v_client_detail_summary")
    .select("account_id")
    .eq("account_id", accountId)
    .maybeSingle()
  return Boolean(data)
}

/**
 * Save an override (also the "Update" resolution of a Needs-review flag, and
 * the Prefer ↔ Pin switch). Either field may be blank (keeps the AI value for
 * it). Clears any open flag and re-baselines.
 */
export async function saveHealthOverride(
  accountId: string,
  rating: string | null,
  note: string | null,
  mode: OverrideMode = "prefer",
): Promise<ActionResult> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("overriding client health")
  if (!gate.ok) return fail(gate.error)
  if (!isUuid(accountId)) return fail("Unknown client.")

  const overrideRating = rating ? rating.trim() : null
  if (overrideRating !== null && !isHealthRating(overrideRating)) return fail("Invalid rating.")
  if (!isOverrideMode(mode)) return fail("Invalid override mode.")
  const overrideNote = cleanText(note)
  if (overrideRating === null && overrideNote === null) {
    return fail("Nothing to override — use “Revert to AI” to clear an override.")
  }
  if (!(await isActiveClient(accountId))) return fail("That client is not an active client.")

  const sb = getSupabaseServer()
  const { data: before, error: readErr } = await sb
    .from(HEALTH_TABLE)
    .select(OVERRIDE_COLS)
    .eq("account_id", accountId)
    .maybeSingle()
  if (readErr) return fail(describeError(readErr))
  const prev = before as Record<string, unknown> | null

  const now = new Date().toISOString()
  const patch = {
    override_rating: overrideRating,
    override_note: overrideNote,
    overridden_by: gate.userId,
    overridden_at: now,
    override_mode: mode,
    ...rebaseline((prev?.ai_rating as string | null) ?? null, now),
    ...rankResetFor(prev, overrideRating ?? ((prev?.ai_rating as string | null) ?? null)),
  }
  // override_* + review_* ONLY — never touches the ai_* columns.
  const { error } = await sb
    .from(HEALTH_TABLE)
    .upsert({ account_id: accountId, ...patch }, { onConflict: "account_id" })
  if (error) return fail(describeError(error))

  const wasFlagged = prev?.review_suggested === true
  const modeChanged = prev && prev.override_mode !== mode
  await recordAudit({
    action: prev ? "update" : "create",
    entity: HEALTH_TABLE,
    recordId: accountId,
    changes: prev ? diffRows(prev, patch) : { account_id: accountId, ...patch },
    context: `${PATH} · ${wasFlagged ? "Needs review · Update" : modeChanged ? `Override · ${mode === "pin" ? "Pin" : "Prefer"}` : "Override"}`,
  })

  revalidatePath(PATH)
  return ok()
}

/** "Keep" a flagged override as-is: clears the flag and re-baselines. */
export async function keepHealthOverride(accountId: string): Promise<ActionResult> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("reviewing client health")
  if (!gate.ok) return fail(gate.error)
  if (!isUuid(accountId)) return fail("Unknown client.")

  const sb = getSupabaseServer()
  const { data: before, error: readErr } = await sb
    .from(HEALTH_TABLE)
    .select(OVERRIDE_COLS)
    .eq("account_id", accountId)
    .maybeSingle()
  if (readErr) return fail(describeError(readErr))
  const prev = before as Record<string, unknown> | null
  if (!prev || (prev.override_rating === null && prev.override_note === null)) {
    return fail("There is no override to keep.")
  }
  if (prev.review_suggested !== true) return fail("This client is not flagged for review.")

  const patch = rebaseline((prev.ai_rating as string | null) ?? null, new Date().toISOString())
  const { error } = await sb.from(HEALTH_TABLE).update(patch).eq("account_id", accountId)
  if (error) return fail(describeError(error))

  await recordAudit({
    action: "update",
    entity: HEALTH_TABLE,
    recordId: accountId,
    changes: diffRows(prev, patch),
    context: `${PATH} · Needs review · Keep`,
  })

  revalidatePath(PATH)
  return ok()
}

/** Clear the override (and any review state) so the AI rating / note show again. */
export async function revertHealthOverride(accountId: string): Promise<ActionResult> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("overriding client health")
  if (!gate.ok) return fail(gate.error)
  if (!isUuid(accountId)) return fail("Unknown client.")

  const sb = getSupabaseServer()
  const { data: before, error: readErr } = await sb
    .from(HEALTH_TABLE)
    .select(OVERRIDE_COLS)
    .eq("account_id", accountId)
    .maybeSingle()
  if (readErr) return fail(describeError(readErr))
  if (!before) return fail("There is no override to revert.")
  const prev = before as Record<string, unknown>

  const patch = {
    override_rating: null,
    override_note: null,
    overridden_by: null,
    overridden_at: null,
    override_mode: "prefer",
    override_reviewed_at: null,
    review_baseline_ai_rating: null,
    review_suggested: false,
    review_reason: null,
    review_flagged_at: null,
    ...rankResetFor(prev, (prev.ai_rating as string | null) ?? null),
  }
  const { error } = await sb.from(HEALTH_TABLE).update(patch).eq("account_id", accountId)
  if (error) return fail(describeError(error))

  await recordAudit({
    action: "update",
    entity: HEALTH_TABLE,
    recordId: accountId,
    changes: diffRows(prev, patch),
    context: `${PATH} · ${prev.review_suggested === true ? "Needs review · " : ""}Revert to AI`,
  })

  revalidatePath(PATH)
  return ok()
}

/**
 * Firm order: save a new manual order for ONE category, after a super-user
 * drags `movedId` within it. `orderedIds` is the category's full new order;
 * the server re-derives the category's current members (active clients whose
 * EFFECTIVE rating is `category`) and rejects the request if the two sets
 * differ (stale page, or an attempt to drag across categories). Then it
 * renumbers the whole category 1..n — categories are small, and a full
 * renumber avoids fractional-rank drift. One audit row: the moved client,
 * old → new position.
 */
export async function reorderHealthCategory(
  category: string,
  orderedIds: string[],
  movedId: string,
): Promise<ActionResult> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("reordering client health")
  if (!gate.ok) return fail(gate.error)
  if (!isFirmCategory(category)) return fail("Unknown category.")
  if (!Array.isArray(orderedIds) || orderedIds.length === 0 || !orderedIds.every(isUuid)) {
    return fail("Invalid order.")
  }
  if (new Set(orderedIds).size !== orderedIds.length) return fail("Invalid order.")
  if (!isUuid(movedId) || !orderedIds.includes(movedId)) return fail("Invalid order.")

  const sb = getSupabaseServer()
  const [clientsRes, healthRes] = await Promise.all([
    sb.from("v_client_detail_summary").select("account_id, client_name"),
    sb.from(HEALTH_TABLE).select("account_id, ai_rating, override_rating, manual_rank"),
  ])
  const readErr = clientsRes.error ?? healthRes.error
  if (readErr) return fail(describeError(readErr))

  const health = new Map(
    ((healthRes.data ?? []) as Record<string, unknown>[]).map((h) => [h.account_id as string, h]),
  )
  // The category's CURRENT members, in their current firm order.
  const members = ((clientsRes.data ?? []) as { account_id: string; client_name: string }[])
    .map((c) => {
      const h = health.get(c.account_id)
      return {
        id: c.account_id,
        clientName: c.client_name,
        effectiveRating: ((h?.override_rating ?? h?.ai_rating) as string | null) ?? null,
        manualRank: (h?.manual_rank as number | null) ?? null,
      }
    })
    .filter((m) => categoryOf(m.effectiveRating) === category)
    .sort(compareFirmOrder)

  const current = new Set(members.map((m) => m.id))
  if (current.size !== orderedIds.length || !orderedIds.every((id) => current.has(id))) {
    return fail("This category changed since the page loaded — refresh and try again.")
  }

  const oldPos = members.findIndex((m) => m.id === movedId) + 1
  const newPos = orderedIds.indexOf(movedId) + 1
  const oldRank = members.find((m) => m.id === movedId)?.manualRank ?? null

  // Renumber 1..n, writing only rows whose rank actually changes. Every member
  // is rated, so it already has a row; manual_rank is the only column named.
  const rankOf = new Map(members.map((m) => [m.id, m.manualRank]))
  const updates = orderedIds
    .map((id, i) => ({ account_id: id, manual_rank: i + 1 }))
    .filter((u) => rankOf.get(u.account_id) !== u.manual_rank)
  if (updates.length > 0) {
    const { error } = await sb.from(HEALTH_TABLE).upsert(updates, { onConflict: "account_id" })
    if (error) return fail(describeError(error))
  }

  await recordAudit({
    action: "update",
    entity: HEALTH_TABLE,
    recordId: movedId,
    changes: diffRows({ manual_rank: oldRank }, { manual_rank: newPos }),
    context: `${PATH} · Firm order · ${FIRM_CATEGORY_LABEL[category]}: moved #${oldPos} → #${newPos}`,
  })

  revalidatePath(PATH)
  return ok()
}

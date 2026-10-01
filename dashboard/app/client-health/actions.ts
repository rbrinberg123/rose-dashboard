"use server"

/**
 * Clients → Client Health — the ONLY writer of the override_* columns of
 * public.client_health_assessments. (The ai_* columns are written only by
 * lib/client-health.ts via /api/client-health/refresh.)
 *
 * Gate: requireCrmWriter — effective super_user AND not in "View as". Every
 * save / revert is audited.
 */

import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { diffRows, recordAudit } from "@/lib/audit"
import { cleanText, isUuid, requireCrmWriter } from "@/lib/crm-write"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { isHealthRating } from "@/lib/client-health-prompt"
import { HEALTH_TABLE } from "@/lib/client-health"

const PATH = "/client-health"
const OVERRIDE_COLS = "account_id, override_rating, override_note, overridden_by, overridden_at"

/** The client must be ACTIVE — never accept an arbitrary id from the browser. */
async function isActiveClient(accountId: string): Promise<boolean> {
  const { data } = await getSupabaseServer()
    .from("v_client_detail_summary")
    .select("account_id")
    .eq("account_id", accountId)
    .maybeSingle()
  return Boolean(data)
}

/** Save an override. Either field may be blank (keeps the AI value for it). */
export async function saveHealthOverride(
  accountId: string,
  rating: string | null,
  note: string | null,
): Promise<ActionResult> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("overriding client health")
  if (!gate.ok) return fail(gate.error)
  if (!isUuid(accountId)) return fail("Unknown client.")

  const overrideRating = rating ? rating.trim() : null
  if (overrideRating !== null && !isHealthRating(overrideRating)) return fail("Invalid rating.")
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

  const patch = {
    override_rating: overrideRating,
    override_note: overrideNote,
    overridden_by: gate.userId,
    overridden_at: new Date().toISOString(),
  }
  // override_* ONLY — never touches the ai_* columns.
  const { error } = await sb
    .from(HEALTH_TABLE)
    .upsert({ account_id: accountId, ...patch }, { onConflict: "account_id" })
  if (error) return fail(describeError(error))

  await recordAudit({
    action: before ? "update" : "create",
    entity: HEALTH_TABLE,
    recordId: accountId,
    changes: before ? diffRows(before as Record<string, unknown>, patch) : { account_id: accountId, ...patch },
    context: `${PATH} · Override`,
  })

  revalidatePath(PATH)
  return ok()
}

/** Clear the override so the AI rating / note show again. */
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

  const patch = { override_rating: null, override_note: null, overridden_by: null, overridden_at: null }
  const { error } = await sb.from(HEALTH_TABLE).update(patch).eq("account_id", accountId)
  if (error) return fail(describeError(error))

  await recordAudit({
    action: "update",
    entity: HEALTH_TABLE,
    recordId: accountId,
    changes: diffRows(before as Record<string, unknown>, patch),
    context: `${PATH} · Revert to AI`,
  })

  revalidatePath(PATH)
  return ok()
}

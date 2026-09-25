"use server"

/**
 * Admin → Time Off Reviewers — the ONLY writer of public.time_off_reviewers
 * (who is on each person's reviewing team).
 *
 * Gate: requireCrmWriter — effective super_user AND not in "View as" (a
 * super-user previewing as someone else must not change approval powers).
 * Every add / remove is audited. Removing a reviewer takes effect at once: the
 * approve action re-reads this table on every call.
 */

import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import { isUuid, requireCrmWriter } from "@/lib/crm-write"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"

const TABLE = "time_off_reviewers"
const PATH = "/admin/time-off-reviewers"

function revalidateAll() {
  revalidatePath(PATH)
  revalidatePath("/time-off-requests")
  revalidatePath("/clients/alerts")
}

/** Add one reviewer to one person's reviewing team. */
export async function addTimeOffReviewer(
  personUserId: string,
  reviewerUserId: string,
): Promise<ActionResult<{ id: string }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("changing reviewing teams")
  if (!gate.ok) return fail(gate.error)
  if (!isUuid(personUserId) || !isUuid(reviewerUserId)) return fail("Unknown person.")
  if (personUserId === reviewerUserId) return fail("Nobody can review their own time off.")

  const sb = getSupabaseServer()
  // Both must be real, ACTIVE people — never trust ids from the browser.
  const { data: users, error: uErr } = await sb
    .from("users")
    .select("user_id, display_name, is_active")
    .in("user_id", [personUserId, reviewerUserId])
  if (uErr) return fail(describeError(uErr))
  const byId = new Map(
    ((users ?? []) as { user_id: string; display_name: string | null; is_active: boolean }[]).map((u) => [
      u.user_id,
      u,
    ]),
  )
  const person = byId.get(personUserId)
  const reviewer = byId.get(reviewerUserId)
  if (!person) return fail("That person no longer exists.")
  if (!reviewer || !reviewer.is_active) return fail("The reviewer must be an active user.")

  const { data, error } = await sb
    .from(TABLE)
    .insert({ person_user_id: personUserId, reviewer_user_id: reviewerUserId })
    .select("id")
    .single()
  if (error) {
    if (error.code === "23505") return fail(`${reviewer.display_name ?? "They"} already review this person.`)
    return fail(describeError(error))
  }
  const id = (data as { id: string }).id

  await recordAudit({
    action: "create",
    entity: TABLE,
    recordId: id,
    changes: {
      person_user_id: personUserId,
      person_name: person.display_name,
      reviewer_user_id: reviewerUserId,
      reviewer_name: reviewer.display_name,
    },
    context: `${PATH} · Add reviewer`,
  })

  revalidateAll()
  return ok({ id })
}

/** Remove one reviewer mapping row. */
export async function removeTimeOffReviewer(id: string): Promise<ActionResult> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("changing reviewing teams")
  if (!gate.ok) return fail(gate.error)
  if (!isUuid(id)) return fail("Unknown assignment.")

  const sb = getSupabaseServer()
  const { data: deleted, error } = await sb
    .from(TABLE)
    .delete()
    .eq("id", id)
    .select("id, person_user_id, reviewer_user_id")
  if (error) return fail(describeError(error))
  if (!deleted || deleted.length !== 1) return fail("That assignment no longer exists.")
  const row = deleted[0] as { id: string; person_user_id: string; reviewer_user_id: string }

  // Names for a readable trail (best-effort).
  const { data: users } = await sb
    .from("users")
    .select("user_id, display_name")
    .in("user_id", [row.person_user_id, row.reviewer_user_id])
  const name = (uid: string) =>
    ((users ?? []) as { user_id: string; display_name: string | null }[]).find((u) => u.user_id === uid)
      ?.display_name ?? null

  await recordAudit({
    action: "delete",
    entity: TABLE,
    recordId: id,
    changes: {
      person_user_id: row.person_user_id,
      person_name: name(row.person_user_id),
      reviewer_user_id: row.reviewer_user_id,
      reviewer_name: name(row.reviewer_user_id),
    },
    context: `${PATH} · Remove reviewer`,
  })

  revalidateAll()
  return ok()
}

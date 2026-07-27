"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import type { ReconcileResult } from "@/lib/sync/reconcile"

const PATH = "/admin/reconciliation"

/**
 * "Run sweep now" — triggers the reconciliation route on demand.
 *
 * Identical shape to triggerSync in admin/sync/actions.ts: it runs server-side
 * (the page is behind the auth proxy, super-user only) and POSTs to
 * /api/reconcile-dynamics with `Authorization: Bearer ${CRON_SECRET}` — the same
 * header Vercel Cron uses — so the secret stays on the server.
 */
export async function triggerReconcile(): Promise<ActionResult<ReconcileResult>> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return fail("CRON_SECRET is not configured on the server.")
  }

  const h = await headers()
  const host = h.get("host")
  if (!host) return fail("Could not determine request host.")
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")

  try {
    const res = await fetch(`${proto}://${host}/api/reconcile-dynamics`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    })

    const body = (await res.json().catch(() => null)) as
      | (ReconcileResult & { error?: string })
      | { error?: string }
      | null

    if (!res.ok && res.status !== 207) {
      return fail(body?.error ?? `Reconcile route returned ${res.status}`)
    }

    revalidatePath(PATH)
    return ok(body as ReconcileResult)
  } catch (err) {
    return fail(describeError({ message: err instanceof Error ? err.message : String(err) }))
  }
}

/** The signed-in super-user's email, for the resolved_by audit column. */
async function currentEmail(): Promise<string | null> {
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.email ?? null
}

/**
 * Approve a deletion: hard-DELETE the orphan mirror row (the mirror is a
 * rebuildable copy of Dynamics), then mark the candidate resolved. Only acts on
 * candidates still `pending` so a double-click can't delete twice.
 */
async function deleteOne(
  sb: ReturnType<typeof getSupabaseServer>,
  id: number,
  email: string | null,
): Promise<ActionResult> {
  const { data: cand, error: readErr } = await sb
    .from("deletion_candidates")
    .select("id, table_name, pk_column, pk_value, status")
    .eq("id", id)
    .maybeSingle()
  if (readErr) return fail(describeError(readErr))
  if (!cand) return fail("Candidate not found.")
  if (cand.status !== "pending") return ok() // already resolved — no-op

  // Hard-delete the mirror row. table_name / pk_column are populated by the
  // sweep from our own entity config, never from user input.
  const { error: delErr } = await sb
    .from(cand.table_name as string)
    .delete()
    .eq(cand.pk_column as string, cand.pk_value as string)
  if (delErr) return fail(describeError(delErr))

  const { error: updErr } = await sb
    .from("deletion_candidates")
    .update({ status: "deleted", resolved_at: new Date().toISOString(), resolved_by: email })
    .eq("id", id)
  if (updErr) return fail(describeError(updErr))

  return ok()
}

export async function deleteCandidate(id: number): Promise<ActionResult> {
  const sb = getSupabaseServer()
  const email = await currentEmail()
  const result = await deleteOne(sb, id, email)
  revalidatePath(PATH)
  return result
}

export async function dismissCandidate(id: number): Promise<ActionResult> {
  const sb = getSupabaseServer()
  const email = await currentEmail()
  const { error } = await sb
    .from("deletion_candidates")
    .update({ status: "dismissed", resolved_at: new Date().toISOString(), resolved_by: email })
    .eq("id", id)
    .eq("status", "pending")
  revalidatePath(PATH)
  if (error) return fail(describeError(error))
  return ok()
}

/** Bulk approve. Returns the count deleted plus the first error (if any). */
export async function deleteCandidates(ids: number[]): Promise<ActionResult<{ deleted: number }>> {
  const sb = getSupabaseServer()
  const email = await currentEmail()
  let deleted = 0
  let firstError: string | null = null
  for (const id of ids) {
    const r = await deleteOne(sb, id, email)
    if (r.ok) deleted++
    else if (!firstError) firstError = r.error
  }
  revalidatePath(PATH)
  if (firstError && deleted === 0) return fail(firstError)
  return ok({ deleted })
}

/** Bulk keep. */
export async function dismissCandidates(ids: number[]): Promise<ActionResult<{ dismissed: number }>> {
  const sb = getSupabaseServer()
  const email = await currentEmail()
  const { error, count } = await sb
    .from("deletion_candidates")
    .update({ status: "dismissed", resolved_at: new Date().toISOString(), resolved_by: email }, { count: "exact" })
    .in("id", ids)
    .eq("status", "pending")
  revalidatePath(PATH)
  if (error) return fail(describeError(error))
  return ok({ dismissed: count ?? 0 })
}

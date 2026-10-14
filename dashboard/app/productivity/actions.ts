"use server"

import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { requireStrictSuperUser } from "@/lib/api-auth"
import { recordAudit } from "@/lib/audit"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Every Productivity page reads the exclusions — refresh them all. */
const PRODUCTIVITY_PATHS = ["/productivity", "/people-statistics", "/productivity-detail", "/capacity"]

/**
 * Hide (hidden = true) or show (false) ONE person in the per-person
 * Productivity breakdowns (public.productivity_hidden_people). Their numbers
 * stay in every total via the "Former / Excluded" rollup — see
 * lib/productivity-exclusions.ts.
 *
 *   - Strict super user only, on the REAL role (requireStrictSuperUser).
 *   - Stored under the CANONICAL id (user_id_aliases), so a merged person is
 *     hidden as one.
 *   - Audited: create on hide, delete (with who/when it was hidden) on show.
 *   - Idempotent.
 */
export async function setProductivityHidden(userId: string, hidden: boolean): Promise<ActionResult> {
  const auth = await requireStrictSuperUser()
  if (!auth.ok) return fail("Not authorized — only a super user can manage Productivity exclusions.")

  const raw = String(userId ?? "").trim()
  if (!UUID.test(raw)) return fail("Invalid person id.")

  const sb = getSupabaseServer()
  const tableHint = "Run sql/patches/2026-10-14b_productivity_hidden_people.sql in Supabase first."
  const missingTable = (e: { code?: string; message: string }) =>
    e.code === "42P01" || /does not exist/i.test(e.message)

  const { data: alias } = await sb
    .from("user_id_aliases")
    .select("canonical_user_id")
    .eq("alias_user_id", raw)
    .maybeSingle()
  const canonical = (alias as { canonical_user_id: string } | null)?.canonical_user_id ?? raw

  const { data: prior, error: readError } = await sb
    .from("productivity_hidden_people")
    .select("user_id, hidden_by, hidden_at")
    .eq("user_id", canonical)
    .maybeSingle()
  if (readError) return fail(missingTable(readError) ? tableHint : describeError(readError))

  if (!hidden) {
    if (!prior) return ok()
    const { error } = await sb.from("productivity_hidden_people").delete().eq("user_id", canonical)
    if (error) return fail(describeError(error))
    await recordAudit({
      action: "delete",
      entity: "productivity_hidden_people",
      recordId: canonical,
      changes: prior,
      context: "/productivity · Excluded people",
    })
  } else {
    if (prior) return ok()
    const row = { user_id: canonical, hidden_by: auth.email, hidden_at: new Date().toISOString() }
    const { error } = await sb.from("productivity_hidden_people").insert(row)
    if (error) return fail(missingTable(error) ? tableHint : describeError(error))
    await recordAudit({
      action: "create",
      entity: "productivity_hidden_people",
      recordId: canonical,
      changes: row,
      context: "/productivity · Excluded people",
    })
  }

  for (const p of PRODUCTIVITY_PATHS) revalidatePath(p)
  return ok()
}

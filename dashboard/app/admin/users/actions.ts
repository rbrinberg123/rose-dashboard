"use server"

import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { requireSuperUser } from "@/lib/api-auth"

const PATH = "/admin/users"

/**
 * The roles that may be assigned in public.user_role_grants — the four live
 * roles (matching the `Role` type in lib/access-control.ts). This is now the
 * LIVE role source: getRealRole reads this table, so a change here changes what
 * the person can access on their next page load.
 *
 * NB the user_role_grants CHECK constraint must permit each of these values;
 * "client_manager" was added alongside a constraint update (see docs).
 */
const STAGED_ROLES = ["user", "client_manager", "logistics", "super_user"] as const
export type StagedRole = (typeof STAGED_ROLES)[number]

/** "None" is represented by the ABSENCE of a row — passed from the client as null. */
export type RoleSelection = StagedRole | null

/**
 * Set the live role for one @roseandco.com user in public.user_role_grants.
 *
 *   - Super-user gated (mirrors admin/sync + reconciliation: reuses the same
 *     requireSuperUser guard the API routes use).
 *   - Validates the @roseandco.com domain server-side — never trust the client.
 *   - role === null → DELETE the row ("None").
 *   - otherwise UPSERT (email is the PRIMARY KEY), stamping updated_by/at.
 *   - revalidatePath so the roster reflects the new state on the next render.
 */
export async function setUserRole(
  email: string,
  role: RoleSelection,
): Promise<ActionResult> {
  const auth = await requireSuperUser()
  if (!auth.ok) return fail("Not authorized.")

  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail.endsWith("@roseandco.com")) {
    return fail("Only @roseandco.com users can be granted a role here.")
  }

  if (role !== null && !STAGED_ROLES.includes(role)) {
    return fail(`Invalid role: ${role}`)
  }

  const sb = getSupabaseServer()

  if (role === null) {
    // "None" — remove any staged grant for this user.
    const { error } = await sb.from("user_role_grants").delete().eq("email", normalizedEmail)
    if (error) return fail(describeError(error))
    revalidatePath(PATH)
    return ok()
  }

  const { error } = await sb
    .from("user_role_grants")
    .upsert(
      {
        email: normalizedEmail,
        role,
        updated_at: new Date().toISOString(),
        updated_by: auth.email,
      },
      { onConflict: "email" },
    )
  if (error) return fail(describeError(error))

  revalidatePath(PATH)
  return ok()
}

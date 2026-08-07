"use server"

import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { requireSuperUser } from "@/lib/api-auth"
import { isRegisteredRoute, type AssignableRole } from "@/lib/page-registry"

const PATH = "/admin/roles"

/**
 * Roles whose page access is editable in public.role_page_access. Deliberately
 * excludes "super_user" — super always sees everything (a hard backstop in
 * canAccessRoute), so its column is locked on in the UI and never written here.
 *
 * This table is now LIVE: getAllowedRoutes/canAccessRoute read it to gate the
 * proxy, nav, and API guards. A toggle here changes what the role can access on
 * the next page load (see docs 01-access-and-users.md).
 */
const EDITABLE_ROLES: AssignableRole[] = ["user", "client_manager", "logistics"]

/**
 * Stage whether `role` may access `route` in public.role_page_access.
 *
 *   - Super-user gated (reuses requireSuperUser, like the other admin actions).
 *   - Validates the role is editable (never "super_user") and the route is a
 *     real registered page — never trust the client.
 *   - UPSERTs one (role, route) row (the composite PRIMARY KEY) with `allowed`.
 *   - revalidatePath so the matrix reflects the new state on the next render.
 */
export async function setRolePageAccess(
  role: string,
  route: string,
  allowed: boolean,
): Promise<ActionResult> {
  const auth = await requireSuperUser()
  if (!auth.ok) return fail("Not authorized.")

  if (!EDITABLE_ROLES.includes(role as AssignableRole)) {
    return fail(`Role is not editable here: ${role}`)
  }
  if (!isRegisteredRoute(route)) {
    return fail(`Unknown page route: ${route}`)
  }

  const sb = getSupabaseServer()
  const { error } = await sb
    .from("role_page_access")
    .upsert({ role, route, allowed }, { onConflict: "role,route" })
  if (error) return fail(describeError(error))

  revalidatePath(PATH)
  return ok()
}

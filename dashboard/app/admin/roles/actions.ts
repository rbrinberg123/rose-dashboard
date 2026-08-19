"use server"

import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { requireSuperUser } from "@/lib/api-auth"
import {
  isDataPermissionKey,
  isRegisteredRoute,
  type AssignableRole,
} from "@/lib/page-registry"

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

/**
 * Set whether `role` holds a field-level DATA permission (today: Financials).
 *
 * Stored in the SAME public.role_page_access table as page access, under the
 * permission's `data:`-prefixed key in the `route` column — so it persists,
 * revalidates, and is super-user-gated exactly like a page toggle. It is a
 * separate action from setRolePageAccess so neither can be used to write the
 * other's key space: this one accepts ONLY registered data-permission keys, and
 * setRolePageAccess accepts ONLY registered page routes.
 *
 * super_user is never written here either — canSeeFinancials grants a super
 * unconditionally (the same lockout guard row scoping uses).
 */
export async function setRoleDataPermission(
  role: string,
  key: string,
  allowed: boolean,
): Promise<ActionResult> {
  const auth = await requireSuperUser()
  if (!auth.ok) return fail("Not authorized.")

  if (!EDITABLE_ROLES.includes(role as AssignableRole)) {
    return fail(`Role is not editable here: ${role}`)
  }
  if (!isDataPermissionKey(key)) {
    return fail(`Unknown data permission: ${key}`)
  }

  const sb = getSupabaseServer()
  const { error } = await sb
    .from("role_page_access")
    .upsert({ role, route: key, allowed }, { onConflict: "role,route" })
  if (error) return fail(describeError(error))

  revalidatePath(PATH)
  return ok()
}

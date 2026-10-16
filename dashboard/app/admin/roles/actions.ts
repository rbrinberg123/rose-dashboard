"use server"

import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { requireStrictSuperUser } from "@/lib/api-auth"
import { diffRows, recordAudit } from "@/lib/audit"
import {
  isDataPermissionKey,
  isRegisteredRoute,
  type AssignableRole,
} from "@/lib/page-registry"

import { CRM_LEVEL_LABELS, isCrmLevel, isCrmLevelRoute } from "@/lib/access/crm-levels-policy"

const PATH = "/admin/roles"

/**
 * Roles whose page access is editable in public.role_page_access. Deliberately
 * excludes "super_user" — super always sees everything (a hard backstop in
 * canAccessRoute), so its column is locked on in the UI and never written here —
 * and "admin", whose page set is code-defined the same way (canAccessRoute minus
 * ADMIN_EXCLUDED_ROUTES, lib/access-control.ts); its column is locked too.
 *
 * This table is now LIVE: getAllowedRoutes/canAccessRoute read it to gate the
 * proxy, nav, and API guards. A toggle here changes what the role can access on
 * the next page load (see docs 01-access-and-users.md).
 */
const EDITABLE_ROLES: AssignableRole[] = [
  "user",
  "associate",
  "client_manager",
  "logistics",
]

/**
 * Stage whether `role` may access `route` in public.role_page_access.
 *
 *   - Super-user gated (reuses requireStrictSuperUser, like the other admin actions).
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
  const auth = await requireStrictSuperUser()
  if (!auth.ok) return fail("Not authorized — only a super user can manage users and roles.")

  if (!EDITABLE_ROLES.includes(role as AssignableRole)) {
    return fail(`Role is not editable here: ${role}`)
  }
  if (!isRegisteredRoute(route)) {
    return fail(`Unknown page route: ${route}`)
  }
  // The four CRM tables carry a LEVEL (2026-10-16) — set them with
  // setRoleCrmLevel so allowed and crm_level can never disagree.
  if (isCrmLevelRoute(route)) return fail("This page has an access level — set it from the level dropdown.")

  const sb = getSupabaseServer()

  // Prior grant, for the audit diff. role_page_access records NO actor and no
  // timestamp of its own, so before this the only evidence a permission had
  // ever changed was the permission itself.
  const { data: before } = await sb
    .from("role_page_access")
    .select("allowed")
    .eq("role", role)
    .eq("route", route)
    .maybeSingle()

  const { error } = await sb
    .from("role_page_access")
    .upsert({ role, route, allowed }, { onConflict: "role,route" })
  if (error) return fail(describeError(error))

  // AUDIT — see lib/audit.ts. This is a PERMISSION change, so it is among the
  // most important things the trail carries. Composite record id: the table's
  // key is (role, route), not a surrogate id.
  await recordAudit({
    action: before ? "update" : "create",
    entity: "role_page_access",
    recordId: `role:${role}|route:${route}`,
    changes: before ? diffRows(before, { allowed }) : { role, route, allowed },
    context: PATH,
  })

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
  const auth = await requireStrictSuperUser()
  if (!auth.ok) return fail("Not authorized — only a super user can manage users and roles.")

  if (!EDITABLE_ROLES.includes(role as AssignableRole)) {
    return fail(`Role is not editable here: ${role}`)
  }
  if (!isDataPermissionKey(key)) {
    return fail(`Unknown data permission: ${key}`)
  }

  const sb = getSupabaseServer()

  const { data: before } = await sb
    .from("role_page_access")
    .select("allowed")
    .eq("role", role)
    .eq("route", key)
    .maybeSingle()

  const { error } = await sb
    .from("role_page_access")
    .upsert({ role, route: key, allowed }, { onConflict: "role,route" })
  if (error) return fail(describeError(error))

  // AUDIT — logged under its own entity name even though it shares the
  // role_page_access TABLE with page grants: a data permission and a page grant
  // are different decisions and the trail should not conflate them.
  await recordAudit({
    action: before ? "update" : "create",
    entity: "role_data_permission",
    recordId: `role:${role}|key:${key}`,
    changes: before ? diffRows(before, { allowed }) : { role, key, allowed },
    context: PATH,
  })

  revalidatePath(PATH)
  return ok()
}

/**
 * Set a role's CRM ACCESS LEVEL (2026-10-16) on one of the four level-gated
 * CRM tables — None / View / Edit / Manage (lib/access/crm-levels-policy.ts).
 * Writes the same role_page_access row as the page grant: allowed = level is
 * not None (so nav / list / drawer behave exactly as the old checkbox), and
 * crm_level = the level. Strict super user only, audited like every grant.
 */
export async function setRoleCrmLevel(role: string, route: string, level: string): Promise<ActionResult> {
  const auth = await requireStrictSuperUser()
  if (!auth.ok) return fail("Not authorized — only a super user can manage users and roles.")
  if (!EDITABLE_ROLES.includes(role as AssignableRole)) return fail(`Role is not editable here: ${role}`)
  if (!isCrmLevelRoute(route)) return fail(`That page has no access level: ${route}`)
  if (!isCrmLevel(level)) return fail(`Unknown access level: ${String(level)}`)

  const sb = getSupabaseServer()
  const { data: before } = await sb
    .from("role_page_access")
    .select("*")
    .eq("role", role)
    .eq("route", route)
    .maybeSingle()

  const row = { role, route, allowed: level !== "none", crm_level: level }
  let { error } = await sb.from("role_page_access").upsert(row, { onConflict: "role,route" })
  // Before sql/patches/2026-10-16b_crm_access_levels.sql runs there is no
  // crm_level column: None / View still save (they are just the view bit).
  if (error && /crm_level/.test(error.message)) {
    if (level === "edit" || level === "manage") {
      return fail(`“${CRM_LEVEL_LABELS[level]}” needs the 2026-10-16b CRM access-levels SQL patch run first.`)
    }
    ;({ error } = await sb
      .from("role_page_access")
      .upsert({ role, route, allowed: level !== "none" }, { onConflict: "role,route" }))
  }
  if (error) return fail(describeError(error))

  const prior = before
    ? { allowed: (before as { allowed?: boolean }).allowed ?? false, crm_level: (before as { crm_level?: string | null }).crm_level ?? null }
    : null
  await recordAudit({
    action: prior ? "update" : "create",
    entity: "role_page_access",
    recordId: `role:${role}|route:${route}`,
    changes: prior ? diffRows(prior, { allowed: row.allowed, crm_level: level }) : row,
    context: PATH + " · crm level",
  })
  revalidatePath(PATH)
  return ok()
}

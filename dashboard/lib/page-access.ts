import { getSupabaseServer } from "@/lib/supabase"
import { PAGE_REGISTRY } from "@/lib/page-registry"
import { hasSuperUserPrivileges, isGrantableRoute, isHiddenRoute, type Role } from "@/lib/access-control"
import {
  CRM_LEVEL_ROUTES,
  isCrmLevelRoute,
  levelFromGrantRow,
  levelFromRoleRow,
  maxLevel,
  type CrmLevel,
  type CrmLevelRoute,
} from "@/lib/access/crm-levels-policy"

/**
 * Load the routes a person is allowed to reach: their ROLE's routes from
 * public.role_page_access (the Admin → Roles matrix) UNION their own grantable
 * per-user grants from public.user_page_grants (Admin → Users → Pages).
 * Returns only allowed routes, ORDERED by PAGE_REGISTRY so the first entry is a
 * natural landing page.
 *
 * `email` is REQUIRED (pass null when there is no person — e.g. a View-as ROLE
 * preview, which shows role pages only). It is required so the compiler flags
 * every call site; a caller that passes null merely under-grants.
 *
 * Call this ONCE per request and hand the result to canAccessRoute() — the nav
 * checks many routes against the same set, so this is two small parallel
 * queries, not one per link.
 *
 * No next/headers import, so proxy.ts can call it directly. It FAILS CLOSED:
 * an error reading the role matrix returns [] — a missing matrix denies access
 * rather than leaking it — and an error reading user_page_grants (including the
 * table not existing yet) contributes no grants. super_user is never gated by
 * the matrix (see the canAccessRoute backstop), so this short-circuits to []
 * for supers (and admins) and skips both queries; it also returns [] for a
 * role-less person (canAccessRoute denies them before reading the list).
 */
export async function getAllowedRoutes(role: Role | null, email: string | null): Promise<string[]> {
  // admin is code-defined too (canAccessRoute + ADMIN_EXCLUDED_ROUTES), never
  // matrix-gated, so it skips the query like super_user.
  if (!role || hasSuperUserPrivileges(role)) return []
  try {
    const sb = getSupabaseServer()
    const personEmail = email?.trim().toLowerCase() || null
    const [roleRes, grantRes] = await Promise.all([
      sb.from("role_page_access").select("route").eq("role", role).eq("allowed", true),
      personEmail
        ? sb.from("user_page_grants").select("route").eq("email", personEmail)
        : Promise.resolve({ data: [] as { route: string }[], error: null }),
    ])
    if (roleRes.error || !roleRes.data) return []
    const granted = new Set((roleRes.data as { route: string }[]).map((r) => r.route))
    // Per-user grants: ignored wholesale on error (fail closed), and row by row
    // unless the route is grantable — a stray row for a strict page is inert.
    if (!grantRes.error && grantRes.data) {
      for (const g of grantRes.data as { route: string }[]) {
        if (isGrantableRoute(g.route, PAGE_REGISTRY)) granted.add(g.route)
      }
    }
    // Order by the registry so allowed[0] is a sensible page to land on, and
    // drop any stale route no longer in the registry.
    // Hidden (retired) pages are never offered — a grant for one is inert while
    // it is hidden, so it must not become someone's landing page.
    return PAGE_REGISTRY.filter((p) => granted.has(p.route) && !isHiddenRoute(p.route)).map((p) => p.route)
  } catch {
    return []
  }
}

/**
 * CRM ACCESS LEVELS (2026-10-16) for the four level-gated CRM tables — see
 * lib/access/crm-levels-policy.ts. Same two tables and the same fold as
 * getAllowedRoutes above: the ROLE's level (role_page_access.crm_level,
 * refined by `allowed`) and the person's own grant (user_page_grants.crm_level),
 * combined RAISE-ONLY (the higher wins).
 *
 * Super user / admin (hasSuperUserPrivileges) → Manage everywhere — the
 * implicit-full rule (see decideCrmWrite). No role → None everywhere.
 * FAILS CLOSED: a read error contributes None for that half (logged).
 * SELECT * so a database without the crm_level column (patch
 * 2026-10-16b not yet run) still reads: every grant is then exactly View.
 */
export async function getCrmLevels(
  role: Role | null,
  email: string | null,
): Promise<Record<CrmLevelRoute, CrmLevel>> {
  const out = Object.fromEntries(CRM_LEVEL_ROUTES.map((r) => [r, "none"])) as Record<CrmLevelRoute, CrmLevel>
  if (!role) return out
  if (hasSuperUserPrivileges(role)) {
    for (const r of CRM_LEVEL_ROUTES) out[r] = "manage"
    return out
  }
  try {
    const sb = getSupabaseServer()
    const personEmail = email?.trim().toLowerCase() || null
    const [roleRes, grantRes] = await Promise.all([
      sb.from("role_page_access").select("*").eq("role", role).in("route", [...CRM_LEVEL_ROUTES]),
      personEmail
        ? sb.from("user_page_grants").select("*").eq("email", personEmail).in("route", [...CRM_LEVEL_ROUTES])
        : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
    ])
    if (roleRes.error) {
      console.error("[crm-levels] role_page_access read failed — role levels denied:", roleRes.error.message)
    } else {
      for (const row of (roleRes.data ?? []) as { route: string; allowed?: boolean | null; crm_level?: string | null }[]) {
        if (isCrmLevelRoute(row.route)) out[row.route] = maxLevel(out[row.route], levelFromRoleRow(row))
      }
    }
    if (grantRes.error) {
      console.error("[crm-levels] user_page_grants read failed — person levels ignored:", grantRes.error.message)
    } else {
      for (const row of (grantRes.data ?? []) as { route: string; crm_level?: string | null }[]) {
        if (isCrmLevelRoute(row.route)) out[row.route] = maxLevel(out[row.route], levelFromGrantRow(row))
      }
    }
  } catch (e) {
    console.error("[crm-levels] read failed — denying:", e)
    for (const r of CRM_LEVEL_ROUTES) out[r] = "none"
  }
  return out
}

import { getSupabaseServer } from "@/lib/supabase"
import { PAGE_REGISTRY } from "@/lib/page-registry"
import { hasSuperUserPrivileges, isGrantableRoute, isHiddenRoute, type Role } from "@/lib/access-control"

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

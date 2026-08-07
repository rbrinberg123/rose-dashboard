import { NextResponse } from "next/server"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { getUserRole } from "@/lib/user-role"
import { canAccessRoute, type Role } from "@/lib/access-control"
import { getAllowedRoutes } from "@/lib/page-access"

/**
 * Auth guard for API route handlers.
 *
 * /api/* is excluded from proxy.ts (the cron routes authenticate with a
 * bearer secret, not a session), so every route is its own security boundary
 * and MUST check auth itself. This verifies a signed-in Supabase session and
 * the caller's role using the SAME getUserRole() lookup the proxy and nav
 * use, so the API can never disagree with page-level access.
 *
 * On failure it returns a ready-to-send response that leaks no data:
 *   - 401 when there is no valid session (signed out)
 *   - 403 when signed in but lacking the required role (plain user / no role)
 * On success it returns the caller's email + role.
 */
export type ApiAuthResult =
  | { ok: true; email: string; role: Role }
  | { ok: false; response: NextResponse }

export async function requireSuperUser(): Promise<ApiAuthResult> {
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  const role = await getUserRole(user.email)
  if (role !== "super_user") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    }
  }

  return { ok: true, email: user.email, role }
}

/**
 * Auth guard for a route serving data behind a specific page. Allows any
 * signed-in caller whose role can access `route`, using the SAME canAccessRoute
 * check + role_page_access matrix as proxy.ts and the nav — so an API can never
 * disagree with page-level access (a role reaches it iff the matrix grants
 * `route`; a super_user always does).
 *
 *   - 401 when there is no valid session (signed out)
 *   - 403 when signed in but the caller's role cannot access `route`
 */
export async function requireRouteAccess(route: string): Promise<ApiAuthResult> {
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  const role = await getUserRole(user.email)
  const allowedRoutes = await getAllowedRoutes(role)
  if (!role || !canAccessRoute(role, route, allowedRoutes)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    }
  }

  return { ok: true, email: user.email, role }
}

/**
 * Role-based access control: config + helpers.
 *
 * SECURITY MODEL — deny-by-default allow-list:
 *   - 'super_user' can reach every route.
 *   - 'user' can reach ONLY the routes in USER_ALLOWED_ROUTES (the Logistics
 *     pages), plus the always-allowed infrastructure routes.
 *   - A signed-in email with NO role (not in the user_roles table) can reach
 *     nothing but the always-allowed routes — which includes the "request
 *     access" landing page.
 *
 * Because this is an allow-list, ANY new page is Super-User-only by default.
 * To let plain users see a new Logistics page, add its route to
 * USER_ALLOWED_ROUTES below — that one line is the only change needed.
 *
 * The REAL enforcement lives in proxy.ts (server-side, runs before render).
 * The nav uses these same helpers to hide links a user can't use, but that
 * is cosmetic — the proxy is the gate.
 */

export type Role = "super_user" | "user"

/**
 * Logistics routes a plain 'user' may access. Matched by URL path segment,
 * so "/feedback" allows "/feedback" and "/feedback/123" but NOT
 * "/feedback-manager" — which is deliberately Super-User-only (the Feedback
 * Report Pipeline isn't ready for plain users yet). The segment match is
 * exactly what keeps "/feedback" from leaking access to "/feedback-manager".
 *
 * Note: the older "/planning" route is intentionally omitted (it is unlinked
 * and superseded by "/planning-v2"); add it here if a user should reach it.
 */
export const USER_ALLOWED_ROUTES = [
  "/scheduler",
  "/client-marketing-status",
  "/planning-v2",
  "/profiles",
  "/feedback",
  "/pipeline",
  "/live-outreach",
  "/time-off",
] as const

/**
 * Routes ANY signed-in user may reach regardless of role — including users
 * with no role yet. Keeps the "no access" landing page reachable so a
 * role-less user has somewhere to land instead of a redirect loop.
 * (/login and /auth/* are handled separately by proxy.ts as public paths.)
 */
export const ALWAYS_ALLOWED_ROUTES = ["/no-access"] as const

/**
 * Where a plain 'user' is sent when they land on a page they cannot access
 * (e.g. the "/" home page, which is Client Statistics, or a restricted URL
 * typed directly). Also their natural post-login home. Must be one of
 * USER_ALLOWED_ROUTES.
 */
export const USER_HOME_ROUTE = "/scheduler"

/** True when `pathname` is `route` or a sub-path of it (segment-aware). */
function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(route + "/")
}

/**
 * Can a user with `role` (or no role, when null) access `pathname`?
 * Single source of truth used by both proxy.ts and the nav.
 */
export function canAccessRoute(role: Role | null, pathname: string): boolean {
  if (ALWAYS_ALLOWED_ROUTES.some((r) => matchesRoute(pathname, r))) return true
  if (role === "super_user") return true
  if (role === "user") {
    return USER_ALLOWED_ROUTES.some((r) => matchesRoute(pathname, r))
  }
  // No role → no access beyond ALWAYS_ALLOWED_ROUTES.
  return false
}

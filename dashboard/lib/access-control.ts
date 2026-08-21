/**
 * Role-based access control: config + helpers.
 *
 * SECURITY MODEL — deny-by-default, DRIVEN BY THE ADMIN UI TABLES:
 *   - A person's role comes from `user_role_grants` (Admin → Users & Roles).
 *   - Which pages a role may reach comes from `role_page_access` (Admin →
 *     Roles matrix): a route is allowed only when that table has an
 *     `allowed = true` row for the role, matched segment-aware.
 *   - 'super_user' is a HARD BACKSTOP — always allowed everything, never gated
 *     by the matrix.
 *   - The always-allowed infrastructure routes (see ALWAYS_ALLOWED_ROUTES) are
 *     reachable by any signed-in user regardless of role.
 *   - A signed-in email with NO grant row → no role → reaches nothing but the
 *     always-allowed routes.
 *
 * Default deny: anything not granted in the matrix is blocked. To open a page
 * to a role, check its box in the Admin → Roles matrix (it writes a
 * `role_page_access` row) — no code change needed.
 *
 * The REAL enforcement lives in proxy.ts (server-side, runs before render).
 * The nav uses `canAccessRoute` with the same allowed-routes set so it can
 * never disagree, but the nav is cosmetic — the proxy is the gate.
 */

/**
 * The role vocabulary. The live source is `user_role_grants`, which carries
 * every value below, so the live roles and the impersonatable roles are the
 * same set — `ViewAsRole` is kept as an alias for the many call sites that use
 * it.
 *
 * ADDING A ROLE: this union, VIEW_AS_ROLE_OPTIONS and isViewAsRole below,
 * AssignableRole/ASSIGNABLE_ROLES/seedDefaultAllowed in lib/page-registry.ts,
 * EDITABLE_ROLES in app/admin/roles/actions.ts, STAGED_ROLES in
 * app/admin/users/actions.ts, RoleValue/ROLE_OPTIONS/ROLE_META in
 * app/admin/users/users-view.tsx — and the user_role_grants CHECK constraint in
 * Supabase. Nothing in canAccessRoute, getAllowedRoutes or proxy.ts enumerates
 * roles, so gating picks a new role up for free: it is denied everywhere until
 * the Roles matrix grants it a page.
 */
export type Role =
  | "super_user"
  | "user"
  | "associate"
  | "client_manager"
  | "logistics"
export type ViewAsRole = Role

/** Name of the httpOnly cookie that carries the impersonated ROLE. */
export const VIEW_AS_COOKIE = "view_as"

/**
 * Name of the httpOnly cookie that carries the impersonated PERSON (a specific
 * @roseandco.com user's email). When set for a real super-user it takes
 * precedence over VIEW_AS_COOKIE — you are viewing the app as that exact
 * person, with THEIR real role. See lib/impersonation.ts.
 */
export const VIEW_AS_USER_COOKIE = "view_as_user"

/** Roles offered in the Admin "View as" dropdown, in display order. */
export const VIEW_AS_ROLE_OPTIONS: readonly { value: ViewAsRole; label: string }[] = [
  { value: "super_user", label: "Super User" },
  { value: "client_manager", label: "Client Manager" },
  { value: "logistics", label: "Logistics" },
  { value: "associate", label: "Associate" },
  { value: "user", label: "User" },
] as const

/** Type guard: is `value` a valid impersonatable role? */
export function isViewAsRole(value: string | null | undefined): value is ViewAsRole {
  return (
    value === "super_user" ||
    value === "user" ||
    value === "associate" ||
    value === "client_manager" ||
    value === "logistics"
  )
}

/** Human label for a role (used by the "Viewing as …" banner). */
export function viewAsLabel(role: ViewAsRole): string {
  return VIEW_AS_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role
}

/**
 * Resolving the EFFECTIVE role/identity the app gates on lives in
 * lib/impersonation.ts (`resolveEffective`) — it must do a DB lookup to read
 * an impersonated PERSON's real role, so it can't be a pure function here. The
 * request-context wrappers `getEffectiveRole()` / `getEffectiveIdentity()` live
 * in lib/effective-identity.ts. This module stays pure (proxy-safe): it only
 * owns the cookie names, the role vocabulary, and `canAccessRoute`.
 */

/**
 * Routes ANY signed-in user may reach regardless of role — including users
 * with no role yet. Keeps the "no access" landing page reachable so a
 * role-less user has somewhere to land instead of a redirect loop.
 * (/login and /auth/* are handled separately by proxy.ts as public paths.)
 */
export const ALWAYS_ALLOWED_ROUTES = ["/no-access"] as const

/** True when `pathname` is `route` or a sub-path of it (segment-aware). */
function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(route + "/")
}

/**
 * Can a `role` reach `pathname`, given `allowedRoutes` — the routes granted to
 * that role in `role_page_access` (load once per request via
 * getAllowedRoutes(); see lib/page-access.ts). Pure and synchronous so the nav
 * (a Client Component) and the proxy share the exact same decision.
 *
 * Order of checks (backstops first):
 *   1. Always-allowed infra routes → yes, for anyone signed in.
 *   2. super_user → yes, everything (never gated by the matrix).
 *   3. No role → no.
 *   4. Otherwise → yes iff the matrix grants a matching route (segment-aware,
 *      so a granted "/client-detail" also allows "/client-detail/123").
 */
export function canAccessRoute(
  role: Role | null,
  pathname: string,
  allowedRoutes: readonly string[],
): boolean {
  if (ALWAYS_ALLOWED_ROUTES.some((r) => matchesRoute(pathname, r))) return true
  if (role === "super_user") return true
  if (!role) return false
  return allowedRoutes.some((r) => matchesRoute(pathname, r))
}

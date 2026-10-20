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
 * Supabase (latest: sql/patches/2026-10-13_admin_role.sql). Nothing in canAccessRoute, getAllowedRoutes or proxy.ts enumerates
 * roles, so gating picks a new role up for free: it is denied everywhere until
 * the Roles matrix grants it a page.
 */
export type Role =
  | "super_user"
  | "admin"
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
  { value: "admin", label: "Admin" },
  { value: "client_manager", label: "Client Manager" },
  { value: "logistics", label: "Logistics" },
  { value: "associate", label: "Associate" },
  { value: "user", label: "User" },
] as const

/** Type guard: is `value` a valid impersonatable role? */
export function isViewAsRole(value: string | null | undefined): value is ViewAsRole {
  return (
    value === "super_user" ||
    value === "admin" ||
    value === "user" ||
    value === "associate" ||
    value === "client_manager" ||
    value === "logistics"
  )
}

/* ---------------------------------------------------------------------------
 * SUPER-USER PRIVILEGES vs STRICT SUPER USER (2026-10-13)
 *
 * `admin` is a near-super-user: it passes every check that used to read
 * `role === "super_user"` EXCEPT a short list of carve-outs. Every such check
 * now goes through one of these two helpers, so the boundary is greppable:
 *
 *   hasSuperUserPrivileges(role)  super_user OR admin. The default for any
 *                                 "may do everything" check — CRM tables, CRM
 *                                 writes, row-scope / financials bypass, client
 *                                 deactivation, sends, feedback / task admin
 *                                 powers, time-off admin, the canAccessRoute
 *                                 backstop (minus ADMIN_EXCLUDED_ROUTES).
 *   isStrictSuperUser(role)       super_user ONLY. The carve-outs: Users & Roles
 *                                 (+ their actions and the matrix), View as
 *                                 (impersonation), the Admin hub's Hidden Pages
 *                                 section and its Users / Roles tiles.
 *
 * Both are PURE — they take a role, not a request. Real vs "View as" is the
 * CALLER's choice, exactly as before: pass getRealRole/getUserRole where the
 * old check read the real role (requireSuperUser*, data-scope, financials,
 * impersonation) and getEffectiveRole where it read the effective one (pages,
 * actions), so a super user viewing as "Admin" sees precisely what an admin
 * sees, and an admin can never start a View as.
 *
 * To move a power across the line, swap the helper at that one call site; to
 * change admin's page set, edit ADMIN_EXCLUDED_ROUTES. See docs
 * 01-access-and-users.md → Admin role.
 * ------------------------------------------------------------------------ */

/** super_user or admin — the "may do (almost) everything" check. */
export function hasSuperUserPrivileges(role: Role | null | undefined): boolean {
  return role === "super_user" || role === "admin"
}

/** super_user only — user/role management, View as, Hidden Pages. */
export function isStrictSuperUser(role: Role | null | undefined): boolean {
  return role === "super_user"
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
export const ALWAYS_ALLOWED_ROUTES = [
  "/no-access",
  // The app root — EXACT "/" only (matchesRoute never treats "/" as a prefix).
  // It renders nothing: app/page.tsx redirects every signed-in user to their
  // home (homeRouteFor → My Dashboard). Always allowed so the proxy lets the
  // redirect run instead of bouncing to a grant-ordered page (2026-10-08).
  "/",
  // My Dashboard — the personal home page, open to every signed-in user
  // (2026-10-08). Safe because loadMyDashboard() scopes every feed to the
  // viewer server-side; the page itself sends a role-less user to /no-access.
  // To make it super-user only again, move this to ADMIN_ONLY_ROUTES.
  "/my-dashboard",
  // CRM -> Time Off requests (2026-10-09) — open to every signed-in user, like
  // My Dashboard, because the page and its drawer action scope every row
  // server-side (lib/time-off-requests/visibility.ts: own ∪ approver-for ∪
  // super-user all). Create / edit / delete stay super-user only. Moved here
  // from ADMIN_ONLY_ROUTES; to make it super-user only again, move it back.
  "/time-off-requests",
] as const

/**
 * Routes ONLY a super_user may reach, NO MATTER WHAT THE ROLES MATRIX SAYS.
 *
 * Everything else in this app is matrix-driven: tick a box in Admin -> Roles and
 * the page opens to that role. These routes are deliberately NOT delegable that
 * way, because they expose data the row-scoping layer would otherwise restrict.
 *
 * (2026-10-16) The four primary CRM LIST pages — Clients (/accounts), Events,
 * Meetings, Contacts — LEFT this list: they are now ordinary grantable pages
 * (Roles matrix + per-user grants, "CRM" section of lib/page-registry.ts). A
 * grant opens the whole list (NO row scoping), its filters / export / saved
 * views and the read-only row drawers (canReadCrmPage, lib/crm-write.ts).
 * Create / edit / delete stay super-user only (requireCrmWriter), and Client
 * Detail keeps its account-team scoping. (2026-10-20) Tasks / Touchpoints /
 * Notes left too, with the same four levels — their ROWS are row-scoped
 * (lib/access/actions-scope.ts), so a grant never shows every row.
 *
 * Checked AFTER the super_user backstop, so a super_user still passes, and
 * BEFORE the matrix lookup, so an accidental (or malicious) role_page_access row
 * granting one of these to another role has no effect.
 */
export const ADMIN_ONLY_ROUTES = [
  // (/meetings, /events, /contacts, /accounts left 2026-10-16 — grantable list pages.)
  // (/tasks, /touchpoints, /notes left 2026-10-20 — grantable, row-scoped.)
  // Admin -> Account Teams. NOT a CRM data table (deliberately absent from
  // CRM_NAV_ITEMS); listed here so the Roles matrix can never delegate it.
  // Adding a NEW route here changes no existing page's behaviour.
  "/admin/account-teams",
  // Admin -> Audit Log. Read-only, but it describes every write in the app —
  // salary edits, permission grants — so it is at least as sensitive as the
  // most sensitive thing in it. Never delegable through the Roles matrix.
  "/admin/audit-log",
  // (/time-off-requests moved to ALWAYS_ALLOWED_ROUTES 2026-10-09 — row-scoped.)
  // Admin -> Contract Management. Every client contract and retainer, read the
  // unscoped way from v_admin_contracts_all, with create/edit/delete. NOT
  // /contract-management, the matrix-grantable reporting page. Admin-section
  // (reached from the Admin hub), not a CRM nav item.
  "/admin/contracts",
  // Admin -> Time Off Reviewers. Decides who may approve whose time off.
  "/admin/time-off-reviewers",
  // Clients -> Client Health. AI retention-risk ratings + notes for every active
  // client, unscoped, built from inputs that include the retainer.
  "/client-health",
  // Logistics -> FB Coming Soon. Work in progress: dashboard Feedback reports
  // still awaiting feedback. THE ONE-LINE VISIBILITY FLAG — to open it to more
  // roles, delete this entry and tick the route in Admin -> Roles.
  "/fb-coming-soon",
  // Admin -> Automations. The catalogue of every automation (lib/automations).
  "/admin/automations",
  // Admin maintenance + user / role management (2026-10-14). Until now these
  // were only in ADMIN_EXCLUDED_ROUTES (which binds the admin role alone), so a
  // stray Roles-matrix tick could have opened them to a normal role. Listed
  // here they can never be delegated — by the matrix OR a per-user page grant.
  "/admin/users",
  "/admin/roles",
  "/admin/sync",
  "/admin/reconciliation",
  "/admin/database",
] as const

/**
 * Routes an `admin` may NOT reach although it otherwise passes the super-user
 * backstop in canAccessRoute. Super users still reach all of them; other roles
 * are unaffected (matrix as usual). Hidden (retired) pages — HIDDEN_PAGE_REGISTRY
 * — are excluded for admin too, without being listed here. Because the nav draws
 * only what canAccessRoute allows, an entry here removes the link as well.
 */
export const ADMIN_EXCLUDED_ROUTES = [
  // User / role management stays super-user only.
  "/admin/users",
  "/admin/roles",
  // Client Statistics and every Productivity page.
  "/client-statistics",
  "/people-statistics",
  "/productivity",
  "/productivity-detail",
  "/capacity",
  // Admin maintenance screens.
  "/admin/sync",
  "/admin/reconciliation",
  "/admin/database",
] as const

/** True when `pathname` is `route` or a sub-path of it (segment-aware). */
function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(route + "/")
}

/* ---------------------------------------------------------------------------
 * HIDDEN (retired) PAGES — take a page out of everyday use WITHOUT deleting it.
 *
 * While an entry has `hidden: true`:
 *   - NAV    — its link is removed from the sidebar, rail fly-outs and section
 *              strip for EVERYONE, super users included (visibleSections in
 *              components/nav.tsx).
 *   - ROUTE  — only super users may open it (canAccessRoute below, enforced by
 *              proxy.ts and the page itself); a Roles-matrix grant no longer
 *              opens it, and getAllowedRoutes (lib/page-access.ts) never offers
 *              it as a landing page.
 *   - ADMIN  — listed under Admin → Hidden Pages with a link super users can open.
 *
 * TO RE-ENABLE: set `hidden: false` (or delete the entry). Nav, route access and
 * the matrix grants come back exactly as they were — the page, its loaders and
 * its views are untouched while hidden.
 *
 * (Different from the "parked" pages also shown in Admin → Hidden Pages —
 * Upcoming Meetings, Relationships, …: those were simply never linked from the
 * nav and stay matrix-gated as usual. See HIDDEN_PAGES in app/admin/page.tsx.)
 * ------------------------------------------------------------------------ */
export type HiddenPage = {
  /** The page route, exactly as in lib/page-registry.ts. */
  route: string
  label: string
  /** true = retired (off the nav, super-user only). false = live as normal. */
  hidden: boolean
  /** Why it is hidden — shown in Admin → Hidden Pages. */
  note: string
}

export const HIDDEN_PAGE_REGISTRY: readonly HiddenPage[] = [
  {
    route: "/clients/alerts",
    label: "Alerts",
    hidden: true,
    note: "Retired 2026-10-08 — superseded by My Dashboard (same feeds, flags and badge).",
  },
  {
    route: "/client-margin",
    label: "Client Margin",
    hidden: true,
    note: "New 2026-10-15, Phase 1 — known client hours (no cost/margin yet). Super user only while in build.",
  },
]

/** Is `pathname` (or a page under it) a currently hidden route? */
export function isHiddenRoute(pathname: string): boolean {
  return HIDDEN_PAGE_REGISTRY.some((p) => p.hidden && matchesRoute(pathname, p.route))
}

/* ---------------------------------------------------------------------------
 * PER-USER PAGE GRANTS (2026-10-14) — which pages may be granted to ONE person
 * on top of their role (public.user_page_grants, Admin → Users → Pages).
 *
 * Effective page access = role pages (role_page_access) ∪ that person's
 * grants, folded together in getAllowedRoutes (lib/page-access.ts). A grant is
 * PAGE ACCESS ONLY — every action, write and data scope on the page still runs
 * through the existing role / scope checks.
 *
 * Enforced in three places: setUserPageGrant (rejects the write),
 * getAllowedRoutes (ignores a non-grantable row) and canAccessRoute's deny steps
 * (ADMIN_ONLY_ROUTES / hidden are refused before the allowed list is read).
 * ------------------------------------------------------------------------ */

/** Feedback is a redirect-only route (→ Feedback Collection); nothing to grant. */
const NEVER_GRANTABLE_ROUTES = ["/feedback"] as const

/**
 * May `route` be granted to an individual user? True only when it is a
 * registered page (pass PAGE_REGISTRY — kept as an argument so this module
 * stays import-free) and is NOT: in ADMIN_ONLY_ROUTES, a hidden page, an
 * always-allowed page, anywhere in the Admin section (/admin and below), or
 * /feedback. Exact registry routes only — sub-paths are never stored.
 */
export function isGrantableRoute(route: string, registry: readonly { route: string }[]): boolean {
  if (!registry.some((p) => p.route === route)) return false
  if (route === "/admin" || route.startsWith("/admin/")) return false
  if ((ADMIN_ONLY_ROUTES as readonly string[]).some((r) => matchesRoute(route, r))) return false
  if (isHiddenRoute(route)) return false
  if ((ALWAYS_ALLOWED_ROUTES as readonly string[]).includes(route)) return false
  if ((NEVER_GRANTABLE_ROUTES as readonly string[]).includes(route)) return false
  return true
}

/**
 * WHOSE per-user page grants apply to a request — the `email` argument of
 * getAllowedRoutes. Takes the resolveEffective result (lib/impersonation.ts):
 *   - PERSON View as → the impersonated person (their role pages ∪ their grants);
 *   - ROLE View as   → null (an abstract role preview: role pages only);
 *   - otherwise      → the real signed-in user.
 */
export function effectiveAccessEmail(
  realEmail: string | null | undefined,
  resolution: { person: { email: string } | null; roleView: string | null },
): string | null {
  if (resolution.person) return resolution.person.email
  if (resolution.roleView) return null
  return realEmail ?? null
}

/**
 * Can a `role` reach `pathname`, given `allowedRoutes` — the routes granted to
 * that role in `role_page_access` PLUS the person's grantable per-user grants
 * (user_page_grants) (load once per request via
 * getAllowedRoutes(); see lib/page-access.ts). Pure and synchronous so the nav
 * (a Client Component) and the proxy share the exact same decision.
 *
 * Order of checks (backstops first):
 *   1. Always-allowed infra routes → yes, for anyone signed in.
 *   2. super_user → yes, everything (never gated by the matrix).
 *      admin → yes, everything EXCEPT ADMIN_EXCLUDED_ROUTES and hidden pages
 *      (never gated by the matrix either).
 *   3. ADMIN_ONLY_ROUTES, or a HIDDEN page (HIDDEN_PAGE_REGISTRY) → no, for
 *      everyone who got past step 2.
 *   4. No role → no.
 *   5. Otherwise → yes iff the matrix grants a matching route (segment-aware,
 *      so a granted "/client-detail" also allows "/client-detail/123").
 */
export function canAccessRoute(
  role: Role | null,
  pathname: string,
  allowedRoutes: readonly string[],
): boolean {
  if (ALWAYS_ALLOWED_ROUTES.some((r) => matchesRoute(pathname, r))) return true
  if (isStrictSuperUser(role)) return true
  if (role === "admin") {
    return !ADMIN_EXCLUDED_ROUTES.some((r) => matchesRoute(pathname, r)) && !isHiddenRoute(pathname)
  }
  // Super-user-only routes are never delegable through the matrix (see
  // ADMIN_ONLY_ROUTES). Deny before the grant lookup, so a stray role_page_access
  // row cannot open one.
  if (ADMIN_ONLY_ROUTES.some((r) => matchesRoute(pathname, r))) return false
  // Hidden (retired) pages: super-user only while hidden, whatever the matrix says.
  if (isHiddenRoute(pathname)) return false
  if (!role) return false
  return allowedRoutes.some((r) => matchesRoute(pathname, r))
}

/* ---------------------------------------------------------------------------
 * The nav rail's CRM block
 *
 * The CRM tables are not reporting sections in the rail. They are the raw CRM
 * mirror — every row for every client, unscoped — so they sit apart: pinned
 * to the bottom of the rail, under its own "CRM" rule, drawn as an outline
 * rather than a fill (components/nav.tsx owns the drawing).
 *
 * WHO may see it is decided here, beside `canAccessRoute` and ADMIN_ONLY_ROUTES,
 * rather than in the nav component — it is an access decision, this module is
 * pure, and keeping it here is what lets lib/nav-crm.test.ts cover it.
 * ------------------------------------------------------------------------ */

/** One entry in the rail's CRM block. Icons live in nav.tsx; this stays pure. */
export type CrmNavItem = { href: string; label: string }

export const CRM_NAV_ITEMS: readonly CrmNavItem[] = [
  // FIRST in the block, by request. DISPLAY NAME is "Clients"; everything
  // internal stays "accounts" — the route, v_admin_accounts_all,
  // public.accounts, the spec key and the file names. Same split as Touches
  // below. NOT the Portfolio client table: that is a separate,
  // matrix-grantable reporting page and is unaffected by this entry.
  { href: "/accounts", label: "Clients" },
  // Events before Meetings (2026-10-11): an event is the container its
  // meetings belong to.
  { href: "/events", label: "Events" },
  { href: "/meetings", label: "Meetings" },
  { href: "/tasks", label: "Tasks" },
  // DISPLAY NAME is "Touchpoints" (2026-10-12; was "Touches"); everything
  // internal stays "touchpoints" — the route, v_admin_touchpoints_all,
  // public.touchpoints, the spec key and the file names. Label only.
  { href: "/touchpoints", label: "Touchpoints" },
  { href: "/notes", label: "Notes" },
  { href: "/contacts", label: "Contacts" },
  // Time Off requests (/time-off-requests) left the CRM block 2026-10-11: it is
  // reached from the Logistics Time Off page's "Manage Time Off" button instead
  // (route unchanged, still row-scoped — see ALWAYS_ALLOWED_ROUTES).
]

/**
 * Whether to render the CRM block AT ALL — the divider, the "CRM" label and the
 * items together. False means none of it reaches the DOM: a non-super-user sees
 * no item AND no section break, rather than an empty labelled section.
 *
 * ONE condition (2026-10-16): canAccessRoute — the SAME predicate proxy.ts
 * enforces with, so the nav can never advertise a route the proxy would block.
 * The old super-user floor was dropped when Clients / Events / Meetings /
 * Contacts became grantable: a role or person granted one of them now sees the
 * CRM block with just those items. Tasks / Touchpoints / Notes are still in
 * ADMIN_ONLY_ROUTES, so canAccessRoute keeps them super-user only here too.
 *
 * `role` is the EFFECTIVE role (resolved in app/layout.tsx), so a super-user
 * using "View as" loses this block exactly as the impersonated person would —
 * matching what the page itself does server-side.
 *
 * NONE OF THIS IS THE SECURITY BOUNDARY. proxy.ts gates the route before the
 * page renders, and each page re-checks page access before it fetches
 * anything. This only decides whether a link is drawn.
 */
export function canSeeCrmNav(
  role: Role | null,
  allowedRoutes: readonly string[],
): boolean {
  return CRM_NAV_ITEMS.some((item) => canAccessRoute(role, item.href, allowedRoutes))
}

/** The CRM items to draw — empty whenever the block must not render at all. */
export function visibleCrmNavItems(
  role: Role | null,
  allowedRoutes: readonly string[],
): CrmNavItem[] {
  if (!canSeeCrmNav(role, allowedRoutes)) return []
  return CRM_NAV_ITEMS.filter((item) => canAccessRoute(role, item.href, allowedRoutes))
}

/**
 * Where a person lands after signing in (and when a signed-in user opens
 * /login): My Dashboard when they may open it, otherwise the app's original
 * default, Portfolio. Asked through canAccessRoute, so it follows the ONE gate
 * above: /my-dashboard is in ALWAYS_ALLOWED_ROUTES, so every user WITH A ROLE
 * lands there (a role-less user still goes the Portfolio → /no-access way;
 * move the route to ADMIN_ONLY_ROUTES and only super users land there). Portfolio is
 * safe for everyone — a role without a Portfolio grant is redirected by
 * proxy.ts to the first page it CAN reach (or /no-access). landing.test.ts.
 */
export const MY_DASHBOARD_ROUTE = "/my-dashboard"
export const DEFAULT_LANDING_ROUTE = "/portfolio"

export function landingRouteFor(role: Role | null): string {
  return role && canAccessRoute(role, MY_DASHBOARD_ROUTE, []) ? MY_DASHBOARD_ROUTE : DEFAULT_LANDING_ROUTE
}

/**
 * Where the APP ROOT ("/") sends a signed-in user (app/page.tsx) — the same
 * landing as after sign-in, made loop-proof with the role's real grants:
 *   1. My Dashboard, when the role may open it (today: every role);
 *   2. else the previous default, Portfolio, when the role may open it;
 *   3. else the first page the role CAN open (never "/" itself);
 *   4. else /no-access (a role-less user always ends here).
 * Never a blocked or blank screen, and never back to "/".
 */
export function homeRouteFor(role: Role | null, allowedRoutes: readonly string[]): string {
  if (!role) return "/no-access"
  if (canAccessRoute(role, MY_DASHBOARD_ROUTE, allowedRoutes)) return MY_DASHBOARD_ROUTE
  if (canAccessRoute(role, DEFAULT_LANDING_ROUTE, allowedRoutes)) return DEFAULT_LANDING_ROUTE
  return allowedRoutes.find((r) => r !== "/") ?? "/no-access"
}

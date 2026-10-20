import { test } from "node:test"
import assert from "node:assert/strict"

import {
  ADMIN_EXCLUDED_ROUTES,
  ADMIN_ONLY_ROUTES,
  ALWAYS_ALLOWED_ROUTES,
  HIDDEN_PAGE_REGISTRY,
  VIEW_AS_ROLE_OPTIONS,
  canAccessRoute,
  canSeeCrmNav,
  effectiveAccessEmail,
  hasSuperUserPrivileges,
  isGrantableRoute,
  isHiddenRoute,
  isStrictSuperUser,
  isViewAsRole,
  viewAsLabel,
  type Role,
} from "./access-control.ts"
import { ASSIGNABLE_ROLES, seedDefaultAllowed, PAGE_REGISTRY } from "./page-registry.ts"

// ---------------------------------------------------------------------------
// Associate — a first-class role that starts with NOTHING.
//
// The security claim these tests pin down: adding a role to the vocabulary must
// not grant it anything. Gating is driven entirely by the Roles matrix, so an
// Associate with no rows in role_page_access must be denied everywhere except
// the always-allowed infra routes — and must become allowed the moment the
// matrix grants a page, with no code change.
// ---------------------------------------------------------------------------

/** A spread of real registered routes, so the deny test isn't checking one page. */
const SAMPLE_ROUTES = [
  "/portfolio",
  "/client-detail",
  "/clients/to-do",
  "/planning-v2",
  "/feedback-manager",
  "/institutions",
  "/contract-management",
  "/admin",
  "/admin/roles",
]

test("Associate is a recognised role in the vocabulary", () => {
  // getRealRole() funnels the DB value through isViewAsRole — if this returned
  // false, an Associate grant row would resolve to `null` (no role at all) and
  // the matrix could never take effect.
  assert.equal(isViewAsRole("associate"), true)
  assert.equal(viewAsLabel("associate"), "Associate")
  assert.ok(
    VIEW_AS_ROLE_OPTIONS.some((o) => o.value === "associate"),
    "Associate is offered in the View-as picker",
  )
})

test("Associate is its own grantable column in the Roles matrix, and is not locked", () => {
  const entry = ASSIGNABLE_ROLES.find((r) => r.value === "associate")
  assert.ok(entry, "Associate is an assignable role")
  assert.equal(entry.label, "Associate")
  // Only super_user is locked (always-on, never written to role_page_access).
  // Associate must be editable or its boxes could not be ticked.
  assert.notEqual(entry.locked, true)
})

test("Associate defaults to NO pages — deny by default", () => {
  for (const entry of PAGE_REGISTRY) {
    assert.equal(
      seedDefaultAllowed("associate", entry),
      false,
      `Associate must not be seeded access to ${entry.route}`,
    )
  }
})

test("an Associate with no grants is denied everywhere", () => {
  const noGrants: readonly string[] = []
  for (const route of SAMPLE_ROUTES) {
    assert.equal(
      canAccessRoute("associate", route, noGrants),
      false,
      `ungranted Associate must not reach ${route}`,
    )
  }
})

test("an Associate with no grants can still reach the always-allowed routes", () => {
  for (const route of ALWAYS_ALLOWED_ROUTES) {
    assert.equal(canAccessRoute("associate", route, []), true)
  }
  // …so a role-less landing page exists and there is no redirect loop.
  assert.equal(canAccessRoute("associate", "/no-access", []), true)
})

test("granting a page in the matrix lets an Associate open it — and only it", () => {
  const granted = ["/portfolio"]
  assert.equal(canAccessRoute("associate", "/portfolio", granted), true)
  // Segment-aware: a granted parent covers its sub-paths.
  assert.equal(canAccessRoute("associate", "/portfolio/123", granted), true)
  // Everything else stays denied — one grant is not a blanket.
  assert.equal(canAccessRoute("associate", "/client-detail", granted), false)
  assert.equal(canAccessRoute("associate", "/admin", granted), false)
  // A sibling whose route merely shares a prefix must NOT be swept in.
  assert.equal(canAccessRoute("associate", "/portfolio-secret", granted), false)
})

test("granting several pages grants exactly those", () => {
  const granted = ["/planning-v2", "/feedback-manager"]
  assert.equal(canAccessRoute("associate", "/planning-v2", granted), true)
  assert.equal(canAccessRoute("associate", "/feedback-manager", granted), true)
  assert.equal(canAccessRoute("associate", "/feedback-collection", granted), false)
  assert.equal(canAccessRoute("associate", "/portfolio", granted), false)
})

test("Super User still bypasses the matrix entirely", () => {
  for (const route of SAMPLE_ROUTES) {
    // No grants at all — super_user is a hard backstop, never gated by the grid.
    assert.equal(canAccessRoute("super_user", route, []), true)
  }
  // Adding Associate must not have disturbed the backstop ordering.
  assert.equal(canAccessRoute("super_user", "/admin/roles", []), true)
})

test("Associate is gated exactly like the other non-super roles", () => {
  // The point of a data-driven matrix: no role gets special-cased in code.
  const peers: Role[] = ["user", "client_manager", "logistics", "associate"]
  for (const role of peers) {
    assert.equal(canAccessRoute(role, "/portfolio", []), false)
    assert.equal(canAccessRoute(role, "/portfolio", ["/portfolio"]), true)
    assert.equal(canAccessRoute(role, "/no-access", []), true)
  }
})

test("no role at all is still denied, Associate or not", () => {
  assert.equal(canAccessRoute(null, "/portfolio", ["/portfolio"]), false)
  assert.equal(canAccessRoute(null, "/no-access", []), true)
})

test("a HIDDEN (retired) page: super user only, even with a matrix grant", () => {
  for (const p of HIDDEN_PAGE_REGISTRY.filter((x) => x.hidden)) {
    assert.equal(isHiddenRoute(p.route), true)
    assert.equal(canAccessRoute("super_user", p.route, []), true, `super user opens ${p.route}`)
    assert.equal(canAccessRoute("user", p.route, [p.route]), false, `granted user refused ${p.route}`)
    assert.equal(canAccessRoute("user", p.route + "/x", [p.route]), false, `sub-path refused ${p.route}`)
  }
})

test("Alerts is retired; neighbouring routes are unaffected", () => {
  assert.equal(isHiddenRoute("/clients/alerts"), true)
  assert.equal(isHiddenRoute("/clients/to-do"), false)
  assert.equal(isHiddenRoute("/my-dashboard"), false)
  assert.equal(canAccessRoute("user", "/clients/to-do", ["/clients/to-do"]), true)
})

// ---------------------------------------------------------------------------
// Admin — super_user minus the carve-outs (2026-10-13).
// ---------------------------------------------------------------------------

test("the two privilege helpers split super_user and admin exactly", () => {
  assert.equal(hasSuperUserPrivileges("super_user"), true)
  assert.equal(hasSuperUserPrivileges("admin"), true)
  assert.equal(isStrictSuperUser("super_user"), true)
  assert.equal(isStrictSuperUser("admin"), false)
  for (const r of ["user", "associate", "client_manager", "logistics", null, undefined] as const) {
    assert.equal(hasSuperUserPrivileges(r), false)
    assert.equal(isStrictSuperUser(r), false)
  }
})

test("Admin is a real, View-as-able role with a locked Roles-matrix column", () => {
  assert.equal(isViewAsRole("admin"), true)
  assert.equal(viewAsLabel("admin"), "Admin")
  const col = ASSIGNABLE_ROLES.find((r) => r.value === "admin")
  assert.ok(col)
  assert.equal(col.locked, true)
})

test("Admin reaches the CRM tables and super-user-only pages without any grant", () => {
  for (const route of [
    "/accounts", "/events", "/meetings", "/tasks", "/touchpoints", "/notes", "/contacts",
    "/admin", "/admin/account-teams", "/admin/audit-log", "/admin/contracts",
    "/admin/time-off-reviewers", "/admin/automations", "/admin/docs",
    "/client-health", "/fb-coming-soon", "/portfolio", "/client-detail/123", "/onboarding",
  ]) {
    assert.equal(canAccessRoute("admin", route, []), true, `admin should reach ${route}`)
  }
  assert.equal(canSeeCrmNav("admin", []), true)
})

test("Admin is refused every excluded route and every hidden page; super_user is not", () => {
  const refused = [
    "/admin/users", "/admin/roles", "/client-statistics", "/people-statistics",
    "/productivity", "/productivity-detail", "/capacity",
    "/admin/sync", "/admin/reconciliation", "/admin/database",
  ]
  assert.deepEqual([...ADMIN_EXCLUDED_ROUTES].sort(), [...refused].sort())
  for (const route of [...refused, "/admin/users/x", ...HIDDEN_PAGE_REGISTRY.filter((p) => p.hidden).map((p) => p.route)]) {
    assert.equal(canAccessRoute("admin", route, []), false, `admin must not reach ${route}`)
    // A stray matrix grant cannot open it either.
    assert.equal(canAccessRoute("admin", route, [route]), false, `a grant must not open ${route} to admin`)
    assert.equal(canAccessRoute("super_user", route, []), true, `super_user still reaches ${route}`)
  }
})

// ---------------------------------------------------------------------------
// Per-user page grants (2026-10-14) — isGrantableRoute, the role ∪ grants fold,
// View-as, and the five Admin pages moved into ADMIN_ONLY_ROUTES.
// ---------------------------------------------------------------------------

/** The fold getAllowedRoutes performs (lib/page-access.ts), minus the DB. */
function fold(rolePages: string[], grants: string[]): string[] {
  return [...rolePages, ...grants.filter((g) => isGrantableRoute(g, PAGE_REGISTRY))]
}

const STRICT_FIVE = ["/admin/users", "/admin/roles", "/admin/sync", "/admin/reconciliation", "/admin/database"]

test("the grantable set is exactly the registry minus strict, hidden, always-allowed, Admin and /feedback", () => {
  const grantable = PAGE_REGISTRY.filter((p) => isGrantableRoute(p.route, PAGE_REGISTRY)).map((p) => p.route)
  assert.deepEqual(grantable, [
    "/client-statistics", "/portfolio", "/client-detail", "/clients/to-do",
    "/institutions", "/institution-detail", "/institution-style", "/relationships",
    "/people-statistics", "/productivity", "/productivity-detail", "/capacity",
    "/planning-v2", "/planning", "/calendar", "/scheduler", "/live-outreach", "/profiles",
    "/feedback-manager", "/feedback-collection", "/onboarding", "/time-off", "/data-uploads",
    "/pipeline", "/conference-rooms", "/ooo-summary",
    "/contract-management", "/renewals", "/margin", "/revenue-overrides", "/direct-costs",
    "/cost-assumptions", "/overhead-overrides", "/quarterly-overhead", "/salary-schedule", "/exceptions",
    // CRM list pages, grantable since 2026-10-16.
    "/accounts", "/events", "/meetings", "/contacts",
    // Tasks / Touchpoints / Notes, grantable (row-scoped) since 2026-10-20.
    "/tasks", "/touchpoints", "/notes",
  ])
})

test("strict pages are never grantable", () => {
  const strict = [
    ...ADMIN_ONLY_ROUTES,
    ...STRICT_FIVE,
    ...PAGE_REGISTRY.filter((p) => p.section === "Admin").map((p) => p.route),
    ...HIDDEN_PAGE_REGISTRY.filter((p) => p.hidden).map((p) => p.route),
    ...ALWAYS_ALLOWED_ROUTES,
    "/feedback",
    // Not registered / sub-paths / junk are refused too.
    "/portfolio/123", "/admin/users/x", "/nope", "", "portfolio",
  ]
  for (const route of strict) {
    assert.equal(isGrantableRoute(route, PAGE_REGISTRY), false, `${route} must not be grantable`)
  }
})

test("a granted page opens for that user — and only it", () => {
  const allowed = fold([], ["/portfolio"])
  assert.equal(canAccessRoute("associate", "/portfolio", allowed), true)
  assert.equal(canAccessRoute("associate", "/portfolio/123", allowed), true)
  assert.equal(canAccessRoute("associate", "/client-detail", allowed), false)
  // Role pages and grants union.
  const both = fold(["/planning-v2"], ["/calendar"])
  assert.equal(canAccessRoute("logistics", "/planning-v2", both), true)
  assert.equal(canAccessRoute("logistics", "/calendar", both), true)
})

test("a user without the grant is still denied the page", () => {
  assert.equal(canAccessRoute("associate", "/portfolio", fold([], [])), false)
  assert.equal(canAccessRoute("associate", "/portfolio", fold([], ["/calendar"])), false)
})

test("a stray grant row for a strict page is ignored by the fold AND refused by canAccessRoute", () => {
  for (const route of [...ADMIN_ONLY_ROUTES, ...STRICT_FIVE, "/admin", "/admin/docs"]) {
    const allowed = fold([], [route])
    assert.equal(allowed.includes(route), false, `fold must drop ${route}`)
    assert.equal(canAccessRoute("associate", route, allowed), false, `grant must not open ${route}`)
  }
  // Even if a strict route reached the list some other way, the deny step holds.
  for (const route of [...ADMIN_ONLY_ROUTES, ...STRICT_FIVE]) {
    assert.equal(canAccessRoute("associate", route, [route]), false, `deny step must refuse ${route}`)
  }
})

test("grants are no-ops for a role-less user", () => {
  assert.equal(canAccessRoute(null, "/portfolio", fold([], ["/portfolio"])), false)
})

test("the five Admin maintenance pages are no longer delegable through the Roles matrix", () => {
  for (const route of STRICT_FIVE) {
    assert.ok((ADMIN_ONLY_ROUTES as readonly string[]).includes(route), `${route} is ADMIN_ONLY`)
    for (const role of ["user", "associate", "client_manager", "logistics"] as Role[]) {
      assert.equal(canAccessRoute(role, route, [route]), false, `matrix must not open ${route} to ${role}`)
    }
    assert.equal(canAccessRoute("admin", route, [route]), false, `admin still refused ${route}`)
    assert.equal(canAccessRoute("super_user", route, []), true, `super_user still reaches ${route}`)
  }
})

test("View as: PERSON mode uses that person's grants, ROLE mode uses none", () => {
  const person = { email: "pat@roseandco.com" }
  assert.equal(effectiveAccessEmail("me@roseandco.com", { person, roleView: null }), "pat@roseandco.com")
  assert.equal(effectiveAccessEmail("me@roseandco.com", { person: null, roleView: "logistics" }), null)
  assert.equal(effectiveAccessEmail("me@roseandco.com", { person: null, roleView: null }), "me@roseandco.com")
  assert.equal(effectiveAccessEmail(undefined, { person: null, roleView: null }), null)
})

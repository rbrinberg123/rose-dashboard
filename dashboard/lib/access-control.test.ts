import { test } from "node:test"
import assert from "node:assert/strict"

import {
  ALWAYS_ALLOWED_ROUTES,
  VIEW_AS_ROLE_OPTIONS,
  canAccessRoute,
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

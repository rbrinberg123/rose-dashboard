import { test } from "node:test"
import assert from "node:assert/strict"

import { canAccessRoute, homeRouteFor, landingRouteFor } from "./access-control.ts"

test("every user with a role lands on My Dashboard", () => {
  for (const role of ["super_user", "user", "associate", "client_manager", "logistics"] as const) {
    assert.equal(landingRouteFor(role), "/my-dashboard", `role ${role}`)
  }
})

test("a role-less user lands on Portfolio (→ /no-access), never My Dashboard", () => {
  assert.equal(landingRouteFor(null), "/portfolio")
})

test("the app root sends every role-holder to My Dashboard", () => {
  for (const role of ["super_user", "user", "associate", "client_manager", "logistics"] as const) {
    assert.equal(homeRouteFor(role, []), "/my-dashboard", `role ${role}`)
  }
})

test("the app root never loops and never shows a blank screen", () => {
  // Role-less → the request-access screen.
  assert.equal(homeRouteFor(null, []), "/no-access")
  // "/" itself is always reachable, but is never chosen as a home.
  assert.equal(canAccessRoute("user", "/", []), true)
  assert.equal(canAccessRoute("user", "/portfolio-x", []), false)
})

import { test } from "node:test"
import assert from "node:assert/strict"

import { landingRouteFor } from "./access-control.ts"

test("super users land on My Dashboard", () => {
  assert.equal(landingRouteFor("super_user"), "/my-dashboard")
})

test("everyone else lands on Portfolio — never on the hidden My Dashboard", () => {
  for (const role of ["user", "associate", "client_manager", "logistics", null] as const) {
    assert.equal(landingRouteFor(role), "/portfolio", `role ${role}`)
  }
})

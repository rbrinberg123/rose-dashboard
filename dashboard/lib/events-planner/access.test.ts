import { test } from "node:test"
import assert from "node:assert/strict"

import { ADMIN_ONLY_ROUTES, canAccessRoute, type Role } from "../access-control.ts"

// The Events Planner is super-user only. These pin the route gate the proxy and
// the nav share: no other role reaches /admin/events or anything under it — not
// even with a stray Roles-matrix grant for it.

test("/admin/events is a super-user-only route", () => {
  assert.ok((ADMIN_ONLY_ROUTES as readonly string[]).includes("/admin/events"))
})

test("super users reach the planner and its itinerary pages", () => {
  assert.equal(canAccessRoute("super_user", "/admin/events", []), true)
  assert.equal(canAccessRoute("super_user", "/admin/events/7d3c3a3e-0000-4000-8000-000000000000", []), true)
})

test("every other role is refused, even when the matrix grants it", () => {
  const others: (Role | null)[] = ["user", "associate", "client_manager", "logistics", null]
  const granted = ["/admin", "/admin/events"]
  for (const role of others) {
    assert.equal(canAccessRoute(role, "/admin/events", granted), false, String(role))
    assert.equal(canAccessRoute(role, "/admin/events/abc", granted), false, String(role))
  }
})

test("the CRM /events page is a different route", () => {
  assert.equal(canAccessRoute("logistics", "/events", ["/events"]), false) // also super-user only, separately listed
  assert.ok((ADMIN_ONLY_ROUTES as readonly string[]).includes("/events"))
})

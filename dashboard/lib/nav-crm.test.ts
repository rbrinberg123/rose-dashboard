import { test } from "node:test"
import assert from "node:assert/strict"

import {
  canAccessRoute,
  canSeeCrmNav,
  visibleCrmNavItems,
  CRM_NAV_ITEMS,
  type Role,
} from "./access-control.ts"

/**
 * The CRM nav block is super-user-only. These tests are the guard on that: the
 * block is a link to /meetings, which returns EVERY client's meetings with no
 * row scoping, so "who sees the link" and "who can reach the page" must not be
 * allowed to drift apart.
 */

const EVERY_ROLE: (Role | null)[] = [
  null,
  "user",
  "associate",
  "client_manager",
  "logistics",
  "super_user",
]

const NON_SUPER = EVERY_ROLE.filter((r) => r !== "super_user")

test("super_user sees the CRM block, with every item", () => {
  assert.equal(canSeeCrmNav("super_user", []), true)
  assert.deepEqual(
    visibleCrmNavItems("super_user", []).map((i) => i.href),
    ["/meetings", "/events"],
  )
})

test("NO non-super_user sees the CRM block — item or divider", () => {
  for (const role of NON_SUPER) {
    assert.equal(canSeeCrmNav(role, []), false, `role ${role} must not see the CRM block`)
    // Empty list is what makes the DIVIDER and the "CRM" label disappear too:
    // nav.tsx renders the whole block only when this is non-empty.
    assert.deepEqual(visibleCrmNavItems(role, []), [], `role ${role} must get no items`)
  }
})

test("the Roles matrix cannot open the CRM block to another role", () => {
  // role_page_access rows granting the CRM routes — the exact thing
  // ADMIN_ONLY_ROUTES exists to neutralise. Belt and braces: canSeeCrmNav also
  // floors on the role.
  const granted = CRM_NAV_ITEMS.map((i) => i.href)
  for (const role of NON_SUPER) {
    assert.equal(canSeeCrmNav(role, granted), false, `matrix must not open CRM to ${role}`)
    assert.deepEqual(visibleCrmNavItems(role, granted), [])
  }
})

test("a matrix grant of every route still does not open it", () => {
  const everything = ["/", "/meetings", "/meetings/anything", "/events", "/events/anything", "/admin"]
  for (const role of NON_SUPER) {
    assert.equal(canSeeCrmNav(role, everything), false)
  }
})

test("the nav gate never disagrees with the route gate", () => {
  // Whatever the nav is willing to DRAW, canAccessRoute must also permit —
  // otherwise the rail advertises a link the proxy would bounce.
  for (const role of EVERY_ROLE) {
    for (const allowed of [[], ["/meetings"], ["/events"], ["/meetings", "/events"], ["/portfolio"]]) {
      for (const item of visibleCrmNavItems(role, allowed)) {
        assert.equal(
          canAccessRoute(role, item.href, allowed),
          true,
          `nav drew ${item.href} for ${role} but the route gate denies it`,
        )
      }
    }
  }
})

test("every CRM item is itself super-user-only at the route level", () => {
  // If an item is ever added here that a non-super-user CAN reach, it does not
  // belong in this block — the block's whole premise is unscoped CRM data.
  assert.ok(CRM_NAV_ITEMS.length >= 2, "expected Meetings and Events in the CRM block")
  for (const item of CRM_NAV_ITEMS) {
    for (const role of NON_SUPER) {
      // Granted explicitly in the matrix, and STILL denied.
      assert.equal(
        canAccessRoute(role, item.href, [item.href]),
        false,
        `${item.href} must be super-user-only at the route level`,
      )
      // A sub-path of it too, since the matcher is segment-aware.
      assert.equal(canAccessRoute(role, `${item.href}/anything`, [item.href]), false)
    }
    assert.equal(canAccessRoute("super_user", item.href, []), true)
  }
})

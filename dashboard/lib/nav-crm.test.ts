import { test } from "node:test"
import assert from "node:assert/strict"

import {
  canAccessRoute,
  canSeeCrmNav,
  isGrantableRoute,
  visibleCrmNavItems,
  CRM_NAV_ITEMS,
  type Role,
} from "./access-control.ts"
import { PAGE_REGISTRY } from "./page-registry.ts"

/**
 * The CRM nav block (2026-10-16). Clients / Events / Meetings / Contacts are
 * grantable list pages: a role or per-user grant opens them (every row, no
 * row scoping). Tasks / Touchpoints / Notes stay super-user only. The block
 * draws exactly what canAccessRoute allows — "who sees the link" and "who can
 * reach the page" must never drift apart.
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

// Every CRM table is grantable since 2026-10-20 (Tasks / Touchpoints / Notes
// joined, row-scoped — lib/access/actions-scope.ts).
const GRANTABLE_CRM = ["/accounts", "/events", "/meetings", "/tasks", "/touchpoints", "/notes", "/contacts"]

test("super_user sees the CRM block, with every item", () => {
  assert.equal(canSeeCrmNav("super_user", []), true)
  assert.deepEqual(
    visibleCrmNavItems("super_user", []).map((i) => i.href),
    ["/accounts", "/events", "/meetings", "/tasks", "/touchpoints", "/notes", "/contacts"],
  )
})

test("with no grant, no non-super_user sees the CRM block — item or divider", () => {
  for (const role of NON_SUPER) {
    assert.equal(canSeeCrmNav(role, []), false, `role ${role} must not see the CRM block`)
    // Empty list is what makes the DIVIDER and the "CRM" label disappear too:
    // nav.tsx renders the whole block only when this is non-empty.
    assert.deepEqual(visibleCrmNavItems(role, []), [], `role ${role} must get no items`)
  }
})

test("a grant of every CRM page shows exactly those pages", () => {
  const granted = CRM_NAV_ITEMS.map((i) => i.href)
  for (const role of NON_SUPER) {
    if (role === null) continue
    assert.equal(canSeeCrmNav(role, granted), true)
    assert.deepEqual(
      visibleCrmNavItems(role, granted).map((i) => i.href),
      ["/accounts", "/events", "/meetings", "/tasks", "/touchpoints", "/notes", "/contacts"],
    )
  }
  // A single grant shows a single item.
  assert.deepEqual(visibleCrmNavItems("associate", ["/contacts"]).map((i) => i.href), ["/contacts"])
  // A role-less user gets nothing, whatever the list says.
  assert.deepEqual(visibleCrmNavItems(null, granted), [])
})

test("every CRM list page is grantable, and needs the grant", () => {
  for (const route of GRANTABLE_CRM) {
    assert.equal(isGrantableRoute(route, PAGE_REGISTRY), true, `${route} should be grantable`)
    assert.equal(canAccessRoute("associate", route, [route]), true)
    assert.equal(canAccessRoute("associate", `${route}/anything`, [route]), true)
    assert.equal(canAccessRoute("associate", route, []), false, `${route} needs a grant`)
  }
})

test("the nav gate never disagrees with the route gate", () => {
  // Whatever the nav is willing to DRAW, canAccessRoute must also permit —
  // otherwise the rail advertises a link the proxy would bounce.
  for (const role of EVERY_ROLE) {
    for (const allowed of [[], ["/meetings"], ["/events"], ["/meetings", "/events"], ["/portfolio"], ["/tasks", "/notes"]]) {
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

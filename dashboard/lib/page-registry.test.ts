import { test } from "node:test"
import assert from "node:assert/strict"

import {
  PAGE_REGISTRY,
  DATA_PERMISSIONS,
  isDataPermissionKey,
  isRegisteredRoute,
} from "./page-registry.ts"
import { FINANCIALS_PERMISSION_KEY } from "./access/financials-policy.ts"

test("Feedback Reports and Feedback Collection are separate, independently-grantable rows", () => {
  const reports = PAGE_REGISTRY.find((p) => p.route === "/feedback-manager")
  const collection = PAGE_REGISTRY.find((p) => p.route === "/feedback-collection")

  assert.ok(reports, "/feedback-manager is registered")
  assert.ok(collection, "/feedback-collection is registered")
  // Distinct routes → distinct Roles-matrix rows → a role can be granted one
  // without the other.
  assert.notEqual(reports.route, collection.route)
  assert.equal(reports.label, "Feedback Reports")
  assert.equal(collection.label, "Feedback Collection")
  assert.equal(reports.section, "Logistics")
  assert.equal(collection.section, "Logistics")
  // Both are real routes the save-guard/proxy will accept.
  assert.equal(isRegisteredRoute("/feedback-manager"), true)
  assert.equal(isRegisteredRoute("/feedback-collection"), true)
})

// --- data permissions (matrix rows that are NOT pages) ----------------------

test("Financials is a data permission, not a page — its key can never be a route", () => {
  const financials = DATA_PERMISSIONS.find((p) => p.label === "Financials")
  assert.ok(financials, "Financials is a registered data permission")
  // The storage key must match the resolver's constant, or the Roles-matrix
  // checkbox would write a row canSeeFinancials never reads.
  assert.equal(financials.key, FINANCIALS_PERMISSION_KEY)
  // It shares the role_page_access table with page access, so it must be
  // impossible to mistake for a page: `data:`-prefixed, not a route, and not
  // accepted by the page save-guard.
  assert.ok(financials.key.startsWith("data:"))
  assert.equal(isRegisteredRoute(financials.key), false)
  assert.equal(
    PAGE_REGISTRY.some((p) => p.route === financials.key),
    false,
  )
  // ...and the two save-guards do not overlap: a real route is not a data
  // permission key, and vice versa.
  assert.equal(isDataPermissionKey(financials.key), true)
  assert.equal(isDataPermissionKey("/portfolio"), false)
  assert.equal(isRegisteredRoute("/portfolio"), true)
})

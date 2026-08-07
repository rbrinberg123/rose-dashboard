import { test } from "node:test"
import assert from "node:assert/strict"

import { PAGE_REGISTRY, isRegisteredRoute } from "./page-registry.ts"

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

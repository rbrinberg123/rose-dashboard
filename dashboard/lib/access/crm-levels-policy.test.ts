import { test } from "node:test"
import assert from "node:assert/strict"

import {
  CRM_LEVEL_ROUTES,
  CRM_LEVEL_TABLE_ROUTE,
  PROTECTED_FIELDS,
  decideCrmWrite,
  isCrmLevelRoute,
  levelAtLeast,
  levelFromGrantRow,
  levelFromRoleRow,
  maxLevel,
  protectedFieldViolation,
  quickAddKinds,
} from "./crm-levels-policy.ts"
import { isGrantableRoute } from "../access-control.ts"
import { PAGE_REGISTRY } from "../page-registry.ts"

test("the level-gated routes are exactly the grantable CRM list pages", () => {
  assert.deepEqual([...CRM_LEVEL_ROUTES], ["/accounts", "/events", "/meetings", "/contacts", "/tasks", "/touchpoints", "/notes"])
  for (const r of CRM_LEVEL_ROUTES) assert.equal(isGrantableRoute(r, PAGE_REGISTRY), true)
  // Tasks / Touchpoints / Notes joined 2026-10-20 (row-scoped); notes' table is client_notes.
  for (const r of ["/tasks", "/touchpoints", "/notes"]) assert.equal(isCrmLevelRoute(r), true)
  assert.equal(CRM_LEVEL_TABLE_ROUTE.client_notes, "/notes")
  assert.deepEqual(Object.values(CRM_LEVEL_TABLE_ROUTE).sort(), [...CRM_LEVEL_ROUTES].sort())
})

test("role rows: `allowed` is authoritative — None/View reproduce the old checkbox exactly", () => {
  assert.equal(levelFromRoleRow(null), "none")
  assert.equal(levelFromRoleRow({ allowed: false }), "none")
  assert.equal(levelFromRoleRow({ allowed: false, crm_level: "manage" }), "none") // a stray level can't open it
  assert.equal(levelFromRoleRow({ allowed: true }), "view") // pre-migration row
  assert.equal(levelFromRoleRow({ allowed: true, crm_level: null }), "view")
  assert.equal(levelFromRoleRow({ allowed: true, crm_level: "edit" }), "edit")
  assert.equal(levelFromRoleRow({ allowed: true, crm_level: "manage" }), "manage")
  assert.equal(levelFromRoleRow({ allowed: true, crm_level: "bogus" }), "view")
})

test("person rows: a row is View; crm_level only raises it", () => {
  assert.equal(levelFromGrantRow(null), "none")
  assert.equal(levelFromGrantRow({}), "view")
  assert.equal(levelFromGrantRow({ crm_level: "edit" }), "edit")
  assert.equal(levelFromGrantRow({ crm_level: "manage" }), "manage")
})

test("effective level is raise-only — the higher of role and person", () => {
  assert.equal(maxLevel("view", "manage"), "manage")
  assert.equal(maxLevel("edit", "view"), "edit") // a lower person level can't lower the role
  assert.equal(maxLevel("none", "none"), "none")
})

test("write gates: Edit edits, Manage creates and deletes, View / None write nothing", () => {
  for (const level of ["none", "view"] as const) {
    assert.notEqual(decideCrmWrite("edit", level, false), null)
    assert.notEqual(decideCrmWrite("create", level, false), null)
    assert.notEqual(decideCrmWrite("delete", level, false), null)
  }
  assert.equal(decideCrmWrite("edit", "edit", false), null)
  assert.notEqual(decideCrmWrite("create", "edit", false), null)
  assert.notEqual(decideCrmWrite("delete", "edit", false), null)
  for (const action of ["edit", "create", "delete"] as const) assert.equal(decideCrmWrite(action, "manage", false), null)
})

test("super users / admins are implicitly full — they bypass the level", () => {
  for (const action of ["edit", "create", "delete"] as const) assert.equal(decideCrmWrite(action, "none", true), null)
})

test("protected fields: shipped EMPTY, so nothing beyond create / delete is restricted", () => {
  for (const r of CRM_LEVEL_ROUTES) assert.deepEqual([...PROTECTED_FIELDS[r]], [])
  assert.equal(protectedFieldViolation("/accounts", ["name", "ticker_symbol"], "edit", false), null)
})

test("protected fields hook: when a field IS listed, Edit is refused, Manage / super pass", () => {
  const listed = { "/accounts": ["name"], "/events": [], "/meetings": [], "/contacts": [] }
  assert.match(protectedFieldViolation("/accounts", ["name"], "edit", false, listed) ?? "", /needs Manage/)
  assert.equal(protectedFieldViolation("/accounts", ["city"], "edit", false, listed), null)
  assert.equal(protectedFieldViolation("/accounts", ["name"], "manage", false, listed), null)
  assert.equal(protectedFieldViolation("/accounts", ["name"], "none", true, listed), null)
  assert.equal(levelAtLeast("manage", "edit"), true)
})

test("quick add: each type needs Manage on its own table; super users / admins get all", () => {
  const none = Object.fromEntries(CRM_LEVEL_ROUTES.map((r) => [r, "none"])) as Record<(typeof CRM_LEVEL_ROUTES)[number], "none" | "view" | "edit" | "manage">
  assert.deepEqual(quickAddKinds(none, false), [])
  assert.deepEqual(quickAddKinds({ ...none, "/tasks": "manage", "/notes": "edit", "/meetings": "view" }, false), ["task"])
  assert.deepEqual(quickAddKinds({ ...none, "/accounts": "manage", "/touchpoints": "manage" }, false), ["client", "touch"])
  assert.deepEqual(quickAddKinds(none, true), ["client", "meeting", "event", "task", "touch", "note", "contact"])
})

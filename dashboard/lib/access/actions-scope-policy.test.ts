import { test } from "node:test"
import assert from "node:assert/strict"

import { actionsScopeOrClause, coreAccountIdsOf } from "./actions-scope-policy.ts"

const ME = "11111111-1111-1111-1111-111111111111"
const ME_DUP = "22222222-2222-2222-2222-222222222222" // same person, second CRM record
const ACCT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const EXEMPT = `task_subtype_label.in.("Feedback","Feedback Report Sent","Data Upload")`

test("tasks: on-team OR owner/creator/assignment OR exempt sub-type", () => {
  const clause = actionsScopeOrClause("tasks", { accountIds: [ACCT], userIds: [ME, ME_DUP] }, null)
  assert.equal(
    clause,
    [
      `client_account_id.in.(${ACCT})`,
      `owner_id.in.(${ME},${ME_DUP})`,
      `created_by_id.in.(${ME},${ME_DUP})`,
      `current_assignment_id.in.(${ME},${ME_DUP})`,
      EXEMPT,
    ].join(","),
  )
})

test("tasks: team unresolved → own rows + exempt only", () => {
  const clause = actionsScopeOrClause("tasks", { accountIds: [], userIds: [ME] }, null)
  assert.ok(!clause.includes("client_account_id"))
  assert.ok(clause.includes(`owner_id.in.(${ME})`))
  assert.ok(clause.endsWith(EXEMPT))
})

test("tasks: identity unresolved → exempt sub-types only", () => {
  assert.equal(actionsScopeOrClause("tasks", { accountIds: [], userIds: [] }, null), EXEMPT)
})

test("touchpoints / notes: nothing to match → deny-all, never unfiltered", () => {
  assert.equal(actionsScopeOrClause("touchpoints", { accountIds: [], userIds: [] }, null), "touchpoint_id.is.null")
  assert.equal(actionsScopeOrClause("notes", { accountIds: [], userIds: [] }, null), "note_id.is.null")
})

test("touchpoints own = creator only (owner_id is a team); notes own = owner or creator", () => {
  assert.equal(
    actionsScopeOrClause("touchpoints", { accountIds: [], userIds: [ME] }, null),
    `created_by_id.in.(${ME})`,
  )
  assert.equal(
    actionsScopeOrClause("notes", { accountIds: [], userIds: [ME] }, null),
    `owner_id.in.(${ME}),created_by_id.in.(${ME})`,
  )
})

test("a column the view lacks is dropped — narrower, never wider", () => {
  const available = new Set(["task_id", "client_account_id", "owner_id", "created_by_id", "task_subtype_label"])
  const clause = actionsScopeOrClause("tasks", { accountIds: [ACCT], userIds: [ME] }, available)
  assert.ok(!clause.includes("current_assignment_id"))
  assert.ok(clause.includes(`owner_id.in.(${ME})`))
})

test("non-UUID ids never reach the grammar", () => {
  const clause = actionsScopeOrClause("notes", { accountIds: ["x),id.not.is.null"], userIds: ["bad"] }, null)
  assert.equal(clause, "note_id.is.null")
})

test("core team = Primary/Secondary/Associate/Logistics; Feedback/Memo alone do not count", () => {
  const ids = coreAccountIdsOf({
    mode: "filter",
    accountIds: new Set(["a-mgr", "a-fb", "a-memo", "a-assoc-and-fb"]),
    rolesByAccount: new Map([
      ["a-mgr", ["account_manager"]],
      ["a-fb", ["feedback_report"]],
      ["a-memo", ["memo"]],
      ["a-assoc-and-fb", ["associate", "feedback_report"]],
    ]),
  })
  assert.deepEqual(ids.sort(), ["a-assoc-and-fb", "a-mgr"])
  assert.deepEqual(coreAccountIdsOf({ mode: "none" }), [])
})

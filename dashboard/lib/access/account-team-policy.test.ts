import { test } from "node:test"
import assert from "node:assert/strict"

import { TEAM_ROLES, teamMembershipFrom, teamRoleLabel } from "./account-team-policy.ts"

const ME = "me-1"
const ME_DUP = "me-2" // the same person's second CRM record
const SOMEONE_ELSE = "other-1"

const accounts = [
  { account_id: "a-mgr", sales_lead_primary_id: ME },
  { account_id: "a-secondary", secondary_manager_id: ME },
  { account_id: "a-feedback", feedback_report_id: ME },
  { account_id: "a-associate", associate_id: ME },
  { account_id: "a-memo", teaser_id: ME },
  { account_id: "a-logistics", logistics_coordinator_id: ME },
  { account_id: "a-dup-record", feedback_report_id: ME_DUP },
  { account_id: "a-theirs", sales_lead_primary_id: SOMEONE_ELSE },
  { account_id: "a-unstaffed" },
]

test("all SIX roles confer membership — including feedback and memo", () => {
  // The whole reason this resolver exists: the four-role account_mgmt scope
  // would drop a-feedback and a-memo, hiding a feedback owner's own alerts.
  const { accountIds } = teamMembershipFrom(accounts, new Set([ME]))
  assert.deepEqual(
    [...accountIds].sort(),
    ["a-associate", "a-feedback", "a-logistics", "a-memo", "a-mgr", "a-secondary"],
  )
})

test("memo reads accounts.teaser_id", () => {
  // public.accounts has no memo column; teaser is the established mapping.
  assert.equal(TEAM_ROLES.find((r) => r.key === "memo")?.idColumn, "teaser_id")
})

test("a person's duplicate CRM records are unioned", () => {
  const { accountIds } = teamMembershipFrom(accounts, new Set([ME, ME_DUP]))
  assert.ok(accountIds.has("a-dup-record"))
  assert.equal(accountIds.size, 7)
})

test("other people's accounts and unstaffed accounts are excluded", () => {
  const { accountIds } = teamMembershipFrom(accounts, new Set([ME]))
  assert.equal(accountIds.has("a-theirs"), false)
  assert.equal(accountIds.has("a-unstaffed"), false)
})

test("an empty id set matches nothing (fail-closed)", () => {
  const { accountIds } = teamMembershipFrom(accounts, new Set())
  assert.equal(accountIds.size, 0)
})

test("every role held on one account is reported, for the row chip", () => {
  const both = [{ account_id: "a-both", sales_lead_primary_id: ME, teaser_id: ME }]
  const { rolesByAccount } = teamMembershipFrom(both, new Set([ME]))
  assert.deepEqual(rolesByAccount.get("a-both"), ["account_manager", "memo"])
  assert.equal(teamRoleLabel("account_manager"), "Acct mgr")
  assert.equal(teamRoleLabel("memo"), "Memo")
})

test("a non-string account_id is skipped rather than keyed on", () => {
  const junk = [{ account_id: null, sales_lead_primary_id: ME }]
  const { accountIds } = teamMembershipFrom(junk, new Set([ME]))
  assert.equal(accountIds.size, 0)
})

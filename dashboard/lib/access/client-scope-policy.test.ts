import { test } from "node:test"
import assert from "node:assert/strict"

import { decideClientScope } from "./client-scope-policy.ts"

const NONE = {
  all: false,
  accountMgmt: false,
  booker: false,
  host: false,
  feedback: false,
}

test("Account-Management user sees ONLY their account-team clients", () => {
  const scope = decideClientScope({ ...NONE, accountMgmt: true }, ["acc-1", "acc-2"])
  assert.ok(scope instanceof Set)
  assert.deepEqual([...scope].sort(), ["acc-1", "acc-2"])
})

test("user with NO scopes sees no clients (empty set)", () => {
  const scope = decideClientScope({ ...NONE }, [])
  assert.ok(scope instanceof Set)
  assert.equal(scope.size, 0)
})

test("All (or Super User) sees everything — null (no filter)", () => {
  assert.equal(decideClientScope({ ...NONE, all: true }, null), null)
  // `all` wins even if account-team ids were computed.
  assert.equal(decideClientScope({ ...NONE, all: true, accountMgmt: true }, ["x"]), null)
})

test("fail-closed: unresolved user_id denies (empty set, never null)", () => {
  const scope = decideClientScope({ ...NONE, accountMgmt: true }, null)
  assert.ok(scope instanceof Set)
  assert.equal(scope.size, 0)
})

test("Account-Management user on no teams sees none (empty set)", () => {
  const scope = decideClientScope({ ...NONE, accountMgmt: true }, [])
  assert.ok(scope instanceof Set)
  assert.equal(scope.size, 0)
})

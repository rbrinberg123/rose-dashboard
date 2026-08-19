import { test } from "node:test"
import assert from "node:assert/strict"

import { decideClientScope, scopesFromRow } from "./client-scope-policy.ts"

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

// --- Activation: the persisted user_data_scopes row drives enforcement --------

test("save→read round-trip: a persisted Account-Management row is honored by the loader decision", () => {
  // The row shape Admin → Users writes (bsmith: account_mgmt + meeting scopes).
  const persistedRow = {
    scope_all: false,
    account_mgmt: true,
    booker: true,
    host: true,
    feedback: true,
    // Row scopes carry the field-level Financials grant too; it must NOT
    // change any row decision (see financials-policy.test.ts).
    financials: false,
  }
  const scopes = scopesFromRow(persistedRow)
  assert.deepEqual(scopes, {
    all: false,
    accountMgmt: true,
    booker: true,
    host: true,
    feedback: true,
    financials: false,
  })
  // With a scope assigned, the user sees exactly their scoped account ids.
  const scope = decideClientScope(scopes, ["acc-1", "acc-2", "acc-3"])
  assert.deepEqual([...scope].sort(), ["acc-1", "acc-2", "acc-3"])
})

test("deny-by-default: a missing row (nobody assigned) → sees none", () => {
  const scope = decideClientScope(scopesFromRow(null), ["acc-1"])
  assert.ok(scope instanceof Set)
  assert.equal(scope.size, 0) // account_mgmt is false → no client rows
})

test("meeting-only assignment (no account_mgmt) sees no CLIENT rows (client-level is deny)", () => {
  // jlaverty-style: booker/host/feedback only, account_mgmt false.
  const scopes = scopesFromRow({ account_mgmt: false, booker: true, host: true, feedback: true })
  assert.equal(decideClientScope(scopes, ["acc-1", "acc-2"]).size, 0)
})

test("Super-bypass lockout guard: an `all` row → null (sees everything), never denied", () => {
  const scopes = scopesFromRow({ scope_all: true })
  assert.equal(scopes.all, true)
  assert.equal(decideClientScope(scopes, []), null)
})

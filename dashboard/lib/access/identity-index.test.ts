import { test } from "node:test"
import assert from "node:assert/strict"

import { buildIdentityIndex, classifyUser, fromUsersQuery } from "./identity-index.ts"

// 32 hex chars, then a human-looking suffix — a Dynamics-disabled/anonymized row.
const HASHED = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6dcooper@roseandco.com"

const ROWS = [
  { user_id: "u-scott", display_name: "Scott Grossman", email: "scott@roseandco.com" },
  // Simon Rose has two active records with different emails + ids (same person).
  { user_id: "u-simon-1", display_name: "Simon Rose", email: "simon@roseandco.com" },
  { user_id: "u-simon-2", display_name: "Simon Rose", email: "simonrose@roseandco.com" },
  // Disabled/anonymized (hashed local-part).
  { user_id: "u-hash", display_name: "Disabled Cooper", email: HASHED },
  // External / non-human domains.
  { user_id: "u-ext", display_name: "Ext Partner", email: "someone@sportradar.com" },
  { user_id: "u-ms", display_name: "MS Service", email: "svc@onmicrosoft.com" },
  // Shared/service @roseandco.com mailboxes.
  { user_id: "u-ga", display_name: "GA", email: "ga@roseandco.com" },
  { user_id: "u-conf", display_name: "Conference Room A", email: "conferencea@roseandco.com" },
]

test("scott resolves to exactly one person with a non-empty user_id set", () => {
  const idx = buildIdentityIndex(ROWS)
  const r = idx.resolve("Scott@RoseAndCo.com") // case-insensitive + trimmed
  assert.equal(r.state, "resolved")
  assert.equal(r.state === "resolved" && r.name, "Scott Grossman")
  assert.deepEqual(r.state === "resolved" && r.userIds, ["u-scott"])
})

test("a hashed/disabled email resolves to nothing — not a valid login, not a false duplicate", () => {
  const idx = buildIdentityIndex(ROWS)
  assert.equal(idx.resolve(HASHED).state, "no_match")
  assert.ok(!idx.roster.some((e) => e.userId === "u-hash"))
  assert.equal(classifyUser({ user_id: "x", display_name: "d", email: HASHED }).classification, "excluded")
})

test("a duplicated person resolves to a user_id set of size >= 2 covering both records", () => {
  const idx = buildIdentityIndex(ROWS)
  const r = idx.resolve("simon@roseandco.com")
  assert.equal(r.state, "resolved")
  assert.ok(r.state === "resolved" && r.userIds.length >= 2)
  assert.deepEqual(r.state === "resolved" && [...r.userIds].sort(), ["u-simon-1", "u-simon-2"])
  // the twin's other email resolves to the same union
  const r2 = idx.resolve("simonrose@roseandco.com")
  assert.deepEqual(r2.state === "resolved" && [...r2.userIds].sort(), ["u-simon-1", "u-simon-2"])
  assert.equal(idx.unionedPeople, 1)
})

test("external / @onmicrosoft.com addresses resolve to nothing and are never grantable roster people", () => {
  const idx = buildIdentityIndex(ROWS)
  assert.equal(idx.resolve("someone@sportradar.com").state, "no_match")
  assert.equal(idx.resolve("svc@onmicrosoft.com").state, "no_match")
  assert.ok(!idx.roster.some((e) => e.email.endsWith("@sportradar.com")))
  assert.ok(!idx.roster.some((e) => e.email.endsWith("@onmicrosoft.com")))
})

test("a shared/service mailbox is tagged in the roster but never resolvable", () => {
  const idx = buildIdentityIndex(ROWS)
  assert.equal(idx.resolve("ga@roseandco.com").state, "no_match")
  assert.equal(idx.resolve("conferencea@roseandco.com").state, "no_match")
  const ga = idx.roster.find((e) => e.email === "ga@roseandco.com")
  assert.ok(ga && ga.service === true)
})

test("a genuine no-match denies (no_match), distinct from a resolver error", () => {
  const idx = buildIdentityIndex(ROWS)
  assert.equal(idx.resolve("nobody@roseandco.com").state, "no_match")
})

test("a query error surfaces a LOUD resolver-error state, not an empty/all-deny index", () => {
  const errored = fromUsersQuery({
    data: null,
    error: { message: "column users.internalemailaddress does not exist" },
  })
  assert.equal(errored.ok, false)
  // A successful (even empty) query is ok:true — distinct from the error state.
  assert.equal(fromUsersQuery({ data: [], error: null }).ok, true)
})

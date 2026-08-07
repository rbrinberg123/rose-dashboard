import { test } from "node:test"
import assert from "node:assert/strict"

import { decideMeetingMode, meetingMatches } from "./meeting-scope-policy.ts"

// Twin user_ids for one person (same-name duplicate — must be unioned), plus a
// team account id.
const A = "brian-A"
const B = "brian-B"
const ACC = "acc-1"

function filter(over) {
  return {
    booker: false,
    host: false,
    feedback: false,
    accountMgmt: false,
    userIds: new Set([A, B]),
    accountIds: new Set([ACC]),
    ...over,
  }
}

test("decideMeetingMode: all → all, any checked → filter, nothing → none", () => {
  const base = { all: false, booker: false, host: false, feedback: false, accountMgmt: false }
  assert.equal(decideMeetingMode({ ...base, all: true }), "all")
  assert.equal(decideMeetingMode({ ...base }), "none")
  assert.equal(decideMeetingMode({ ...base, booker: true }), "filter")
  assert.equal(decideMeetingMode({ ...base, host: true }), "filter")
  assert.equal(decideMeetingMode({ ...base, feedback: true }), "filter")
  assert.equal(decideMeetingMode({ ...base, accountMgmt: true }), "filter")
})

test("Booker-only sees exactly meetings they booked", () => {
  const f = filter({ booker: true })
  assert.equal(meetingMatches({ booker_id: A }, f), true)
  assert.equal(meetingMatches({ host_id: A }, f), false) // hosted, not booked
  assert.equal(meetingMatches({ feedback_id: A }, f), false)
  assert.equal(meetingMatches({ booker_id: "someone-else" }, f), false)
})

test("Host-only sees exactly meetings they hosted; Feedback-only exactly assigned", () => {
  const host = filter({ host: true })
  assert.equal(meetingMatches({ host_id: A }, host), true)
  assert.equal(meetingMatches({ booker_id: A }, host), false)

  const fb = filter({ feedback: true })
  assert.equal(meetingMatches({ feedback_id: A }, fb), true)
  assert.equal(meetingMatches({ host_id: A }, fb), false)
})

test("Account-Management-only sees their clients' meetings but not unrelated ones", () => {
  const f = filter({ accountMgmt: true })
  assert.equal(meetingMatches({ client_account_id: ACC }, f), true)
  assert.equal(meetingMatches({ client_account_id: "acc-other" }, f), false)
  // hosts/books it but account_mgmt is the only scope → the person FKs don't count
  assert.equal(meetingMatches({ host_id: A, client_account_id: "acc-other" }, f), false)
})

test("union: a meeting owned by the TWIN record is visible (the 3 bsmith case)", () => {
  const f = filter({ host: true }) // userIds = {A, B}
  assert.equal(meetingMatches({ host_id: B }, f), true) // twin-owned → still visible
  assert.equal(meetingMatches({ host_id: A }, f), true)
})

test("OR logic: a meeting matching ANY checked scope is visible", () => {
  const f = filter({ booker: true, host: true, feedback: true, accountMgmt: true })
  assert.equal(meetingMatches({ feedback_id: B }, f), true) // only feedback matches
  assert.equal(meetingMatches({ client_account_id: ACC }, f), true) // only account matches
  assert.equal(
    meetingMatches({ booker_id: "x", host_id: "y", feedback_id: "z", client_account_id: "acc-other" }, f),
    false, // nothing matches
  )
})

test("null FK fields never match", () => {
  const f = filter({ booker: true, host: true, feedback: true, accountMgmt: true })
  assert.equal(
    meetingMatches({ booker_id: null, host_id: null, feedback_id: null, client_account_id: null }, f),
    false,
  )
})

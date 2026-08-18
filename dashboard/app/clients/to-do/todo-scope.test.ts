import { test } from "node:test"
import assert from "node:assert/strict"

import { decideTodoLoad, visibleTodoRows, canEditClientNote } from "./todo-scope.ts"

const row = (id: string | null) => ({ account_id: id, client_name: `client ${id}` })

// --- decideTodoLoad: what the loader queries ---------------------------------

test("no filter (all / Super User) → query every active client", () => {
  assert.deepEqual(decideTodoLoad(null), { mode: "all" })
})

test("empty scope → deny, never a wide-open query", () => {
  assert.deepEqual(decideTodoLoad(new Set<string>()), { mode: "deny" })
})

test("account-team scope → query is filtered to exactly those ids", () => {
  const load = decideTodoLoad(new Set(["acc-1", "acc-2"]))
  assert.equal(load.mode, "filter")
  assert.deepEqual(load.mode === "filter" ? [...load.accountIds].sort() : null, [
    "acc-1",
    "acc-2",
  ])
})

// --- visibleTodoRows: defence-in-depth re-filter ------------------------------

test("scoped user only sees their own clients' rows", () => {
  const rows = [row("acc-1"), row("acc-2"), row("acc-3")]
  const visible = visibleTodoRows(rows, new Set(["acc-2"]))
  assert.deepEqual(
    visible.map((r) => r.account_id),
    ["acc-2"],
  )
})

test("unscoped user sees every row", () => {
  const rows = [row("acc-1"), row("acc-2")]
  assert.equal(visibleTodoRows(rows, null).length, 2)
})

test("empty scope drops every row even if the query returned some", () => {
  const rows = [row("acc-1"), row("acc-2")]
  assert.deepEqual(visibleTodoRows(rows, new Set<string>()), [])
})

test("fail-closed: a row with no account id is hidden from a scoped user", () => {
  const rows = [row(null), row("acc-1")]
  const visible = visibleTodoRows(rows, new Set(["acc-1"]))
  assert.deepEqual(
    visible.map((r) => r.account_id),
    ["acc-1"],
  )
})

// --- canEditClientNote: the note WRITE gate -----------------------------------

test("note write is allowed for a client in the user's scope", () => {
  assert.equal(canEditClientNote(new Set(["acc-1"]), "acc-1"), true)
})

test("note write is REFUSED for a client outside the user's scope", () => {
  assert.equal(canEditClientNote(new Set(["acc-1"]), "acc-9"), false)
})

test("note write is refused outright when the scope is empty", () => {
  assert.equal(canEditClientNote(new Set<string>(), "acc-1"), false)
})

test("unscoped user may write a note for any client", () => {
  assert.equal(canEditClientNote(null, "acc-anything"), true)
})

test("a missing account id can never be written, even unscoped", () => {
  assert.equal(canEditClientNote(null, null), false)
  assert.equal(canEditClientNote(null, ""), false)
  assert.equal(canEditClientNote(new Set(["acc-1"]), undefined), false)
})

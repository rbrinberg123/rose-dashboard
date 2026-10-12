import { test } from "node:test"
import assert from "node:assert/strict"

import { validateNoteRequired } from "./create.ts"

const ok = {
  clientAccountId: "a",
  noteDate: "2026-10-12",
  reviewCycle: "Client Review October 2026",
  body: "All good.",
}

test("required: client, date, title (review cycle), note", () => {
  assert.deepEqual(validateNoteRequired(ok), {})
  assert.deepEqual(
    Object.keys(validateNoteRequired({ clientAccountId: null, noteDate: "", reviewCycle: "  ", body: "" })).sort(),
    ["body", "clientAccountId", "noteDate", "reviewCycle"],
  )
})

test("a malformed date is not a date", () => {
  assert.ok(validateNoteRequired({ ...ok, noteDate: "10/12/2026" }).noteDate)
})

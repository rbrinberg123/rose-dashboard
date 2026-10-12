import { test } from "node:test"
import assert from "node:assert/strict"

import { validateContactRequired } from "./create.ts"

test("required: first name, last name, client", () => {
  assert.deepEqual(validateContactRequired({ firstName: "Ada", lastName: "Lovelace", clientAccountId: "a" }), {})
  assert.deepEqual(
    Object.keys(validateContactRequired({ firstName: " ", lastName: "", clientAccountId: null })).sort(),
    ["clientAccountId", "firstName", "lastName"],
  )
})

test("one name is no longer enough", () => {
  assert.ok(validateContactRequired({ firstName: "Ada", lastName: "", clientAccountId: "a" }).lastName)
})

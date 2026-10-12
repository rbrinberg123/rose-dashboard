import { test } from "node:test"
import assert from "node:assert/strict"

import { TASK_TYPE_OPTIONS, validateTaskRequired } from "./create.ts"

const outreach = TASK_TYPE_OPTIONS[0]
const ok = { subject: "Send memo", typeCode: outreach.code, subtypeCode: outreach.subtypes[0].code }

test("required: subject, task type, task subtype", () => {
  assert.deepEqual(validateTaskRequired(ok), {})
  assert.deepEqual(
    Object.keys(validateTaskRequired({ subject: "  ", typeCode: null, subtypeCode: null })).sort(),
    ["subject", "subtypeCode", "typeCode"],
  )
  assert.ok(validateTaskRequired({ ...ok, typeCode: 1 }).typeCode)
})

test("subtype must belong to the picked type", () => {
  const other = TASK_TYPE_OPTIONS.find(
    (t) => t.code !== outreach.code && !t.subtypes.some((s) => s.code === outreach.subtypes[0].code),
  )!
  assert.ok(validateTaskRequired({ ...ok, typeCode: other.code }).subtypeCode)
})

test("client is optional — never a validation key", () => {
  const errors = validateTaskRequired({ subject: "", typeCode: null, subtypeCode: null })
  assert.ok(!("clientAccountId" in errors))
})

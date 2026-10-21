import { test } from "node:test"
import assert from "node:assert/strict"

import {
  actionStepSubject,
  TASK_SUBTYPE_REMINDER_GENERAL_CODE,
  TASK_TYPE_OPTIONS,
  TASK_TYPE_REMINDER_CODE,
  validateTaskRequired,
} from "./create.ts"

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

test("Reminder / General pre-fill codes are a valid type/subtype pair", () => {
  assert.deepEqual(
    validateTaskRequired({ subject: "x", typeCode: TASK_TYPE_REMINDER_CODE, subtypeCode: TASK_SUBTYPE_REMINDER_GENERAL_CODE }),
    {},
  )
})

test("actionStepSubject: first sentence, word-boundary cut with ellipsis", () => {
  assert.equal(actionStepSubject("Send the deck to Jim"), "Send the deck to Jim")
  assert.equal(actionStepSubject("Call CFO. Then follow up on Q3 numbers."), "Call CFO")
  assert.equal(actionStepSubject("  Send   memo\n to IR "), "Send memo to IR")
  assert.equal(actionStepSubject("Review v2.1 draft"), "Review v2.1 draft")
  const long = actionStepSubject("word ".repeat(40))
  assert.ok(long.length <= 80 && long.endsWith("…") && !long.includes(" …"))
})

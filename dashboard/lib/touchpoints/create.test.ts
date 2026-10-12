import { test } from "node:test"
import assert from "node:assert/strict"

import { TOUCH_CONTACT_TYPE_OPTIONS, TOUCH_TYPE_OPTIONS, validateTouchRequired } from "./create.ts"

const ok = {
  clientAccountId: "a",
  start: "2026-10-12T09:30",
  subject: "Intro call",
  typeCode: TOUCH_TYPE_OPTIONS[0].code,
  contactTypeCodes: [TOUCH_CONTACT_TYPE_OPTIONS[0].code],
}

test("required: client, date, subject, type, contact type", () => {
  assert.deepEqual(validateTouchRequired(ok), {})
  assert.deepEqual(
    Object.keys(
      validateTouchRequired({ clientAccountId: null, start: "", subject: "  ", typeCode: "", contactTypeCodes: [] }),
    ).sort(),
    ["clientAccountId", "contactTypeCodes", "start", "subject", "typeCode"],
  )
})

test("an unknown type code is not a type", () => {
  assert.ok(validateTouchRequired({ ...ok, typeCode: "1" }).typeCode)
})

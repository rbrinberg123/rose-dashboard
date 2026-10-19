import { test } from "node:test"
import assert from "node:assert/strict"

import { MARKETING_MEMO_TASK, marketingMemoDueDay, marketingMemoSubject } from "./marketing-memo.ts"
import { TASK_TYPE_OPTIONS } from "../tasks/create.ts"

test("due day is 7 days before the launch week", () => {
  assert.equal(marketingMemoDueDay("2026-11-16"), "2026-11-09")
})

test("due day crosses month and year boundaries", () => {
  assert.equal(marketingMemoDueDay("2026-12-03"), "2026-11-26")
  assert.equal(marketingMemoDueDay("2027-01-04"), "2026-12-28")
  assert.equal(marketingMemoDueDay("2028-03-06"), "2028-02-28")
})

test("no launch week → no due day", () => {
  assert.equal(marketingMemoDueDay(null), null)
  assert.equal(marketingMemoDueDay(""), null)
  assert.equal(marketingMemoDueDay("not a date"), null)
})

test("subject follows the Feedback Report pattern", () => {
  assert.equal(marketingMemoSubject("ZVZZT - Boston - 11/16"), "Marketing Memo – ZVZZT - Boston - 11/16")
  assert.equal(marketingMemoSubject(null), "Marketing Memo – (Unnamed event)")
})

test("uses the existing Outreach / Marketing Memo pair from the task options", () => {
  const type = TASK_TYPE_OPTIONS.find((t) => t.code === MARKETING_MEMO_TASK.typeCode)
  assert.equal(type?.label, MARKETING_MEMO_TASK.typeLabel)
  const sub = (type?.subtypes as readonly { code: number; label: string }[]).find(
    (s) => s.code === MARKETING_MEMO_TASK.subtypeCode,
  )
  assert.equal(sub?.label, MARKETING_MEMO_TASK.subtypeLabel)
})

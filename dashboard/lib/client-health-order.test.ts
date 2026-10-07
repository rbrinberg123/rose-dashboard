import { test } from "node:test"
import assert from "node:assert/strict"

import {
  categoryChanged,
  categoryOf,
  compareFirmOrder,
  FIRM_CATEGORY_ORDER,
  moveWithin,
  type FirmOrderRow,
} from "./client-health-order.ts"
import { HEALTH_RATINGS, ratingSeverity } from "./client-health-prompt.ts"

test("fixed category order: High risk → Monitor → Management / IR Change → Healthy", () => {
  assert.deepEqual([...FIRM_CATEGORY_ORDER], ["3", "2", "Management / IR Change", "1"])
  assert.deepEqual([...FIRM_CATEGORY_ORDER].sort(), [...HEALTH_RATINGS].sort())
})

test("the Rating column's risk sort agrees with the firm category order", () => {
  const bySeverity = [...HEALTH_RATINGS].sort((a, b) => (ratingSeverity(b) ?? 0) - (ratingSeverity(a) ?? 0))
  assert.deepEqual(bySeverity, [...FIRM_CATEGORY_ORDER])
})

const row = (clientName: string, effectiveRating: string | null, manualRank: number | null): FirmOrderRow => ({
  clientName,
  effectiveRating,
  manualRank,
})

test("category, then manual_rank NULLS LAST, then name", () => {
  const rows = [
    row("Zeta", "1", null),
    row("Alpha", "1", 2),
    row("Beta", "1", 1),
    row("Unrated Co", null, null),
    row("Mgmt Co", "Management / IR Change", null),
    row("Mon B", "2", null),
    row("Mon A", "2", null),
    row("Risky", "3", 5),
  ]
  assert.deepEqual(
    rows.sort(compareFirmOrder).map((r) => r.clientName),
    ["Risky", "Mon A", "Mon B", "Mgmt Co", "Beta", "Alpha", "Zeta", "Unrated Co"],
  )
})

test("categoryOf / categoryChanged", () => {
  assert.equal(categoryOf("3"), "3")
  assert.equal(categoryOf(null), null)
  assert.equal(categoryOf("4"), null)
  assert.equal(categoryChanged("2", "2"), false)
  assert.equal(categoryChanged("2", "3"), true)
  assert.equal(categoryChanged(null, "1"), true)
  assert.equal(categoryChanged("1", null), true)
  assert.equal(categoryChanged(null, null), false)
})

test("moveWithin moves up, down, and clamps", () => {
  const ids = ["a", "b", "c", "d"]
  assert.deepEqual(moveWithin(ids, "d", 0), ["d", "a", "b", "c"])
  assert.deepEqual(moveWithin(ids, "a", 2), ["b", "c", "a", "d"])
  assert.deepEqual(moveWithin(ids, "b", 99), ["a", "c", "d", "b"])
  assert.deepEqual(moveWithin(ids, "x", 0), ids)
})

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  CRITICAL_AFTER_DAYS,
  addDays,
  ageLabel,
  countsBySeverity,
  criticalCutoffDay,
  daysSince,
  severityForDays,
  sortAlertRows,
  storedDay,
  type AlertRow,
} from "./alerts-policy.ts"

const row = (over: Partial<AlertRow>): AlertRow => ({
  key: "k",
  severity: "blue",
  accountId: null,
  ticker: null,
  clientName: null,
  title: "t",
  meta: [],
  ageDays: null,
  sortAt: null,
  ...over,
})

// ---- the ten-day threshold -----------------------------------------------

test("more than 10 days is critical, 10 or fewer is attention", () => {
  assert.equal(CRITICAL_AFTER_DAYS, 10)
  assert.equal(severityForDays(11), "red")
  assert.equal(severityForDays(10), "yellow")
  assert.equal(severityForDays(0), "yellow")
})

test("an UNKNOWN age is attention, never critical", () => {
  // A blank CRM date is not evidence of lateness — flagging it red would cry
  // wolf on missing data.
  assert.equal(severityForDays(null), "yellow")
  assert.equal(severityForDays(undefined), "yellow")
})

test("age label singularises one day", () => {
  assert.equal(ageLabel(1), "1 day")
  assert.equal(ageLabel(16), "16 days")
  assert.equal(ageLabel(null), null)
})

// ---- ordering -------------------------------------------------------------

test("red rows sort first, then oldest first", () => {
  const sorted = sortAlertRows([
    row({ key: "y-3", severity: "yellow", ageDays: 3 }),
    row({ key: "r-12", severity: "red", ageDays: 12 }),
    row({ key: "y-9", severity: "yellow", ageDays: 9 }),
    row({ key: "r-40", severity: "red", ageDays: 40 }),
  ])
  assert.deepEqual(
    sorted.map((r) => r.key),
    ["r-40", "r-12", "y-9", "y-3"],
  )
})

test("informational rows sort soonest first (the Hosting order)", () => {
  const sorted = sortAlertRows([
    row({ key: "fri", sortAt: Date.parse("2026-09-25T09:00:00Z") }),
    row({ key: "wed", sortAt: Date.parse("2026-09-23T14:00:00Z") }),
    row({ key: "thu", sortAt: Date.parse("2026-09-24T10:00:00Z") }),
  ])
  assert.deepEqual(
    sorted.map((r) => r.key),
    ["wed", "thu", "fri"],
  )
})

test("severity outranks age across the whole section", () => {
  // A 1-day red still beats a 99-day yellow — the point of "red first".
  const sorted = sortAlertRows([
    row({ key: "y-99", severity: "yellow", ageDays: 99 }),
    row({ key: "r-1", severity: "red", ageDays: 1 }),
  ])
  assert.deepEqual(
    sorted.map((r) => r.key),
    ["r-1", "y-99"],
  )
})

test("counts tally every row, by severity", () => {
  const counts = countsBySeverity([
    row({ severity: "red" }),
    row({ severity: "red" }),
    row({ severity: "yellow" }),
    row({ severity: "blue" }),
  ])
  assert.deepEqual(counts, { red: 2, yellow: 1, blue: 1 })
})

// ---- dates ----------------------------------------------------------------

test("a stored +00 wall clock keeps its own calendar day", () => {
  // Not re-zoned: a 09:00+00 meeting is on that date, which is also its Eastern
  // date. Converting would wrongly walk it back a day.
  assert.equal(storedDay("2026-09-25T09:00:00+00:00"), "2026-09-25")
  assert.equal(storedDay("2026-08-25T04:00:00+00:00"), "2026-08-25")
  assert.equal(storedDay(null), null)
  assert.equal(storedDay("nonsense"), null)
})

test("daysSince counts whole days into the past", () => {
  assert.equal(daysSince("2026-08-25T04:00:00+00:00", "2026-09-22"), 28)
  assert.equal(daysSince("2026-09-22T00:00:00+00:00", "2026-09-22"), 0)
  // Future dates go negative, which is how the Hosting window is bounded.
  assert.equal(daysSince("2026-09-25T09:00:00+00:00", "2026-09-22"), -3)
  assert.equal(daysSince(null, "2026-09-22"), null)
})

test("the received-date rule lands exactly where the spec says", () => {
  // 2026-08-25 received, viewed on 2026-09-05 = 11 days → critical.
  assert.equal(severityForDays(daysSince("2026-08-25T04:00:00+00:00", "2026-09-05")), "red")
  // One day earlier is exactly 10 days → still only attention.
  assert.equal(severityForDays(daysSince("2026-08-25T04:00:00+00:00", "2026-09-04")), "yellow")
})

// ---- the badge's SQL cutoff must mean the same as the page's TS rule -------

test("criticalCutoffDay is exactly the severity rule, as a date predicate", () => {
  // The Alerts page scores each row with severityForDays(daysSince(...)); the
  // nav badge counts in SQL with `received_date < cutoff`. Two expressions of
  // one rule is how a badge and its page drift apart, so assert they agree on
  // every day across the boundary — including well either side of it.
  const today = "2026-09-22"
  const cutoff = criticalCutoffDay(today)
  for (let back = 0; back <= 30; back++) {
    const day = addDays(today, -back)
    const pageSaysRed = severityForDays(daysSince(day + "T04:00:00+00:00", today)) === "red"
    const sqlSaysRed = day < cutoff
    assert.equal(
      sqlSaysRed,
      pageSaysRed,
      `disagreement at ${day} (${back} days back): page=${pageSaysRed} sql=${sqlSaysRed}`,
    )
  }
})

test("the cutoff sits one day past the threshold", () => {
  // 2026-09-12 is 10 days back → yellow, so it must NOT be before the cutoff.
  // 2026-09-11 is 11 days back → red, so it must be.
  assert.equal(criticalCutoffDay("2026-09-22"), "2026-09-12")
  assert.equal("2026-09-12" < "2026-09-12", false)
  assert.equal("2026-09-11" < "2026-09-12", true)
})

test("addDays bounds the 7-day hosting window, across a month end", () => {
  assert.equal(addDays("2026-09-22", 7), "2026-09-29")
  assert.equal(addDays("2026-09-28", 7), "2026-10-05")
  assert.equal(addDays("2026-09-22", 0), "2026-09-22")
})

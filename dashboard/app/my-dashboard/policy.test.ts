import { test } from "node:test"
import assert from "node:assert/strict"

import {
  contractDaysToExpiry,
  contractTone,
  criticalDueBefore,
  criticalMeetingBefore,
  daysUntil,
  dueTone,
  feedbackDueDay,
  feedbackUrgency,
  isCritical,
  shiftDay,
  sortByDue,
  urgencyFor,
} from "./policy.ts"

const TODAY = "2026-10-07"

// ---- the urgency rule -----------------------------------------------------

test("past is overdue, today..+7 is this week, beyond or dateless is later", () => {
  assert.equal(urgencyFor("2026-10-06", TODAY), "overdue")
  assert.equal(urgencyFor("2026-10-07", TODAY), "week")
  assert.equal(urgencyFor("2026-10-14", TODAY), "week")
  assert.equal(urgencyFor("2026-10-15", TODAY), "later")
  assert.equal(urgencyFor(null, TODAY), "later")
})

test("a dated item floats up into this week as its date approaches", () => {
  // A PTO approval starting 2026-10-20: later today, this week from 10-13.
  assert.equal(urgencyFor("2026-10-20", TODAY), "later")
  assert.equal(urgencyFor("2026-10-20", "2026-10-13"), "week")
})

test("due tone follows the same buckets", () => {
  assert.equal(dueTone("2026-10-01", TODAY), "over")
  assert.equal(dueTone("2026-10-09", TODAY), "soon")
  assert.equal(dueTone("2026-12-01", TODAY), "plain")
  assert.equal(dueTone(null, TODAY), "plain")
})

test("sortByDue: dated ascending, dateless last", () => {
  const out = sortByDue([{ due: null }, { due: "2026-10-09" }, { due: "2026-10-01" }])
  assert.deepEqual(
    out.map((r) => r.due),
    ["2026-10-01", "2026-10-09", null],
  )
})

test("daysUntil is signed and whole", () => {
  assert.equal(daysUntil("2026-10-10", TODAY), 3)
  assert.equal(daysUntil("2026-10-04", TODAY), -3)
  assert.equal(daysUntil(null, TODAY), null)
})

// ---- feedback collection ------------------------------------------------

test("feedback is due 10 days after the meeting and never waits in later", () => {
  assert.equal(feedbackDueDay("2026-10-01"), "2026-10-11")
  // Yesterday's meeting: already due, so this week — not later.
  assert.equal(feedbackUrgency("2026-10-06", TODAY), "week")
  // Exactly 10 days ago: still this week (critical is MORE than 10).
  assert.equal(feedbackUrgency("2026-09-27", TODAY), "week")
  // 11 days ago: overdue.
  assert.equal(feedbackUrgency("2026-09-26", TODAY), "overdue")
  assert.equal(feedbackUrgency(null, TODAY), "week")
})

// ---- contracts ------------------------------------------------------------

test("a contract is expiring when its TERM END is within 0..90 days", () => {
  assert.equal(contractDaysToExpiry("2026-12-31", TODAY), 85)
  assert.equal(contractDaysToExpiry(TODAY, TODAY), 0)
  assert.equal(contractDaysToExpiry("2027-01-05", TODAY), 90)
  // Beyond 90 days, already past, or no term end → not listed.
  assert.equal(contractDaysToExpiry("2027-01-06", TODAY), null)
  assert.equal(contractDaysToExpiry("2026-10-06", TODAY), null)
  assert.equal(contractDaysToExpiry(null, TODAY), null)
})

test("contract expiry colour: ≤7 days red, ≤30 amber, else plain", () => {
  assert.equal(contractTone(0), "over")
  assert.equal(contractTone(7), "over")
  assert.equal(contractTone(8), "soon")
  assert.equal(contractTone(30), "soon")
  assert.equal(contractTone(31), "plain")
})

test("critical = 7+ days past due; plain overdue and dateless are not", () => {
  assert.equal(isCritical("2026-10-01", "2026-10-08"), true)
  assert.equal(isCritical("2026-09-01", "2026-10-08"), true)
  assert.equal(isCritical("2026-10-02", "2026-10-08"), false)
  assert.equal(isCritical("2026-10-08", "2026-10-08"), false)
  assert.equal(isCritical(null, "2026-10-08"), false)
})

test("badge cutoffs agree with the row flag, day by day", () => {
  for (let back = 0; back <= 40; back++) {
    const day = shiftDay(TODAY, -back)
    assert.equal(day < criticalDueBefore(TODAY), isCritical(day, TODAY), `due ${day}`)
    assert.equal(day < criticalMeetingBefore(TODAY), isCritical(feedbackDueDay(day), TODAY), `meeting ${day}`)
  }
})

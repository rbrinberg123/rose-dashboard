import { test } from "node:test"
import assert from "node:assert/strict"

import {
  businessDaysByYear,
  businessDaysList,
  detailsForPerson,
  isBusinessDay,
  nyseHolidays,
  categorize,
  computeOooSummary,
  isHalfDay,
  pivotByPerson,
  type OooRequest,
} from "./compute.ts"

// --- NYSE calendar ----------------------------------------------------------

test("the ten NYSE holidays land on their known 2026 dates", () => {
  const h = nyseHolidays(2026)
  assert.equal(h.size, 10)
  for (const d of [
    "2026-01-01", // New Year's Day (Thu)
    "2026-01-19", // MLK — 3rd Monday
    "2026-02-16", // Washington's Birthday — 3rd Monday
    "2026-04-03", // Good Friday
    "2026-05-25", // Memorial Day — last Monday
    "2026-06-19", // Juneteenth (Fri)
    "2026-07-03", // Independence Day observed — Jul 4 is a Saturday
    "2026-09-07", // Labor Day — 1st Monday
    "2026-11-26", // Thanksgiving — 4th Thursday
    "2026-12-25", // Christmas (Fri)
  ]) {
    assert.ok(h.has(d), `expected ${d} to be an NYSE holiday`)
  }
})

test("Good Friday is a holiday but Columbus Day and Veterans Day are not", () => {
  // The market/federal divergence the summary depends on.
  assert.equal(isBusinessDay("2026-04-03"), false) // Good Friday — market closed
  assert.equal(isBusinessDay("2026-10-12"), true) // Columbus Day — market open
  assert.equal(isBusinessDay("2026-11-11"), true) // Veterans Day — market open
})

test("a Saturday holiday is observed on the Friday before, a Sunday one on the Monday after", () => {
  assert.ok(nyseHolidays(2026).has("2026-07-03")) // Sat Jul 4 → Fri Jul 3
  assert.ok(nyseHolidays(2027).has("2027-12-24")) // Sat Dec 25 → Fri Dec 24
  assert.ok(nyseHolidays(2028).has("2028-07-04")) // Tue Jul 4 stays put
  assert.ok(nyseHolidays(2022).has("2022-06-20")) // Sun Jun 19 → Mon Jun 20
})

test("New Year's Day on a Saturday does NOT close the preceding Friday", () => {
  // The NYSE exception: Dec 31 2021 traded normally ahead of Sat Jan 1 2022.
  assert.equal(isBusinessDay("2021-12-31"), true)
  assert.ok(!nyseHolidays(2022).has("2021-12-31"))
})

test("Juneteenth is not a holiday before 2022", () => {
  assert.ok(!nyseHolidays(2021).has("2021-06-18"))
  assert.ok(nyseHolidays(2023).has("2023-06-19"))
})

// --- Business-day counting --------------------------------------------------

test("a Monday-to-Friday request is five business days, not seven", () => {
  const d = businessDaysByYear("2026-03-02", "2026-03-06")
  assert.deepEqual([...d], [[2026, 5]])
})

test("weekends never count", () => {
  assert.deepEqual([...businessDaysByYear("2026-03-07", "2026-03-08")], [])
})

test("the doc's worked example: Fri 3 Jul - Mon 6 Jul 2026 is one business day", () => {
  // Jul 3 = observed Independence Day, Jul 4-5 = weekend, only Mon Jul 6 counts.
  assert.deepEqual([...businessDaysByYear("2026-07-03", "2026-07-06")], [[2026, 1]])
})

test("a request straddling New Year splits across both years", () => {
  // The live 2025-12-29 .. 2026-01-02 row. Dec 29-31 = 3, Jan 1 = holiday, Jan 2 = 1.
  const d = businessDaysByYear("2025-12-29", "2026-01-02")
  assert.deepEqual([...d].sort(), [
    [2025, 3],
    [2026, 1],
  ])
})

test("an inverted range yields nothing rather than looping", () => {
  assert.deepEqual([...businessDaysByYear("2026-03-06", "2026-03-02")], [])
})

// --- Categories -------------------------------------------------------------

test("the four categories map from the six live request types", () => {
  assert.equal(categorize("Vacation"), "Time Off")
  assert.equal(categorize("Personal"), "Time Off")
  assert.equal(categorize("Other"), "Time Off")
  assert.equal(categorize("Remote Work"), "Remote")
  assert.equal(categorize("Sick Leave"), "Sick")
  assert.equal(categorize("Jury Duty"), "Jury Duty")
})

test("an unknown or missing request type falls through to Time Off", () => {
  assert.equal(categorize("Bereavement"), "Time Off")
  assert.equal(categorize(null), "Time Off")
})

// --- Half-day heuristic -----------------------------------------------------

test("half-day phrasings are detected", () => {
  assert.equal(isHalfDay("Half Day"), true)
  assert.equal(isHalfDay("Half day. Traveling for wedding."), true)
  assert.equal(isHalfDay("Requesting a half-day off (the afternoon)"), true)
  assert.equal(isHalfDay("I would like to take half a day if possible"), true)
  assert.equal(isHalfDay("taking a 1/2 day"), true)
  assert.equal(isHalfDay("out for half of Friday"), true)
})

test("a bare 'half' counts — including 'half marathon', a known over-match", () => {
  // The agreed rule matches a bare "half". This is the one live request where
  // that is wrong; it now counts 0.5 instead of 1. Documented, not accidental.
  assert.equal(isHalfDay("Flying down to Charleston on 1/30 for half marathon on Saturday."), true)
})

test("a comment with no half-day signal is a full day", () => {
  assert.equal(isHalfDay("Disney World!"), false)
  assert.equal(isHalfDay("Vacation request for trip to Spain !"), false)
})

test("a missing comment is not a half day", () => {
  assert.equal(isHalfDay(null), false)
  assert.equal(isHalfDay(""), false)
})

// --- The half-day rule: last business day = 0.5, the rest full -------------

test("businessDaysList drops weekends and holidays, keeping order", () => {
  // Thu Jul 2 2026 .. Tue Jul 7. Jul 3 = observed Independence Day, Jul 4-5 weekend.
  assert.deepEqual(businessDaysList("2026-07-02", "2026-07-07"), [
    "2026-07-02",
    "2026-07-06",
    "2026-07-07",
  ])
})

test("a single-business-day half-day request counts 0.5", () => {
  const { rows } = computeOooSummary([
    req({
      ooo_id: "a",
      start_date: "2026-04-16",
      end_date: "2026-04-16",
      description_comments: "Half day. Traveling for wedding.",
    }),
  ])
  assert.equal(rows[0].days, 0.5)
})

test("a multi-day half-day request is (business days - 1) full + 0.5", () => {
  // The live 2026-02-11..2026-02-14 case. Wed/Thu/Fri are business days, Sat is
  // not, so 3 business days → 2 full + 0.5 = 2.5. The OLD rule gave 0.5.
  const { rows } = computeOooSummary([
    req({
      ooo_id: "x",
      start_date: "2026-02-11",
      end_date: "2026-02-14",
      description_comments: "Half day on 2/11!",
    }),
  ])
  assert.equal(rows[0].days, 2.5)
})

test("the half lands on the last BUSINESS day, never a weekend or holiday", () => {
  // Mon Jun 29 .. Sun Jul 5 2026: business days are Mon-Thu plus Fri Jul 3?
  // No — Jul 3 is the observed Independence Day, and Jul 4-5 are the weekend.
  // So the last business day is Thu Jul 2, and it is the one that gets the 0.5.
  const days = businessDaysList("2026-06-29", "2026-07-05")
  assert.deepEqual(days, ["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"])
  const { rows } = computeOooSummary([
    req({
      ooo_id: "h",
      start_date: "2026-06-29",
      end_date: "2026-07-05",
      description_comments: "half day on the last one",
    }),
  ])
  assert.equal(rows[0].days, 3.5, "4 business days → 3 full + 0.5")
})

test("a multi-CALENDAR-day request with only one business day counts 0.5", () => {
  // Fri Jul 3 2026 is the observed holiday, Jul 4-5 the weekend — only Mon Jul 6
  // is a business day, so the single-day rule applies.
  const { rows } = computeOooSummary([
    req({
      ooo_id: "s",
      start_date: "2026-07-03",
      end_date: "2026-07-06",
      description_comments: "Half day",
    }),
  ])
  assert.equal(rows[0].days, 0.5)
})

test("a half-day request straddling New Year puts the 0.5 in the last day's year", () => {
  // 2025-12-29 .. 2026-01-02: Dec 29/30/31 full, Jan 1 is a holiday, Jan 2 is the
  // last business day and takes the half.
  const { rows } = computeOooSummary([
    req({
      ooo_id: "ny",
      start_date: "2025-12-29",
      end_date: "2026-01-02",
      description_comments: "half day to come back",
    }),
  ])
  assert.equal(rows.find((r) => r.year === 2025)?.days, 3)
  assert.equal(rows.find((r) => r.year === 2026)?.days, 0.5)
})

test("a half-day request with no business days at all contributes nothing", () => {
  const { rows, details } = computeOooSummary([
    req({
      ooo_id: "w",
      start_date: "2026-03-07",
      end_date: "2026-03-08",
      description_comments: "Half day",
    }),
  ])
  assert.deepEqual(rows, [])
  assert.deepEqual(details, [], "and it earns no row in the detail pane")
})

// --- The tally --------------------------------------------------------------

const req = (o: Partial<OooRequest> & { ooo_id: string }): OooRequest => ({
  requested_by_id: "p1",
  requested_by_name: "Ada Lovelace",
  start_date: null,
  end_date: null,
  request_type_label: "Vacation",
  description_comments: null,
  ...o,
})

test("days accumulate per person, year and category", () => {
  const { rows } = computeOooSummary([
    req({ ooo_id: "a", start_date: "2026-03-02", end_date: "2026-03-06" }), // 5 Time Off
    req({ ooo_id: "b", start_date: "2026-03-09", end_date: "2026-03-10" }), // 2 Time Off
    req({
      ooo_id: "c",
      start_date: "2026-03-11",
      end_date: "2026-03-11",
      request_type_label: "Sick Leave",
    }),
  ])
  const timeOff = rows.find((r) => r.category === "Time Off")
  assert.equal(timeOff?.days, 7)
  assert.equal(rows.find((r) => r.category === "Sick")?.days, 1)
})

test("rows with a missing or inverted date are skipped, not counted as zero", () => {
  const { rows, skipped } = computeOooSummary([
    req({ ooo_id: "a", start_date: null, end_date: "2026-03-06" }),
    req({ ooo_id: "b", start_date: "2026-03-06", end_date: "2026-03-02" }),
  ])
  assert.equal(rows.length, 0)
  assert.equal(skipped, 2)
})

test("a request falling entirely on weekends produces no row", () => {
  const { rows, years } = computeOooSummary([
    req({ ooo_id: "a", start_date: "2026-03-07", end_date: "2026-03-08" }),
  ])
  assert.deepEqual(rows, [])
  assert.deepEqual(years, [])
})

test("the same person under two names groups by id", () => {
  const { rows } = computeOooSummary([
    req({ ooo_id: "a", requested_by_name: "Ada Lovelace", start_date: "2026-03-02", end_date: "2026-03-02" }),
    req({ ooo_id: "b", requested_by_name: "Ada Byron", start_date: "2026-03-03", end_date: "2026-03-03" }),
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].days, 2)
})

// --- Detail pane ------------------------------------------------------------

test("details carry the per-request total, the half flag and the comment", () => {
  const { details } = computeOooSummary([
    req({
      ooo_id: "x",
      start_date: "2026-02-11",
      end_date: "2026-02-14",
      description_comments: "Half day on 2/11!",
    }),
    req({ ooo_id: "b", start_date: "2026-03-02", end_date: "2026-03-06" }),
  ])
  const x = details.find((d) => d.ooo_id === "x")
  assert.equal(x?.days, 2.5)
  assert.equal(x?.isHalf, true)
  assert.equal(x?.comment, "Half day on 2/11!")
  const b = details.find((d) => d.ooo_id === "b")
  assert.equal(b?.days, 5)
  assert.equal(b?.isHalf, false)
  assert.equal(b?.comment, null)
})

test("a request's pane total equals what it contributed to the tally", () => {
  // The pane and the table must never disagree.
  const input = [
    req({ ooo_id: "a", start_date: "2026-03-02", end_date: "2026-03-06" }),
    req({ ooo_id: "b", start_date: "2026-04-16", end_date: "2026-04-16", description_comments: "Half day" }),
    req({ ooo_id: "c", start_date: "2026-05-04", end_date: "2026-05-08", request_type_label: "Sick Leave" }),
  ]
  const { rows, details } = computeOooSummary(input)
  const tallyTotal = rows.reduce((a, r) => a + r.days, 0)
  const paneTotal = details.reduce((a, d) => a + d.days, 0)
  assert.equal(paneTotal, tallyTotal)
})

test("details are newest-first and group by year, newest year first", () => {
  const { details } = computeOooSummary([
    req({ ooo_id: "old", start_date: "2025-06-02", end_date: "2025-06-02" }),
    req({ ooo_id: "new", start_date: "2026-09-01", end_date: "2026-09-01" }),
    req({ ooo_id: "mid", start_date: "2026-03-02", end_date: "2026-03-02" }),
  ])
  assert.deepEqual(details.map((d) => d.ooo_id), ["new", "mid", "old"])

  const groups = detailsForPerson(details, "p1")
  assert.deepEqual(groups.map((g) => g.year), [2026, 2025])
  assert.deepEqual(groups[0].requests.map((r) => r.ooo_id), ["new", "mid"])
})

test("detailsForPerson returns only that person's requests", () => {
  const { details } = computeOooSummary([
    req({ ooo_id: "a", start_date: "2026-03-02", end_date: "2026-03-02" }),
    req({
      ooo_id: "b",
      requested_by_id: "p2",
      requested_by_name: "Grace Hopper",
      start_date: "2026-03-03",
      end_date: "2026-03-03",
    }),
  ])
  assert.deepEqual(detailsForPerson(details, "p2").flatMap((g) => g.requests.map((r) => r.ooo_id)), [
    "b",
  ])
  assert.deepEqual(detailsForPerson(details, "nobody"), [])
})

test("the pivot excludes Remote from the away total", () => {
  const { rows } = computeOooSummary([
    req({ ooo_id: "a", start_date: "2026-03-02", end_date: "2026-03-03" }), // 2 Time Off
    req({
      ooo_id: "b",
      start_date: "2026-03-04",
      end_date: "2026-03-05",
      request_type_label: "Remote Work",
    }), // 2 Remote
    req({
      ooo_id: "c",
      start_date: "2026-03-06",
      end_date: "2026-03-06",
      request_type_label: "Sick Leave",
    }), // 1 Sick
  ])
  const [p] = pivotByPerson(rows, 2026)
  assert.equal(p.byCategory["Time Off"], 2)
  assert.equal(p.byCategory.Remote, 2)
  assert.equal(p.byCategory.Sick, 1)
  assert.equal(p.totalAway, 3, "Remote is not absence")
})

// --- dashboard requests: exact per-day rows ---------------------------------

test("a dashboard request counts its own day rows, halves included", () => {
  const { rows, details } = computeOooSummary([
    req({
      ooo_id: "dash",
      start_date: "2026-03-02",
      end_date: "2026-03-04",
      // "half" in the comment must NOT trigger the heuristic — the days rule.
      description_comments: "half marathon",
      days: [
        { date: "2026-03-02", portion: "Full" },
        { date: "2026-03-03", portion: "AM" },
        { date: "2026-03-04", portion: "Full" },
      ],
    }),
  ])
  assert.equal(rows[0].days, 2.5)
  assert.equal(details[0].days, 2.5)
  assert.equal(details[0].isHalf, true)
})

test("a dashboard request ignores stray weekend / holiday day rows", () => {
  const { rows } = computeOooSummary([
    req({
      ooo_id: "dash2",
      start_date: "2026-07-02",
      end_date: "2026-07-06",
      days: [
        { date: "2026-07-02", portion: "PM" }, // Thu — 0.5
        { date: "2026-07-03", portion: "Full" }, // observed Independence Day — 0
        { date: "2026-07-04", portion: "Full" }, // Saturday — 0
        { date: "2026-07-06", portion: "Full" }, // Mon — 1
      ],
    }),
  ])
  assert.equal(rows[0].days, 1.5)
})

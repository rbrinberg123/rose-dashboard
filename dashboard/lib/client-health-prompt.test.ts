import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildHealthSystemPrompt,
  CLIENT_HEALTH_FRAMEWORK,
  HEALTH_OUTPUT_SCHEMA,
  HEALTH_RATINGS,
  isFrameworkConfigured,
  isHealthRating,
  parseHealthOutput,
  ratingSeverity,
} from "./client-health-prompt.ts"

test("the four allowed ratings, exactly", () => {
  assert.deepEqual([...HEALTH_RATINGS], ["1", "2", "3", "Management / IR Change"])
  assert.deepEqual([...HEALTH_OUTPUT_SCHEMA.properties.rating.enum], [...HEALTH_RATINGS])
})

test("isHealthRating rejects near-misses", () => {
  for (const r of HEALTH_RATINGS) assert.equal(isHealthRating(r), true)
  for (const bad of [1, "4", "0", "Management/IR Change", "management / ir change", "", null, " 1"]) {
    assert.equal(isHealthRating(bad), false, String(bad))
  }
})

test("parseHealthOutput accepts a valid object and trims", () => {
  assert.deepEqual(parseHealthOutput('{"rating":"2","note":"  Renewal due; engagement slowing.  "}'), {
    rating: "2",
    note: "Renewal due; engagement slowing.",
  })
  assert.deepEqual(parseHealthOutput('{"rating":"Management / IR Change","note":"New CFO."}')?.rating, "Management / IR Change")
})

test("parseHealthOutput rejects bad ratings, empty notes and non-JSON", () => {
  assert.equal(parseHealthOutput('{"rating":"4","note":"x"}'), null)
  assert.equal(parseHealthOutput('{"rating":2,"note":"x"}'), null)
  assert.equal(parseHealthOutput('{"rating":"1","note":"   "}'), null)
  assert.equal(parseHealthOutput('{"rating":"1"}'), null)
  assert.equal(parseHealthOutput("Rating: 1"), null)
})

test("system prompt = framework verbatim, then the JSON output instruction", () => {
  const p = buildHealthSystemPrompt()
  assert.ok(p.startsWith(CLIENT_HEALTH_FRAMEWORK))
  assert.match(p, /"rating"/)
})

test("the real framework is in place (route guard is open)", () => {
  assert.equal(isFrameworkConfigured(), true)
  assert.ok(CLIENT_HEALTH_FRAMEWORK.startsWith("You are conducting a client health and retention-risk review for Rose & Company"))
  assert.ok(CLIENT_HEALTH_FRAMEWORK.endsWith("Do not include any text outside the JSON object."))
})

test("risk severity orders 3 > Management / IR Change > 2 > 1; unrated is null", () => {
  const sorted = ["1", "Management / IR Change", "2", "3"].sort(
    (a, b) => (ratingSeverity(b) ?? 0) - (ratingSeverity(a) ?? 0),
  )
  assert.deepEqual(sorted, ["3", "Management / IR Change", "2", "1"])
  assert.equal(ratingSeverity(null), null)
  assert.equal(ratingSeverity("4"), null)
})

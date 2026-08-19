import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildClientDataBlock,
  buildSummaryFields,
  containsMoneyAmount,
  SUMMARY_SYSTEM_PROMPT,
} from "./client-summary-prompt.ts"

const SOURCE = {
  clientName: "Acme Corp",
  clientSince: "2021-03-01",
  lifetimeMeetings: 210,
  trailing12m: 42,
  upcomingConfirmed: 6,
  ltmUniqueInstitutions: 18,
  latestTermEnd: "2026-12-31",
  noteDate: "2026-07-14",
  noteText: "IR team is stable; new CFO starts in Q4.",
  noteStatus: "Stable",
  noteRiskDriver: null,
}

// --- what the model is allowed to see ---------------------------------------

test("the model is never given the retainer — no money field in its input", () => {
  const fields = buildSummaryFields(SOURCE)
  const keys = Object.keys(fields).join(" | ").toLowerCase()
  for (const word of ["retainer", "fee", "rate", "revenue", "usd", "dollar", "$"]) {
    assert.equal(keys.includes(word), false, `input field mentions "${word}"`)
  }
})

test("the rendered client-data block carries no dollar amount", () => {
  const block = buildClientDataBlock(buildSummaryFields(SOURCE))
  assert.equal(containsMoneyAmount(block), false)
  assert.equal(block.includes("$"), false)
})

test("renewal dates ARE still supplied — dates are not financials", () => {
  const block = buildClientDataBlock(buildSummaryFields(SOURCE))
  assert.ok(block.includes("Contract renewal date: 2026-12-31"))
  assert.ok(block.includes("Client since: 2021-03-01"))
})

test("a retainer supplied upstream cannot sneak in — the builder simply has no slot for it", () => {
  // Even if a caller passes extra money-ish properties, buildSummaryFields
  // returns a fixed field set, so nothing extra reaches the model.
  const fields = buildSummaryFields({
    ...SOURCE,
    // @ts-expect-error deliberately passing a field the type does not allow
    annualizedRetainer: 400_000,
  })
  assert.equal(JSON.stringify(fields).includes("400000"), false)
  assert.equal(containsMoneyAmount(buildClientDataBlock(fields)), false)
})

// --- the prompt rule (the backstop) -----------------------------------------

test("the system prompt forbids money amounts for everyone", () => {
  const p = SUMMARY_SYSTEM_PROMPT.toLowerCase()
  assert.ok(p.includes("never state any money amount"))
  for (const word of ["retainer", "fee", "rate", "revenue", "billing"]) {
    assert.ok(p.includes(word), `prompt should name "${word}" as forbidden`)
  }
  // ...while explicitly permitting dates.
  assert.ok(p.includes("contract dates are fine"))
  assert.ok(p.includes("renewal"))
})

// --- the tripwire that checks a generated summary ---------------------------

test("a freshly generated summary with no money amounts passes (renewal date allowed)", () => {
  const generated =
    "Acme Corp has been a client since March 2021, with 42 meetings in the trailing twelve months across 18 institutions and 6 confirmed upcoming. The most recent note, from July 2026, records the IR team as stable with a new CFO starting in Q4. The contract runs to December 31, 2026."
  assert.equal(containsMoneyAmount(generated), false)
})

test("the tripwire catches a summary that quotes a dollar figure", () => {
  const withSymbol =
    "Acme Corp holds a $400,000 annualized retainer and has met 18 institutions."
  const spelledOut =
    "Acme Corp's annualized retainer is 400,000 dollars across the current term."
  const compact = "The client is on a 1.2M USD contract renewing in December."
  const derived = "At a retainer of 400,000, that is roughly 9,500 per meeting."
  for (const t of [withSymbol, spelledOut, compact, derived]) {
    assert.equal(containsMoneyAmount(t), true, `should flag: ${t}`)
  }
})

test("the tripwire does not mistake dates or plain counts for money", () => {
  const dates =
    "The contract renews on 2026-12-31, extended from December 31, 2025. There were 42 meetings and 18 institutions in the last 12 months."
  assert.equal(containsMoneyAmount(dates), false)
  // A qualitative mention of the renewal, with no figure, is fine.
  assert.equal(
    containsMoneyAmount("The retainer renews in December 2026 under the same terms."),
    false,
  )
})

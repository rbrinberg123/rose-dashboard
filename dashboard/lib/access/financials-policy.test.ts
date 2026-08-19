import { test } from "node:test"
import assert from "node:assert/strict"

import {
  applyFinancialsGate,
  decideFinancials,
  financialsFromRow,
  omitFields,
  CLIENT_DETAIL_FINANCIAL_FIELDS,
  FINANCIALS_PERMISSION_KEY,
  PORTFOLIO_FINANCIAL_FIELDS,
} from "./financials-policy.ts"
import { decideClientScope, scopesFromRow } from "./client-scope-policy.ts"
import { decideMeetingMode } from "./meeting-scope-policy.ts"

const NO_GRANTS = { isSuper: false, userFlag: false, roleFlag: false }

// --- the decision -----------------------------------------------------------

test("Super User always sees financials, whatever the flags say", () => {
  assert.equal(decideFinancials({ ...NO_GRANTS, isSuper: true }), true)
  assert.equal(
    decideFinancials({ isSuper: true, userFlag: false, roleFlag: false }),
    true,
  )
})

test("granted user (per-person flag) sees financials", () => {
  assert.equal(decideFinancials({ ...NO_GRANTS, userFlag: true }), true)
})

test("granted role (Roles matrix) sees financials", () => {
  assert.equal(decideFinancials({ ...NO_GRANTS, roleFlag: true }), true)
})

test("deny-by-default: flag off and role ungranted → hidden", () => {
  assert.equal(decideFinancials(NO_GRANTS), false)
})

test("deny-by-default: unresolved identity (no role, no scope row) → hidden", () => {
  // An email that resolves to nothing yields no role (isSuper false, roleFlag
  // false) and no user_data_scopes row (financialsFromRow(null) === false).
  assert.equal(
    decideFinancials({
      isSuper: false,
      userFlag: financialsFromRow(null),
      roleFlag: false,
    }),
    false,
  )
})

test("a persisted row round-trips: financials true/false/missing", () => {
  assert.equal(financialsFromRow({ financials: true }), true)
  assert.equal(financialsFromRow({ financials: false }), false)
  assert.equal(financialsFromRow({ financials: null }), false)
  // Column not migrated yet → absent key → deny, never a crash.
  assert.equal(financialsFromRow({}), false)
  assert.equal(financialsFromRow(undefined), false)
})

test("the role-grant key is a data: key, never a page route", () => {
  assert.equal(FINANCIALS_PERMISSION_KEY, "data:financials")
  assert.ok(FINANCIALS_PERMISSION_KEY.startsWith("data:"))
  assert.ok(!FINANCIALS_PERMISSION_KEY.startsWith("/"))
})

// --- orthogonality: it is NOT a row scope -----------------------------------

test("Financials is orthogonal to row scoping — it never changes which rows are visible", () => {
  const rowScoped = scopesFromRow({ account_mgmt: true, financials: false })
  const rowScopedRich = scopesFromRow({ account_mgmt: true, financials: true })
  // Same client scope either way.
  assert.deepEqual(
    [...(decideClientScope(rowScoped, ["acc-1"]) as Set<string>)],
    [...(decideClientScope(rowScopedRich, ["acc-1"]) as Set<string>)],
  )
  // And Financials alone grants NO rows: money permission without row scope
  // still sees nothing.
  const financialsOnly = scopesFromRow({ financials: true })
  const scope = decideClientScope(financialsOnly, ["acc-1"])
  assert.ok(scope instanceof Set)
  assert.equal(scope.size, 0)
  assert.equal(decideMeetingMode({ ...financialsOnly }), "none")
})

// --- server-side omission ---------------------------------------------------

const PORTFOLIO_ROW = {
  account_id: "acc-1",
  name: "Acme Corp",
  quarterly_retainer: 25_000,
  annualized_retainer: 100_000,
  contract_url: "https://sharepoint/acme-contract.pdf",
  initial_term_end: "2026-12-31",
  days_to_expiry: 400,
  meetings_last_365d: 42,
}

const CLIENT_DETAIL_ROW = {
  account_id: "acc-1",
  client_name: "Acme Corp",
  ltm_meetings: 42,
  ltm_unique_institutions: 18,
  ltm_feedback_rate: 0.8,
  annualized_retainer: 100_000,
  dollars_per_meeting_ltm: 2_380,
  latest_term_end: "2026-12-31",
  days_to_renewal: 400,
}

test("granted viewer: Portfolio payload keeps the Retainer values and the contract doc link", () => {
  const [row] = applyFinancialsGate([PORTFOLIO_ROW], PORTFOLIO_FINANCIAL_FIELDS, true)
  assert.equal(row.annualized_retainer, 100_000)
  assert.equal(row.quarterly_retainer, 25_000)
  assert.equal(row.contract_url, "https://sharepoint/acme-contract.pdf")
})

test("ungranted viewer: Portfolio payload OMITS retainer + contract doc (keys absent, not null)", () => {
  const [row] = applyFinancialsGate([PORTFOLIO_ROW], PORTFOLIO_FINANCIAL_FIELDS, false)
  for (const f of PORTFOLIO_FINANCIAL_FIELDS) {
    assert.equal(f in row, false, `${f} must be absent from the payload`)
  }
  // Nothing else is touched — row scoping already decided which rows are here.
  assert.equal(row.name, "Acme Corp")
  assert.equal(row.meetings_last_365d, 42)
  assert.equal(row.initial_term_end, "2026-12-31")
  // And nowhere in the serialized payload does the amount survive.
  assert.equal(JSON.stringify(row).includes("100000"), false)
  assert.equal(JSON.stringify(row).includes("sharepoint"), false)
})

test("granted viewer: Client Detail keeps both financial KPI sources", () => {
  const [row] = applyFinancialsGate(
    [CLIENT_DETAIL_ROW],
    CLIENT_DETAIL_FINANCIAL_FIELDS,
    true,
  )
  assert.equal(row.annualized_retainer, 100_000)
  assert.equal(row.dollars_per_meeting_ltm, 2_380)
})

test("ungranted viewer: Client Detail OMITS the retainer AND the derived $/meeting", () => {
  const [row] = applyFinancialsGate(
    [CLIENT_DETAIL_ROW],
    CLIENT_DETAIL_FINANCIAL_FIELDS,
    false,
  )
  assert.equal("annualized_retainer" in row, false)
  // Derived from the retainer — leaving it would make the retainer recoverable.
  assert.equal("dollars_per_meeting_ltm" in row, false)
  // Dates and counts are NOT financials and stay.
  assert.equal(row.latest_term_end, "2026-12-31")
  assert.equal(row.days_to_renewal, 400)
  assert.equal(row.ltm_meetings, 42)
})

test("the gate never mutates the source row (the granted copy is unaffected)", () => {
  const source = { ...PORTFOLIO_ROW }
  applyFinancialsGate([source], PORTFOLIO_FINANCIAL_FIELDS, false)
  assert.equal(source.annualized_retainer, 100_000)
})

test("omitFields tolerates a field that isn't present", () => {
  const out = omitFields({ a: 1 }, ["b", "c"])
  assert.deepEqual(out, { a: 1 })
})

// --- the KPI reflow (the shape the Client Detail grid renders) ---------------

/**
 * The Client Detail KPI set, mirroring client-detail-view.tsx: the two money
 * tiles are spliced in only when granted. The grid sizes its columns to
 * tiles.length, so "6 or 4, never 6-with-holes" is the property under test.
 */
function kpiLabels(showFinancials: boolean): string[] {
  return [
    "Meetings (LTM / All-time)",
    "Institutions (LTM)",
    "Feedback Rec'd (LTM)",
    ...(showFinancials ? ["Annualized Retainer", "$ per Meeting"] : []),
    "Contract Renewal",
  ]
}

test("granted viewer sees all 6 KPI tiles, money included", () => {
  const labels = kpiLabels(true)
  assert.equal(labels.length, 6)
  assert.ok(labels.includes("Annualized Retainer"))
  assert.ok(labels.includes("$ per Meeting"))
})

test("ungranted viewer: the KPI row is 4 real tiles — no money, no empty placeholders", () => {
  const labels = kpiLabels(false)
  assert.equal(labels.length, 4)
  assert.ok(!labels.includes("Annualized Retainer"))
  assert.ok(!labels.includes("$ per Meeting"))
  // Every remaining slot is a real tile (no blanks left where money was), so
  // the grid's column count equals the tile count and they stretch evenly.
  assert.equal(labels.filter(Boolean).length, labels.length)
  assert.deepEqual(labels, [
    "Meetings (LTM / All-time)",
    "Institutions (LTM)",
    "Feedback Rec'd (LTM)",
    "Contract Renewal",
  ])
})

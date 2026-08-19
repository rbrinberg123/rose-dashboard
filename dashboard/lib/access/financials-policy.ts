/**
 * PURE "Financials" field-permission policy — no I/O, unit-testable (mirrors
 * client-scope-policy.ts / meeting-scope-policy.ts).
 *
 * Financials is a FIELD-LEVEL grant, deliberately ORTHOGONAL to row scoping:
 * row scoping (Account Mgmt / Booker / Host / Feedback) decides WHICH clients
 * and meetings a person sees; Financials decides whether that person may see
 * those clients' DOLLAR figures (retainer, $/meeting, the contract document).
 * It is never a row filter — a user with Financials and no row scope still sees
 * no rows, and a user with row scope and no Financials sees their rows with the
 * money fields absent from the payload.
 *
 * Deny-by-default: false unless the person is a Super User, or their
 * `user_data_scopes.financials` flag is on, or their ROLE has the Financials
 * data permission granted in the Roles matrix. An unresolved identity (no
 * email → no role, no scope row) therefore lands on false.
 *
 * The async orchestration (role lookup + the two table reads) lives in
 * ./financials.ts; this module is the decision + the field lists only, so it
 * runs without a database.
 */

/**
 * The key the ROLE-level Financials grant is stored under in
 * `public.role_page_access.route`. Deliberately NOT a real page route: it is
 * prefixed `data:` so it can never collide with a registered page, and
 * `getAllowedRoutes` (which filters through PAGE_REGISTRY) drops it rather than
 * ever treating it as a navigable page.
 */
export const FINANCIALS_PERMISSION_KEY = "data:financials"

/** Shape of the `financials` column on a `public.user_data_scopes` row. */
export type FinancialsScopeRow = { financials?: boolean | null }

/** Map the persisted column to the flag. A missing row → false (deny). */
export function financialsFromRow(
  row: FinancialsScopeRow | null | undefined,
): boolean {
  return !!row?.financials
}

/** The three independent inputs to the decision. */
export type FinancialsInputs = {
  /** The person's REAL role is super_user — always sees financials. */
  isSuper: boolean
  /** Their `user_data_scopes.financials` flag. */
  userFlag: boolean
  /** Their role's Financials grant from the Roles matrix. */
  roleFlag: boolean
}

/**
 * May this person see dollar figures? Super User always; otherwise the
 * per-person flag OR the per-role grant. Anything else — including an identity
 * we could not resolve to a role or a scope row — is false.
 */
export function decideFinancials(input: FinancialsInputs): boolean {
  if (input.isSuper) return true
  return input.userFlag || input.roleFlag
}

// ---------------------------------------------------------------------------
// The gated fields — one list per payload shape, so the loader and the tests
// agree on exactly what must be omitted.
// ---------------------------------------------------------------------------

/**
 * Money fields on a Portfolio row (`v_client_portfolio` + the page-side merges).
 * `contract_url` is the SharePoint contract document — the contract itself
 * carries the fee schedule, so the link is gated alongside the amounts.
 */
export const PORTFOLIO_FINANCIAL_FIELDS = [
  "annualized_retainer",
  "quarterly_retainer",
  "contract_url",
] as const

/**
 * Money fields on a Client Detail summary row (`v_client_detail_summary`).
 * `dollars_per_meeting_ltm` is DERIVED from the retainer, so it must be omitted
 * with it — otherwise the retainer is recoverable as $/meeting × meetings.
 */
export const CLIENT_DETAIL_FINANCIAL_FIELDS = [
  "annualized_retainer",
  "dollars_per_meeting_ltm",
] as const

/**
 * Return a copy of `row` with `fields` removed entirely — the keys are ABSENT,
 * not nulled, so an ungranted user's payload carries no trace of the value.
 * Used server-side before the row is handed to a Client Component.
 */
export function omitFields<T extends object>(
  row: T,
  fields: readonly string[],
): T {
  const out = { ...row } as Record<string, unknown>
  for (const f of fields) delete out[f]
  return out as T
}

/** `omitFields` over a list, applied only when the viewer is NOT granted. */
export function applyFinancialsGate<T extends object>(
  rows: T[],
  fields: readonly string[],
  canSeeFinancials: boolean,
): T[] {
  if (canSeeFinancials) return rows
  return rows.map((r) => omitFields(r, fields))
}

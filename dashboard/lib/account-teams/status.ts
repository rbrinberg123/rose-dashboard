/**
 * The DASHBOARD-OWNED per-client Active/Inactive flag — `public.account_status`.
 *
 * ══ SETUP ONLY — WIRED TO NOTHING ══════════════════════════════════════════
 * The only reader and writer of this flag is the toggle on
 * /admin/account-teams. It does not filter, hide, or change anything: not
 * Portfolio, not To-Do / Outreach Status, not Onboarding, not the CRM tables,
 * not scoping, and it appears in no query's WHERE clause.
 *
 * ══ IT IS NOT THE SAME THING AS accounts.state_label ═══════════════════════
 * It is SEEDED FROM `public.accounts.state_label` (the Dynamics statecode —
 * 'Active' 106 / 'Inactive' 122 across 228 accounts), and that CRM field is
 * still what every existing filter reads. `WHERE state_label = 'Active'`
 * appears about fifteen times in sql/03_views.sql (v_client_portfolio and
 * friends) and in app/institution-style/page.tsx — none of which know this
 * table exists.
 *
 * So the two can diverge the moment someone flips the toggle, and that
 * divergence is INERT by design: the owned flag records Rose's intent, the CRM
 * flag still drives the app. Reconciling them — pointing an existing view at
 * this table — is a separate, deliberate change and must not be done as a
 * drive-by.
 *
 * NOT seeded from `accounts.client_status_label`. That is a different Rose
 * business field (Current 89 / Past 71 / null 68) and it disagrees with the
 * Dynamics state on 33 accounts.
 */

/** How a status row got here. 'crm_seed' is re-writable by the seed; 'manual' is not. */
export const ACCOUNT_STATUS_SOURCES = ["crm_seed", "manual"] as const
export type AccountStatusSource = (typeof ACCOUNT_STATUS_SOURCES)[number]

/** One account's owned status, as the management page sees it. */
export type AccountStatus = {
  accountId: string
  isActive: boolean
  source: AccountStatusSource
  changedAt: string | null
  changedBy: string | null
}

/**
 * The status to show when the table has no row for an account.
 *
 * ABSENT means "nobody has recorded an opinion yet", which is what the seed
 * fills in. The page renders it as "Not set" rather than guessing Active —
 * guessing would make an unseeded database look like a deliberate all-active
 * decision, and the whole point of the row is that somebody chose.
 */
export const ACCOUNT_STATUS_UNSET = null

/** Narrow an arbitrary value to a known source, defaulting to the safer 'manual'. */
export function toAccountStatusSource(value: unknown): AccountStatusSource {
  return value === "crm_seed" ? "crm_seed" : "manual"
}

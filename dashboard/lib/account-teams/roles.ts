/**
 * The six account-team roles held in `public.account_team_members` — the
 * DASHBOARD-OWNED account team.
 *
 * ══ DO NOT CONFUSE THIS WITH lib/account-team.ts (SINGULAR) ════════════════
 * `lib/account-team.ts` is the EXISTING, LIVE thing: four roles read straight
 * off the `public.accounts` *_name columns, rendered as the avatar cluster on
 * Portfolio, Profiles and the Events table. It is unchanged and still the only
 * thing those pages read.
 *
 * THIS module (plural directory) describes the NEW owned table, which as of
 * 2026-09-15 is read and written by exactly one page — /admin/account-teams —
 * and by nothing else. It is deliberately NOT wired into `teamAccountIds`,
 * `resolveClientScope`, `lib/access/*`, or any CRM or reporting page.
 *
 * ── FORWARD INTENT (not implemented) ───────────────────────────────────────
 * This table is intended to become the source of truth for account-team-based
 * CRM visibility. When that happens it replaces the four *_name columns as the
 * team's definition, and `lib/account-team.ts` becomes a reader of it rather
 * than of `accounts`. Until that is a deliberate, separately-reviewed change,
 * NOTHING may import this module into a scope or permission path.
 */

/** The role keys, in the order the editor lays them out. */
export const ACCOUNT_TEAM_ROLE_KEYS = [
  "account_manager",
  "secondary_manager",
  "feedback_report",
  "associate",
  "memo",
  "logistics",
] as const

export type AccountTeamRole = (typeof ACCOUNT_TEAM_ROLE_KEYS)[number]

/**
 * Per-role display facts.
 *
 * `crmField` records WHERE THE SEED GOT IT — the accounts column each role was
 * seeded from. It is shown in the page's help text so the mapping is visible to
 * whoever is editing rather than buried in a migration, and it is the thing to
 * check first if a seeded assignee looks wrong.
 *
 * The colours extend the existing navy→teal cluster palette in
 * lib/account-team.ts so a person reads the same on both surfaces. The four
 * roles that exist in both keep their exact colours; Feedback and Memo take the
 * two remaining steps on the same ramp.
 */
export const ACCOUNT_TEAM_ROLE_META: Record<
  AccountTeamRole,
  { label: string; short: string; crmField: string; bg: string; fg: string }
> = {
  account_manager: {
    label: "Account Manager",
    short: "Acct mgr",
    crmField: "accounts.sales_lead_primary_id",
    bg: "#1E2858",
    fg: "#FFFFFF",
  },
  secondary_manager: {
    label: "Secondary Manager",
    short: "Secondary",
    crmField: "accounts.secondary_manager_id",
    bg: "#3D5599",
    fg: "#FFFFFF",
  },
  feedback_report: {
    label: "Feedback Report",
    short: "Feedback",
    crmField: "accounts.feedback_report_id",
    bg: "#2F6FA8",
    fg: "#FFFFFF",
  },
  associate: {
    label: "Associate",
    short: "Associate",
    crmField: "accounts.associate_id",
    bg: "#1C8C9C",
    fg: "#FFFFFF",
  },
  memo: {
    label: "Memo",
    short: "Memo",
    // MEMO = TEASER. public.accounts has no memo field — all 403 _raw keys were
    // searched. The evidence for teaser: the repo already maps the Events
    // drawer's "Memo Date" onto events.teaser_date (see lib/events/record.ts),
    // and the owners of the 1,092 "Marketing Memo" tasks are exactly the five
    // people holding accounts.teaser_id. Full reasoning in
    // sql/patches/2026-09-15_account_team_members.sql.
    crmField: "accounts.teaser_id  (memo = teaser)",
    bg: "#3AA6A0",
    fg: "#FFFFFF",
  },
  logistics: {
    label: "Logistics Coordinator",
    short: "Logistics",
    crmField: "accounts.logistics_coordinator_id",
    bg: "#4FC6BC",
    fg: "#0A3B36",
  },
}

/** Type guard for anything arriving from a client or a database row. */
export function isAccountTeamRole(value: unknown): value is AccountTeamRole {
  return (
    typeof value === "string" &&
    (ACCOUNT_TEAM_ROLE_KEYS as readonly string[]).includes(value)
  )
}

/** How a row got here. 'crm_seed' rows are re-writable by the seed; 'manual' are not. */
export const ACCOUNT_TEAM_SOURCES = ["crm_seed", "manual"] as const
export type AccountTeamSource = (typeof ACCOUNT_TEAM_SOURCES)[number]

/** One stored assignment, as the management page sees it. */
export type AccountTeamAssignment = {
  id: string
  accountId: string
  role: AccountTeamRole
  userId: string
  source: AccountTeamSource
  updatedAt: string | null
  updatedBy: string | null
}

/** A Rose employee offerable in the role dropdowns. */
export type RosterPerson = {
  userId: string
  name: string
  email: string
  /**
   * False for someone who still HOLDS a role but is no longer an active Rose
   * employee — 38 seeded rows are like this (Shawna Giust, Gary Farber, Simon
   * Willcocks, Douglas Cooper, Victoria Kemp-Sesny, Rosa Trivigno).
   *
   * They are NOT offered in the dropdown, but they must still RENDER as the
   * current assignee: blanking them would hide a real assignment and quietly
   * lose what the CRM says. The editor marks them "inactive" so they can be
   * reassigned deliberately.
   */
  active: boolean
}

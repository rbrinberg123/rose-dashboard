/**
 * The SIX-ROLE account-team membership rules — PURE, no I/O, so every
 * membership decision is unit-testable (see account-team-policy.test.ts).
 *
 * The resolver that reads the database and applies these lives beside it in
 * ./account-team-scope.ts. Same split as client-scope-policy / meeting-scope-
 * policy vs data-scope: the rules here, the queries there.
 *
 * ── WHY THIS EXISTS ALONGSIDE `teamAccountIds` IN ./data-scope.ts ──────────
 * `resolveClientScope` (Level-2 Account-Management scoping) reads FOUR roles:
 * sales lead, secondary manager, associate, logistics coordinator. That is the
 * right answer for Portfolio / Client Detail / Outreach Status, and it is
 * unchanged.
 *
 * The Alerts page (/clients/alerts) is about FEEDBACK work, and the two people
 * who own feedback work — the Feedback Report owner and the Memo owner — are
 * not in those four. Scoping Alerts to the four would hide a feedback owner's
 * own alerts from them. So Alerts deliberately uses a BROADER set: any of the
 * six roles below. Broader, and therefore never a way to see LESS than the
 * account_mgmt scope would show.
 *
 * ── SOURCE OF TRUTH: `public.accounts`, NOT `public.account_team_members` ──
 * Membership is read from the six FK columns on `public.accounts` — the LIVE
 * Dynamics mirror, refreshed by the nightly sync.
 *
 * `public.account_team_members` (the dashboard-owned table behind
 * /admin/account-teams) holds the same six roles and was seeded from these very
 * columns on 2026-09-15 — but it is a FROZEN SEED with no sync, and it has
 * already drifted: as of 2026-09-22 the CRM holds 812 (account, role, person)
 * assignments and the owned table holds 801, disagreeing on 51 of them (31
 * only in the CRM, 20 only in the table). An alert routed off a stale team
 * would reach the wrong person, so the live CRM columns win.
 *
 * lib/account-teams/roles.ts states plainly that NOTHING may import it into a
 * scope or permission path. This module honours that literally: it does not
 * import that module at all, and re-declares the six roles below. The
 * duplication is deliberate — when `account_team_members` becomes the real
 * source of truth, THIS map is the one place to repoint.
 */

/** The six team roles, in display order, with the `accounts` column each reads. */
export const TEAM_ROLES = [
  { key: "account_manager", label: "Acct mgr", idColumn: "sales_lead_primary_id" },
  { key: "secondary_manager", label: "Secondary", idColumn: "secondary_manager_id" },
  { key: "feedback_report", label: "Feedback", idColumn: "feedback_report_id" },
  { key: "associate", label: "Associate", idColumn: "associate_id" },
  // MEMO = TEASER. public.accounts has no memo column; the repo's established
  // mapping is accounts.teaser_id (see sql/patches/2026-09-15_account_team_members.sql).
  { key: "memo", label: "Memo", idColumn: "teaser_id" },
  { key: "logistics", label: "Logistics", idColumn: "logistics_coordinator_id" },
] as const

export type TeamRole = (typeof TEAM_ROLES)[number]["key"]

/** Human label for a role key, for the "your role on this account" chip. */
export function teamRoleLabel(role: TeamRole): string {
  return TEAM_ROLES.find((r) => r.key === role)?.label ?? role
}

/**
 * The resolved account-team scope:
 *   - `none`   → deny (unresolved or ambiguous email, resolver error, or the
 *                person holds none of the six roles anywhere).
 *   - `filter` → exactly these account ids, plus which role(s) the viewer holds
 *                on each (for the row's "your role" chip).
 *
 * Fails CLOSED on every error path, and logs loudly rather than silently
 * denying — the same contract as resolveClientScope / resolveMeetingScope.
 *
 * ── THERE IS NO `all` MODE, AND THAT IS THE POINT ──────────────────────────
 * Unlike ClientScope and MeetingScope, this type has no "see everything"
 * variant — not for `scope_all`, not for a Super User. Account-team membership
 * is a fact about the CRM: either you hold one of the six roles on a client or
 * you do not, and no role grant makes you a member of a team you are not on.
 *
 * Keeping an unreachable `all` variant here would be a loaded gun in a
 * permission type — the next caller to add a branch for it would silently
 * reintroduce the bypass. Removing it makes the compiler prove the bypass is
 * gone. If a page ever genuinely needs every account, it should say so with its
 * own unscoped query, not by asking this resolver for one.
 */
export type AccountTeamScope =
  | { mode: "none" }
  | { mode: "filter"; accountIds: Set<string>; rolesByAccount: Map<string, TeamRole[]> }

/**
 * PURE: given the six-column account rows and a person's unioned user_id set,
 * work out which accounts they are on the team for and in what role(s).
 * Separated from the I/O so it is unit-testable.
 */
export function teamMembershipFrom(
  accounts: readonly Record<string, unknown>[],
  userIds: ReadonlySet<string>,
): { accountIds: Set<string>; rolesByAccount: Map<string, TeamRole[]> } {
  const accountIds = new Set<string>()
  const rolesByAccount = new Map<string, TeamRole[]>()
  for (const a of accounts) {
    const id = a.account_id
    if (typeof id !== "string") continue
    const held: TeamRole[] = []
    for (const r of TEAM_ROLES) {
      const holder = a[r.idColumn]
      if (typeof holder === "string" && userIds.has(holder)) held.push(r.key)
    }
    if (held.length > 0) {
      accountIds.add(id)
      rolesByAccount.set(id, held)
    }
  }
  return { accountIds, rolesByAccount }
}

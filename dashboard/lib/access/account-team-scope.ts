import { getSupabaseServer } from "@/lib/supabase"
import type { EffectiveIdentity } from "@/lib/effective-identity"
import { loadIdentity } from "./identity"
import { TEAM_ROLES, teamMembershipFrom, type AccountTeamScope } from "./account-team-policy"

/**
 * The database side of the SIX-ROLE account-team membership resolver — the one
 * query, plus the fail-closed identity handling around it. The RULES it applies
 * (which six roles, which `accounts` column each reads, and how a person's
 * duplicate CRM records are unioned) live in ./account-team-policy.ts.
 *
 * Membership is read from `public.accounts` — the LIVE Dynamics mirror — and
 * NOT from `public.account_team_members`; the policy module explains why.
 */

export {
  TEAM_ROLES,
  teamMembershipFrom,
  teamRoleLabel,
  type AccountTeamScope,
  type TeamRole,
} from "./account-team-policy"


/**
 * Resolve the six-role account-team scope for the EFFECTIVE identity, so
 * "View as {person}" previews exactly what that person would see.
 *
 * NOTE this consults NO data-scope grant at all — not `account_mgmt`, and not
 * `scope_all`. Six-role team membership is a fact about the CRM, so it is read
 * only from the CRM:
 *
 *   - `account_mgmt` gates the FOUR-role Level-2 client scope. It is not read
 *     here on purpose, so a feedback or memo owner gets their own alerts
 *     without an admin having to tick Account Management for them.
 *   - `scope_all` (and Super User) is not read here either. There is no
 *     "see everything" answer to the question this resolver asks: no role
 *     grant puts a person on a team they are not on. A pure-admin Super User
 *     legitimately resolves to `none`.
 */
export async function resolveAccountTeamScope(
  user: Pick<EffectiveIdentity, "email">,
): Promise<AccountTeamScope> {
  const email = user.email
  if (!email) return { mode: "none" }

  const identity = await loadIdentity()
  if (!identity.ok) {
    console.error(
      "[account-team] identity resolver error — denying (fail-closed):",
      identity.error,
    )
    return { mode: "none" }
  }
  const res = identity.resolve(email)
  if (res.state === "no_match") return { mode: "none" }
  if (res.state === "ambiguous") {
    console.warn(
      `[account-team] ambiguous identity for ${email} — matches ${res.personCount} people; denying (fail-closed).`,
    )
    return { mode: "none" }
  }

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("accounts")
    .select(["account_id", ...TEAM_ROLES.map((r) => r.idColumn)].join(","))
  if (error || !data) {
    console.error(
      "[account-team] accounts six-role lookup failed — denying (fail-closed):",
      error?.message,
    )
    return { mode: "none" }
  }

  const { accountIds, rolesByAccount } = teamMembershipFrom(
    data as unknown as Record<string, unknown>[],
    new Set(res.userIds),
  )
  if (accountIds.size === 0) return { mode: "none" }
  return { mode: "filter", accountIds, rolesByAccount }
}

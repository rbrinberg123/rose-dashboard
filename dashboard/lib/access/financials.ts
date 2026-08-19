import { getSupabaseServer } from "@/lib/supabase"
import { getRealRole } from "@/lib/user-role"
import type { EffectiveIdentity } from "@/lib/effective-identity"
import { getUserScopes } from "./data-scope"
import {
  decideFinancials,
  FINANCIALS_PERMISSION_KEY,
} from "./financials-policy"

/**
 * The "Financials" field permission — may this person see dollar figures
 * (retainer, $/meeting, the contract document)?
 *
 * INDEPENDENT of row scoping. Row scoping decides which clients a person sees;
 * this decides whether those clients' money fields are in the payload at all.
 * The two compose: a person can have Account Mgmt without Financials (their
 * clients, no dollars) or Financials without Account Mgmt (dollars they never
 * get to see, because they have no rows).
 *
 * Granted when ANY of:
 *   - the person's REAL role is super_user (always — same lockout guard as
 *     getUserScopes: a super can never be locked out of their own data), or
 *   - their `user_data_scopes.financials` flag is on (Admin → Users), or
 *   - their ROLE has the Financials data permission (Admin → Roles), stored in
 *     `role_page_access` under the non-route key `data:financials`.
 *
 * DENY-BY-DEFAULT and fail-closed: no email, an identity that resolves to no
 * role and no scope row, or any query error → false (and the error is LOGGED,
 * never silent). Driven off the EFFECTIVE identity, so "View as {person}"
 * previews exactly what that person's money view looks like.
 */
export async function canSeeFinancials(
  user: Pick<EffectiveIdentity, "email">,
): Promise<boolean> {
  const email = user.email
  // Unresolved identity → deny. Nothing to look up, no row to trust.
  if (!email) return false

  const role = await getRealRole(email)
  if (role === "super_user") return true

  // Per-person flag. getUserScopes reads user_data_scopes and already fails
  // closed (a read error / missing row → all-deny), so this needs no extra
  // error handling here.
  const scopes = await getUserScopes(email)

  // Per-role grant from the Roles matrix. A person with no role can't have one.
  let roleFlag = false
  if (role) {
    const sb = getSupabaseServer()
    const { data, error } = await sb
      .from("role_page_access")
      .select("allowed")
      .eq("role", role)
      .eq("route", FINANCIALS_PERMISSION_KEY)
      .maybeSingle()
    if (error) {
      console.error(
        "[financials] role_page_access read failed for",
        role,
        "— denying the role grant (fail-closed):",
        error.message,
      )
    } else {
      roleFlag = !!data?.allowed
    }
  }

  return decideFinancials({ isSuper: false, userFlag: scopes.financials, roleFlag })
}

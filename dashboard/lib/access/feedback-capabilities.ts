import "server-only"

import { getSupabaseServer } from "@/lib/supabase"
import { getRealRole } from "@/lib/user-role"
import { hasSuperUserPrivileges } from "@/lib/access-control"
import { getUserScopes } from "./data-scope"
import {
  CLAIM_FEEDBACK_PERMISSION_KEY,
  MARK_FEEDBACK_RECEIVED_PERMISSION_KEY,
  NO_FEEDBACK_CAPABILITIES,
  decideFeedbackCapabilities,
  type FeedbackCapabilities,
} from "./feedback-capabilities-policy"

/**
 * The two feedback capabilities for one person — "Claim feedback report" and
 * "Mark feedback received" (see ./feedback-capabilities-policy.ts). Mirrors
 * canSeeFinancials (./financials.ts): super-user privileges → both; otherwise
 * the per-person user_data_scopes flags OR the role's Roles-matrix grants.
 *
 * DENY-BY-DEFAULT and fail-closed: no email → none; a role_page_access read
 * error denies the role grants (logged); getUserScopes already fails closed.
 * Pass the EFFECTIVE identity's email so "View as {person}" previews that
 * person's buttons (writes still refuse while impersonating).
 */
export async function loadFeedbackCapabilities(
  email: string | null | undefined,
): Promise<FeedbackCapabilities> {
  if (!email) return NO_FEEDBACK_CAPABILITIES
  const role = await getRealRole(email)
  if (hasSuperUserPrivileges(role)) {
    return decideFeedbackCapabilities({
      isSuper: true,
      userFlags: NO_FEEDBACK_CAPABILITIES,
      roleFlags: NO_FEEDBACK_CAPABILITIES,
    })
  }

  const scopes = await getUserScopes(email)

  const roleFlags = { ...NO_FEEDBACK_CAPABILITIES }
  if (role) {
    const { data, error } = await getSupabaseServer()
      .from("role_page_access")
      .select("route, allowed")
      .eq("role", role)
      .in("route", [CLAIM_FEEDBACK_PERMISSION_KEY, MARK_FEEDBACK_RECEIVED_PERMISSION_KEY])
    if (error) {
      console.error(
        "[feedback-capabilities] role_page_access read failed for",
        role,
        "— denying the role grants (fail-closed):",
        error.message,
      )
    } else {
      for (const r of (data ?? []) as { route: string; allowed: boolean | null }[]) {
        if (!r.allowed) continue
        if (r.route === CLAIM_FEEDBACK_PERMISSION_KEY) roleFlags.claimFeedback = true
        if (r.route === MARK_FEEDBACK_RECEIVED_PERMISSION_KEY) roleFlags.markFeedbackReceived = true
      }
    }
  }

  return decideFeedbackCapabilities({
    isSuper: false,
    userFlags: { claimFeedback: scopes.claimFeedback, markFeedbackReceived: scopes.markFeedbackReceived },
    roleFlags,
  })
}

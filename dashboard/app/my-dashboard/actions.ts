"use server"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { resolveAccountTeamScope } from "@/lib/access/account-team-scope"
import type { ClientOnboardingRow } from "@/lib/types"

/**
 * The onboarding card on My Dashboard (Onboarding feed → click a client). One
 * client's full row from v_client_onboarding — the nine steps, their dates,
 * the account team, start dates, first event and notes: everything a row on
 * the Onboarding page shows. Read-only.
 *
 * GATE: the Onboarding card's own scope — a client on the viewer's account
 * team (six-role membership, resolveAccountTeamScope, fail-closed). Super users
 * pass. Anything else is refused, so it can't read another team's client.
 */
export async function loadOnboardingDetail(accountId: string): Promise<ActionResult<ClientOnboardingRow>> {
  // ---- GATE (must stay first) ----
  if (!accountId) return fail("No client id.")
  const role = await getEffectiveRole()
  if (role !== "super_user") {
    if (!role) return fail("Not authorised.")
    const scope = await resolveAccountTeamScope(await getEffectiveIdentity())
    if (scope.mode !== "filter" || !scope.accountIds.has(accountId)) return fail("Not authorised.")
  }

  const { data, error } = await getSupabaseServer()
    .from("v_client_onboarding")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!data) return fail("This client is no longer onboarding.")
  return ok(data as unknown as ClientOnboardingRow)
}

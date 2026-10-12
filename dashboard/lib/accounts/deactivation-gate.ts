import "server-only"

import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { loadIdentity } from "@/lib/access/identity"
import { describeError } from "@/lib/actions"
import { isUuid } from "@/lib/crm-write"
import {
  deactivationAllowedForOrigin,
  type ClientDeactivationState,
} from "./deactivation"

/**
 * The SERVER-SIDE permission gate for deactivating / reactivating a client.
 * Every read and write goes through the service-role key (RLS bypassed), so
 * this is the only real gate — the UI merely hides the button.
 *
 * ══ WHO IS PERMISSIONED (widen / narrow HERE) ═══════════════════════════════
 *   1. Effective role `super_user` (there is no separate "admin" role), OR
 *   2. the client's PRIMARY MANAGER: `accounts.sales_lead_primary_id` is one of
 *      the viewer's user ids. "One of" because a person can carry several CRM
 *      user records — the same unioned id set the data-scope resolver uses
 *      (loadIdentity().resolve, lib/access/data-scope.ts). An unresolved or
 *      ambiguous identity fails closed.
 * AND the origin gate: deactivationAllowedForOrigin (DEACTIVATION_INCLUDES_DYNAMICS).
 * Writes additionally refuse while a super-user is in "View as" (same rule as
 * requireCrmWriter), so an impersonated session can preview but not act.
 */

/** Edit this to change who may deactivate. Kept as one function on purpose. */
async function isPermissioned(salesLeadPrimaryId: string | null): Promise<boolean> {
  const [role, identity] = await Promise.all([getEffectiveRole(), getEffectiveIdentity()])
  if (role === "super_user") return true
  if (!salesLeadPrimaryId) return false
  if (identity.userId && identity.userId === salesLeadPrimaryId) return true
  const index = await loadIdentity()
  if (!index.ok) return false
  const res = index.resolve(identity.email)
  return res.state === "resolved" && res.userIds.includes(salesLeadPrimaryId)
}

const STATE_COLUMNS =
  "account_id, name, origin, state_label, sales_lead_primary_id, deactivated_at, deactivated_by, deactivation_reason, reactivated_at, reactivated_by"

/** Message for a database that has not had the 2026-10-12b patch yet. */
export const DEACTIVATION_PATCH_MISSING =
  "Deactivation needs the 2026-10-12b account_deactivation SQL patch run first."

const isMissingColumn = (msg: string) => /deactivat|reactivat/i.test(msg) && /column|schema/i.test(msg)

/**
 * Read one client's deactivation state and decide what the EFFECTIVE viewer may
 * do. Returns an error string for an unknown id or a query failure.
 */
export async function loadDeactivationState(
  accountId: string,
): Promise<{ ok: true; state: ClientDeactivationState } | { ok: false; error: string }> {
  if (!isUuid(accountId)) return { ok: false, error: "Unknown client." }
  const { data, error } = await getSupabaseServer()
    .from("accounts")
    .select(STATE_COLUMNS)
    .eq("account_id", accountId)
    .maybeSingle()
  if (error) {
    const msg = describeError(error)
    return { ok: false, error: isMissingColumn(msg) ? DEACTIVATION_PATCH_MISSING : msg }
  }
  if (!data) return { ok: false, error: "Client not found." }
  const r = data as unknown as Record<string, string | null>

  const originOk = deactivationAllowedForOrigin(r.origin)
  const permitted = await isPermissioned(r.sales_lead_primary_id)
  const blockedReason = !originOk
    ? "Synced from Dynamics — deactivation is available for these clients after cutover."
    : !permitted
      ? "Only a super user or this client's primary manager can deactivate it."
      : null

  return {
    ok: true,
    state: {
      accountId: r.account_id as string,
      name: r.name,
      origin: r.origin,
      stateLabel: r.state_label,
      deactivatedAt: r.deactivated_at,
      deactivatedBy: r.deactivated_by,
      reason: r.deactivation_reason,
      reactivatedAt: r.reactivated_at,
      reactivatedBy: r.reactivated_by,
      canManage: blockedReason === null,
      blockedReason,
    },
  }
}

/**
 * The WRITE gate: the state above must allow it, and the session must not be
 * impersonating. Returns the actor's display name for the *_by stamp.
 */
export async function requireDeactivationWriter(
  accountId: string,
  verb: string,
): Promise<
  | { ok: true; state: ClientDeactivationState; actor: string }
  | { ok: false; error: string }
> {
  const identity = await getEffectiveIdentity()
  if (identity.impersonated) return { ok: false, error: `Exit “View as” before ${verb}.` }
  const res = await loadDeactivationState(accountId)
  if (!res.ok) return res
  if (!res.state.canManage) return { ok: false, error: res.state.blockedReason ?? "Not authorised." }
  return { ok: true, state: res.state, actor: identity.name ?? identity.email ?? "unknown" }
}

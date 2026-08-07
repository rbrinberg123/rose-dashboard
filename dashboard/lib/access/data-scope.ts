import { getSupabaseServer } from "@/lib/supabase"
import { getRealRole } from "@/lib/user-role"
import type { EffectiveIdentity } from "@/lib/effective-identity"
import { loadIdentity } from "./identity"
import {
  decideClientScope,
  type ClientScope,
  type UserScopes,
} from "./client-scope-policy"

export type { ClientScope, UserScopes } from "./client-scope-policy"

/**
 * Central Level-2 data-scope resolver for the CLIENT (Account-Management) pages.
 *
 * Driven off the EFFECTIVE identity (getEffectiveIdentity), so "View as {person}"
 * previews exactly what that person would see. Enforcement lives entirely in the
 * server loaders (the service-role key bypasses RLS, so the loader is the only
 * gate) — this module never touches proxy.ts, canAccessRoute, or getRealRole's
 * role gating; it only computes a client filter.
 *
 * Meeting-level scopes (booker/host/feedback) are Pass 2 and are read here but
 * not yet applied anywhere.
 */

const DENY_SCOPES: UserScopes = {
  all: false,
  accountMgmt: false,
  booker: false,
  host: false,
  feedback: false,
}

/**
 * Read a person's data scopes from `user_data_scopes` (keyed by lower-cased
 * email). A Super User is always `{ all: true }` regardless of any row. No row
 * (and not super) → all false (deny).
 */
export async function getUserScopes(
  email: string | null | undefined,
): Promise<UserScopes> {
  if (!email) return DENY_SCOPES

  // Super User → sees everything, no matter what the scopes table says.
  const role = await getRealRole(email)
  if (role === "super_user") return { ...DENY_SCOPES, all: true }

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("user_data_scopes")
    .select("scope_all, account_mgmt, booker, host, feedback")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle()
  if (error || !data) return DENY_SCOPES
  return {
    all: !!data.scope_all,
    accountMgmt: !!data.account_mgmt,
    booker: !!data.booker,
    host: !!data.host,
    feedback: !!data.feedback,
  }
}

/**
 * The `accounts.account_id`s where ANY of `userIds` is on the Account-Management
 * team: sales_lead_primary_id, secondary_manager_id, associate_id, or
 * logistics_coordinator_id. Owner is deliberately EXCLUDED. `userIds` is a
 * person's full (unioned) id set. Returns null on a query error (fail-closed).
 */
async function teamAccountIds(userIds: string[]): Promise<string[] | null> {
  if (userIds.length === 0) return []
  const sb = getSupabaseServer()
  const list = `(${userIds.join(",")})`
  const { data, error } = await sb
    .from("accounts")
    .select("account_id")
    .or(
      [
        `sales_lead_primary_id.in.${list}`,
        `secondary_manager_id.in.${list}`,
        `associate_id.in.${list}`,
        `logistics_coordinator_id.in.${list}`,
      ].join(","),
    )
  if (error || !data) {
    console.error("[data-scope] accounts team lookup failed:", error?.message)
    return null
  }
  const ids: string[] = []
  for (const a of data as { account_id: string | null }[]) {
    if (a.account_id) ids.push(a.account_id)
  }
  return ids
}

/**
 * Resolve the client filter for the effective identity. See decideClientScope
 * for the meaning of the return value (null = all, Set = only these, empty Set
 * = none).
 *
 * Fail-closed (always denies via empty Set, never null) when the email can't be
 * trusted: a genuine no-match, an ambiguous match (one email → >1 distinct
 * person), or a system resolver error. A resolver error is additionally LOGGED
 * at error level so a schema/query fault is loud, never a silent lockout.
 */
export async function resolveClientScope(
  user: Pick<EffectiveIdentity, "email">,
): Promise<ClientScope> {
  const email = user.email
  const scopes = await getUserScopes(email)

  // `all` (or super) → null; no client scope → empty Set. Neither needs I/O.
  if (scopes.all || !scopes.accountMgmt) return decideClientScope(scopes, [])

  // Account-Management scope: resolve the person's user_id set, then the
  // accounts ANY of those ids are on the team for.
  const identity = await loadIdentity()
  if (!identity.ok) {
    console.error("[data-scope] identity resolver error — denying (fail-closed):", identity.error)
    return decideClientScope(scopes, null)
  }
  const res = identity.resolve(email)
  if (res.state === "no_match") return decideClientScope(scopes, null)
  if (res.state === "ambiguous") {
    console.warn(
      `[data-scope] ambiguous identity for ${email} — matches ${res.personCount} people; denying (fail-closed).`,
    )
    return decideClientScope(scopes, null)
  }
  if (res.userIds.length > 1) {
    console.info(
      `[data-scope] unioned identity for ${email} → ${res.userIds.length} user_ids (duplicate CRM records).`,
    )
  }
  return decideClientScope(scopes, await teamAccountIds(res.userIds))
}

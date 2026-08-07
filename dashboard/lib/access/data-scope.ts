import { getSupabaseServer } from "@/lib/supabase"
import { getRealRole } from "@/lib/user-role"
import type { EffectiveIdentity } from "@/lib/effective-identity"
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
 * Resolve a login email to exactly one `users.user_id`, matching
 * case-insensitively + trimmed against BOTH `users.email` and
 * `users.internalemailaddress` (the same mapping the "Resolves?" indicator
 * shows). Returns null on zero OR multiple distinct matches — fail-closed:
 * an unmappable or ambiguous email must not be trusted.
 */
async function resolveUserId(email: string): Promise<string | null> {
  const e = email.trim().toLowerCase()
  if (!e) return null
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("users")
    .select("user_id, email, internalemailaddress")
  if (error || !data) return null
  const ids = new Set<string>()
  for (const u of data as {
    user_id: string
    email: string | null
    internalemailaddress: string | null
  }[]) {
    const em = u.email?.trim().toLowerCase()
    const ie = u.internalemailaddress?.trim().toLowerCase()
    if (em === e || ie === e) ids.add(u.user_id)
  }
  return ids.size === 1 ? [...ids][0] : null
}

/**
 * The `accounts.account_id`s where `userId` is on the Account-Management team:
 * sales_lead_primary_id, secondary_manager_id, associate_id, or
 * logistics_coordinator_id. Owner is deliberately EXCLUDED. Returns null on a
 * query error (fail-closed).
 */
async function teamAccountIds(userId: string): Promise<string[] | null> {
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("accounts")
    .select("account_id")
    .or(
      [
        `sales_lead_primary_id.eq.${userId}`,
        `secondary_manager_id.eq.${userId}`,
        `associate_id.eq.${userId}`,
        `logistics_coordinator_id.eq.${userId}`,
      ].join(","),
    )
  if (error || !data) return null
  const ids: string[] = []
  for (const a of data as { account_id: string | null }[]) {
    if (a.account_id) ids.push(a.account_id)
  }
  return ids
}

/**
 * Resolve the client filter for the effective identity. See decideClientScope
 * for the meaning of the return value (null = all, Set = only these, empty Set
 * = none). Fail-closed: an Account-Management user whose email can't resolve to
 * a single user_id gets an empty Set (deny), never null.
 */
export async function resolveClientScope(
  user: Pick<EffectiveIdentity, "email">,
): Promise<ClientScope> {
  const email = user.email
  const scopes = await getUserScopes(email)

  // `all` (or super) → null; no client scope → empty Set. Neither needs I/O.
  if (scopes.all || !scopes.accountMgmt) return decideClientScope(scopes, [])

  // Account-Management scope: resolve the user_id (fail-closed if it can't),
  // then the accounts they're on the team for.
  const userId = email ? await resolveUserId(email) : null
  if (!userId) return decideClientScope(scopes, null)
  return decideClientScope(scopes, await teamAccountIds(userId))
}

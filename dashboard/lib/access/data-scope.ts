import { getSupabaseServer } from "@/lib/supabase"
import { getRealRole } from "@/lib/user-role"
import type { EffectiveIdentity } from "@/lib/effective-identity"
import { loadIdentity } from "./identity"
import {
  decideClientScope,
  scopesFromRow,
  type ClientScope,
  type UserScopes,
} from "./client-scope-policy"
import {
  decideMeetingMode,
  meetingMatches,
  type MeetingRow,
  type MeetingScopeFilter,
} from "./meeting-scope-policy"

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
 * Client-level (Account Management) scoping is `resolveClientScope`; meeting-level
 * (Booker / Host / Feedback + account-team meetings) is `resolveMeetingScope`.
 * Both are driven off the same unioned identity and reuse `teamAccountIds`.
 */

const DENY_SCOPES: UserScopes = {
  all: false,
  accountMgmt: false,
  booker: false,
  host: false,
  feedback: false,
}

/**
 * Read a person's LIVE data scopes from `user_data_scopes` (keyed by lower-cased
 * email) — the same table the Admin → Users checkboxes write to.
 *
 * LOCKOUT GUARD: a Super User is ALWAYS `{ all: true }` regardless of any row
 * (short-circuits before the table read), so activating scope enforcement can
 * never lock a super out. No row (and not super) → all false (deny-by-default),
 * and that denial is LOGGED — never silent — so a mass "nobody assigned" state
 * is visible rather than a quiet global lockout.
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
  if (error) {
    console.error("[data-scope] user_data_scopes read failed for", email, "—", error.message)
    return DENY_SCOPES
  }
  if (!data) {
    console.warn(
      `[data-scope] no data-scope row for ${email} — denying by default (Level-2 scoping is LIVE; assign scopes on Admin → Users).`,
    )
    return DENY_SCOPES
  }
  return scopesFromRow(data)
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

// ---------------------------------------------------------------------------
// Meeting-level scoping (Booker / Host / Feedback + account-team meetings)
// ---------------------------------------------------------------------------

/**
 * The resolved meeting-scope for the effective identity — mirrors
 * `resolveClientScope` in structure:
 *   - `{ mode: "all" }`    → no filtering (Super User or `all` scope).
 *   - `{ mode: "none" }`   → deny (nothing checked, unresolved/ambiguous email,
 *                            or resolver error — never fails open).
 *   - `{ mode: "filter" }` → the id sets + which scopes to match; hand to
 *                            `filterVisibleMeetingIds` with the candidate
 *                            meeting ids from a page's view.
 */
export type MeetingScope =
  | { mode: "all" }
  | { mode: "none" }
  | ({ mode: "filter" } & MeetingScopeFilter)

export async function resolveMeetingScope(
  user: Pick<EffectiveIdentity, "email">,
): Promise<MeetingScope> {
  const email = user.email
  const scopes = await getUserScopes(email)
  const mode = decideMeetingMode(scopes)
  if (mode === "all") return { mode: "all" }
  if (mode === "none") return { mode: "none" }

  // filter: resolve the person's full unioned user_id set (fail-closed on any
  // untrusted identity), plus their team accounts if account_mgmt is checked.
  const identity = await loadIdentity()
  if (!identity.ok) {
    console.error("[data-scope] identity resolver error — denying meetings (fail-closed):", identity.error)
    return { mode: "none" }
  }
  const res = identity.resolve(email)
  if (res.state === "no_match") return { mode: "none" }
  if (res.state === "ambiguous") {
    console.warn(`[data-scope] ambiguous identity for ${email} — denying meetings (fail-closed).`)
    return { mode: "none" }
  }
  if (res.userIds.length > 1) {
    console.info(`[data-scope] unioned identity for ${email} → ${res.userIds.length} user_ids (meetings).`)
  }
  const accountIds = scopes.accountMgmt
    ? new Set((await teamAccountIds(res.userIds)) ?? [])
    : new Set<string>()
  return {
    mode: "filter",
    booker: scopes.booker,
    host: scopes.host,
    feedback: scopes.feedback,
    accountMgmt: scopes.accountMgmt,
    userIds: new Set(res.userIds),
    accountIds,
  }
}

/**
 * Given the candidate meeting ids from a page's view, return the subset the
 * scoped user may see. The views don't expose all of booker/host/feedback, so
 * we fetch those FK fields from `meetings` (chunked `.in` to stay under URL
 * limits) and apply the pure `meetingMatches` predicate. Fail-closed: a fetch
 * error denies (empty set), never opens.
 */
export async function filterVisibleMeetingIds(
  scope: MeetingScopeFilter,
  candidateMeetingIds: string[],
): Promise<Set<string>> {
  const allowed = new Set<string>()
  if (candidateMeetingIds.length === 0) return allowed
  const sb = getSupabaseServer()
  const CHUNK = 150
  for (let i = 0; i < candidateMeetingIds.length; i += CHUNK) {
    const chunk = candidateMeetingIds.slice(i, i + CHUNK)
    const { data, error } = await sb
      .from("meetings")
      .select("meeting_id, booker_id, host_id, feedback_id, client_account_id")
      .in("meeting_id", chunk)
    if (error) {
      console.error("[data-scope] meeting scope fetch failed — denying (fail-closed):", error.message)
      return new Set()
    }
    for (const m of (data ?? []) as (MeetingRow & { meeting_id: string })[]) {
      if (meetingMatches(m, scope)) allowed.add(m.meeting_id)
    }
  }
  return allowed
}

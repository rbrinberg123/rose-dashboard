/**
 * PURE Level-2 client-scope policy — no I/O, unit-testable.
 *
 * Given a user's data scopes and (for the Account-Management case) the set of
 * account ids their `users.user_id` is on the team for, decide the client filter
 * a loader should apply:
 *
 *   - `null`      → NO filter: see ALL clients (the user has `all`, or is a
 *                   Super User whose scopes resolve to `all`).
 *   - `Set<id>`   → see ONLY these client/account ids.
 *   - empty `Set` → see NOTHING.
 *
 * Fail-closed: pass `teamAccountIds = null` to signal the login email could NOT
 * be resolved to exactly one `users.user_id` — this returns an empty Set (deny),
 * never `null`. The async orchestration (reads + email→user_id resolution) lives
 * in ./data-scope.ts; this module is the decision only, so it can be tested
 * without a database.
 */

export type UserScopes = {
  all: boolean
  accountMgmt: boolean
  booker: boolean
  host: boolean
  feedback: boolean
}

/** A resolved client filter: `null` = no filter (see all), else the allowed set. */
export type ClientScope = Set<string> | null

export function decideClientScope(
  scopes: UserScopes,
  teamAccountIds: readonly string[] | null,
): ClientScope {
  if (scopes.all) return null // all / super → no filter
  if (!scopes.accountMgmt) return new Set<string>() // no client scope → see nothing
  if (teamAccountIds === null) return new Set<string>() // fail-closed: unresolved id
  return new Set<string>(teamAccountIds)
}

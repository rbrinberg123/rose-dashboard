/**
 * PURE Level-2 meeting-scope policy — no I/O, unit-testable (mirrors
 * client-scope-policy.ts). Decides whether a meeting is visible to a person
 * under their Booker / Host / Feedback / Account-Management scopes.
 *
 * OR logic: a meeting is visible if ANY checked scope matches. All person
 * matches use the person's FULL unioned `user_id` set (same union client scope
 * uses — a same-name duplicate's records must all count), and the
 * account-management match reuses the client resolver's team account ids.
 *
 * The async orchestration (identity resolution, team-account lookup, the
 * `meetings` fetch) lives in ./data-scope.ts; this module is the decision only,
 * so it runs without a database.
 */

/** The FK fields of a meeting the scope decision looks at. */
export type MeetingRow = {
  booker_id?: string | null
  host_id?: string | null
  feedback_id?: string | null
  client_account_id?: string | null
}

/** Which scopes are checked, plus the resolved id sets they match against. */
export type MeetingScopeFilter = {
  booker: boolean
  host: boolean
  feedback: boolean
  accountMgmt: boolean
  /** The person's full unioned user_id set (booker/host/feedback match these). */
  userIds: Set<string>
  /** The account ids the person is on the team for (accountMgmt matches these). */
  accountIds: Set<string>
}

/** Is `m` visible under `f`? True if ANY checked scope matches (OR). */
export function meetingMatches(m: MeetingRow, f: MeetingScopeFilter): boolean {
  if (f.booker && m.booker_id != null && f.userIds.has(m.booker_id)) return true
  if (f.host && m.host_id != null && f.userIds.has(m.host_id)) return true
  if (f.feedback && m.feedback_id != null && f.userIds.has(m.feedback_id)) return true
  if (f.accountMgmt && m.client_account_id != null && f.accountIds.has(m.client_account_id)) return true
  return false
}

export type MeetingMode = "all" | "none" | "filter"

/**
 * Decide the meeting-scope mode from a user's scopes:
 *   - `all`    → Super User or `all` scope → no filtering (see every meeting).
 *   - `filter` → at least one of booker/host/feedback/accountMgmt is checked.
 *   - `none`   → nothing checked → deny-by-default (see no meetings).
 */
export function decideMeetingMode(scopes: {
  all: boolean
  booker: boolean
  host: boolean
  feedback: boolean
  accountMgmt: boolean
}): MeetingMode {
  if (scopes.all) return "all"
  if (scopes.booker || scopes.host || scopes.feedback || scopes.accountMgmt) return "filter"
  return "none"
}

// Shared decision for the client<->institution meeting-history flags shown on
// the Live Outreach page AND in the email export, so the two can never drift.
//
// Rules (confirmed with the team):
//   prior == null  -> unknown (institution or client missing) -> no flag
//                     (does not occur in practice — every meeting resolves)
//   prior === 0    -> NEW (client has never met this institution)
//   prior >= 1     -> count circle showing the number of prior meetings,
//                     INCLUDING 1 (a single prior meeting shows "1", not blank)
//
// So every meeting gets exactly one flag: NEW or a count. "prior" = the count
// of OTHER 'Confirmed' meetings (ANY date) between this client and this
// institution, excluding the current meeting itself.
export type MeetingHistoryFlag = { isNew: boolean; count: number | null }

export function meetingHistoryFlag(
  prior: number | null | undefined,
): MeetingHistoryFlag {
  if (prior == null) return { isNew: false, count: null }
  if (prior === 0) return { isNew: true, count: null }
  return { isNew: false, count: prior } // 1+ prior → count circle (includes "1")
}

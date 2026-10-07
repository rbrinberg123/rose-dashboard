/**
 * PURE rules for feedback REPORTS (one event → 1–3 Feedback report tasks, each
 * owning a set of the event's meetings). No I/O, unit-tested in policy.test.ts.
 *
 * The database is authoritative — sql/patches/2026-10-07b_feedback_report_
 * automation.sql re-checks every rule inside feedback_report_set_assignments /
 * feedback_report_delete / feedback_report_create — this module exists so the
 * server action can return a clear message before the round-trip, and so the
 * panel can explain why Save or Delete is unavailable.
 *
 * See content/docs/27-feedback-reports.md.
 */

/** Most reports one event may be split into. */
export const MAX_REPORTS_PER_EVENT = 3

/**
 * Mirror of the DATABASE cutover switch feedback_automation_includes_dynamics()
 * (the authoritative one — the triggers read it). Used only to decide whether
 * the event drawer offers the Feedback reports panel. Flip BOTH at cutover.
 */
export const FEEDBACK_AUTOMATION_INCLUDES_DYNAMICS = false

export function isAutomationOrigin(origin: string | null | undefined): boolean {
  return origin === "dashboard" || (FEEDBACK_AUTOMATION_INCLUDES_DYNAMICS && origin === "dynamics")
}

/** 1 → "A", 2 → "B", 3 → "C". */
export function reportLetter(seq: number): string {
  return String.fromCharCode(64 + Math.max(1, Math.min(26, seq)))
}

/** Same rule as feedback_meeting_is_eligible() in SQL. */
export function isEligibleMeeting(status: string | null, state: string | null): boolean {
  return status !== "Cancelled" && (state ?? "Active") === "Active"
}

/** Feedback due = last meeting day + 10 (display/explain only — SQL computes it). */
export const FEEDBACK_DUE_AFTER_LAST_MEETING_DAYS = 10
/** Review task due = report close day + 2. */
export const REVIEW_DUE_AFTER_CLOSE_DAYS = 2

/**
 * Every eligible meeting assigned exactly once, only to one of the event's own
 * reports, and nothing else assigned. null = valid.
 */
export function validateAssignments(
  eligibleMeetingIds: readonly string[],
  reportIds: readonly string[],
  assignments: Readonly<Record<string, string>>,
): string | null {
  const reports = new Set(reportIds)
  const eligible = new Set(eligibleMeetingIds)
  const missing = eligibleMeetingIds.filter((id) => !assignments[id])
  if (missing.length > 0) {
    return `Every meeting must be assigned to a report (${missing.length} unassigned).`
  }
  for (const [meetingId, reportId] of Object.entries(assignments)) {
    if (!eligible.has(meetingId)) return "A cancelled or unknown meeting can't be assigned."
    if (!reports.has(reportId)) return "A meeting was assigned to a report that isn't on this event."
  }
  return null
}

export type DeletableReport = {
  taskId: string
  state: string | null
  claimed: boolean
}

/** May this report be deleted? null = yes. */
export function decideDeleteReport(report: DeletableReport, reportCount: number): string | null {
  if (reportCount <= 1) return "An event must keep at least one feedback report."
  if (report.claimed) return "This report is claimed — release it before deleting."
  if (report.state !== "Open") return "Only an open report can be deleted."
  return null
}

/** May another report be added? null = yes. */
export function decideAddReport(reportCount: number): string | null {
  return reportCount >= MAX_REPORTS_PER_EVENT
    ? `An event can have at most ${MAX_REPORTS_PER_EVENT} feedback reports.`
    : null
}

/**
 * The Feedback Received date picked on FB Coming Soon / the event drawer.
 * `day` is what <input type="date"> sends (YYYY-MM-DD); `todayEastern` is
 * today's Eastern calendar day. Today and any past real day are accepted; only
 * an empty, malformed / impossible, or future day is refused. null = valid.
 */
export function validateReceivedDay(day: string | null | undefined, todayEastern: string): string | null {
  const d = (day ?? "").trim()
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T00:00:00Z") : null
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d) {
    return "Pick a valid date."
  }
  if (d > todayEastern) return "The received date can't be in the future."
  return null
}

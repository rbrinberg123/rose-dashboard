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

// ---------------------------------------------------------------------------
// Per-meeting feedback flag + re-allocation LOCKS (2026-10-10)
// ---------------------------------------------------------------------------

/**
 * The meeting's OWN feedback state, from the definitive field
 * meetings.feedback_status_label (the one the Meetings table's single Feedback
 * column shows, and the one v_feedback_outstanding closes on).
 */
export type MeetingFeedbackFlag = { key: "not_in" | "waiting" | "no_feedback" | "in"; label: string }

export function meetingFeedbackFlag(status: string | null | undefined): MeetingFeedbackFlag {
  const s = (status ?? "").trim().toLowerCase()
  if (s.startsWith("closed") && s.includes("all in")) return { key: "in", label: "Feedback in" }
  if (s.startsWith("closed")) return { key: "no_feedback", label: "No feedback" }
  if (s.startsWith("awaiting")) return { key: "waiting", label: "Waiting" }
  return { key: "not_in", label: "Not in" }
}

/**
 * A report's re-allocation lock.
 *   "hard" — CLAIMED (claimed_by_id / bcs_claimed_by_id), or no longer Open
 *            (completed / cancelled): its meetings can't move out and nothing
 *            can be added, unless an admin overrides (audited).
 *   "warm" — all feedback in (Feedback Received Date set) but NOT claimed:
 *            re-allocation allowed after an explicit confirm.
 *   "none" — neither: freely editable, exactly as before.
 */
export type ReportLock = "hard" | "warm" | "none"

export type LockableReport = {
  taskId: string
  letter: string
  state: string | null
  claimed: boolean
  receivedDate: string | null
}

export function reportLock(r: Pick<LockableReport, "state" | "claimed" | "receivedDate">): ReportLock {
  if (r.claimed || r.state !== "Open") return "hard"
  if (r.receivedDate) return "warm"
  return "none"
}

export type ReallocationCheck = {
  /** Meetings that would leave or enter a hard-locked report. */
  hard: { meetingId: string; from: string | null; to: string | null }[]
  /** Letters of warm-locked reports a move would touch (from or to). */
  warmLetters: string[]
  /** Letters of hard-locked reports a move would touch. */
  hardLetters: string[]
}

/** Compare the saved mapping with a proposed one and classify every move. */
export function checkReallocation(
  reports: readonly LockableReport[],
  before: Readonly<Record<string, string | null>>,
  after: Readonly<Record<string, string>>,
): ReallocationCheck {
  const byId = new Map(reports.map((r) => [r.taskId, r]))
  const hard: ReallocationCheck["hard"] = []
  const warm = new Set<string>()
  const hardL = new Set<string>()
  for (const [meetingId, to] of Object.entries(after)) {
    const from = before[meetingId] ?? null
    if (from === to) continue
    for (const id of [from, to]) {
      const r = id ? byId.get(id) : undefined
      if (!r) continue
      const lock = reportLock(r)
      if (lock === "hard") hardL.add(r.letter)
      if (lock === "warm") warm.add(r.letter)
    }
    const fromLock = from && byId.get(from) ? reportLock(byId.get(from)!) : "none"
    const toLock = byId.get(to) ? reportLock(byId.get(to)!) : "none"
    if (fromLock === "hard" || toLock === "hard") hard.push({ meetingId, from, to })
  }
  return { hard, warmLetters: [...warm].sort(), hardLetters: [...hardL].sort() }
}

/** Server decision for a re-allocation. null = allowed. */
export function decideReallocation(
  check: ReallocationCheck,
  opts: { confirmWarm?: boolean; overrideLock?: boolean; isAdmin: boolean },
): string | null {
  if (check.hard.length > 0) {
    if (!opts.overrideLock) {
      return `Report ${check.hardLetters.join(" / ")} is claimed or closed — its meetings can't be moved and none can be added. An admin can override.`
    }
    if (!opts.isAdmin) return "Only an admin can override a claimed report's lock."
  }
  if (check.warmLetters.length > 0 && !opts.confirmWarm) {
    return `All feedback is in for Report ${check.warmLetters.join(" / ")} — confirm to reallocate anyway.`
  }
  return null
}

/**
 * Where a deleted report's meetings go: the first OTHER report that is not
 * hard-locked (not-yet-received first, then lowest sequence). null = every
 * other report is hard-locked.
 */
export function deleteTarget(reports: readonly (LockableReport & { seq: number })[], deletingId: string): string | null {
  const open = reports
    .filter((r) => r.taskId !== deletingId && reportLock(r) !== "hard")
    .sort((a, b) => Number(!!a.receivedDate) - Number(!!b.receivedDate) || a.seq - b.seq)
  return open[0]?.taskId ?? null
}

/**
 * PURE rules for setting a meeting's FEEDBACK STATUS (+ FB Received Date) from
 * the Feedback Collection page. No I/O — unit-tested in policy.test.ts; the
 * server action (app/feedback-collection/actions.ts) re-reads the meeting and
 * applies these before its guarded UPDATE.
 *
 * WHAT IT WRITES: the meeting's own existing columns — feedback_status_code /
 * feedback_status_label / fb_received_date — the same fields the dashboard
 * meeting form writes and every reader already uses. A Closed value takes the
 * meeting off v_feedback_outstanding (this page + the Outstanding Feedback
 * email). It does NOT touch the feedback REPORT task (no auto "received"), and
 * it does not move the event stage (that follows meeting dates).
 *
 * SCOPE: dashboard-origin meetings only. Dynamics-origin meetings stay
 * read-only until go-live (the sync would overwrite them).
 *
 * See content/docs/27-feedback-reports.md ("Feedback Collection").
 */

/** bcs_feedbackstatus — the exact stored values (checked live 2026-10-07). */
export const MEETING_FEEDBACK_STATUS_OPTIONS = [
  { code: 755860000, label: "Awaiting Additional" },
  { code: 755860002, label: "Closed - All in" },
  { code: 755860001, label: "Closed - No Feedback" },
] as const

export type MeetingFeedbackStatus = (typeof MEETING_FEEDBACK_STATUS_OPTIONS)[number]

export function feedbackStatusByCode(code: number | null | undefined): MeetingFeedbackStatus | null {
  return MEETING_FEEDBACK_STATUS_OPTIONS.find((o) => o.code === code) ?? null
}

/** A Closed value ends collection for the meeting. */
export function isClosedFeedbackStatus(label: string | null | undefined): boolean {
  return (label ?? "").startsWith("Closed")
}

/** The meeting facts the gate needs. */
export type FeedbackMeetingFacts = {
  origin: string | null
  meetingStatus: string | null
  state: string | null
  /** meetings.feedback_id — the named feedback person. */
  feedbackId: string | null
  hostId: string | null
}

/**
 * THE FEEDBACK REPRESENTATIVE for a meeting: its feedback person, else its host
 * — the same person v_feedback_outstanding shows as the row's owner.
 */
export function feedbackRepresentativeId(m: Pick<FeedbackMeetingFacts, "feedbackId" | "hostId">): string | null {
  return m.feedbackId ?? m.hostId ?? null
}

export type FeedbackActor = {
  /** Every users.user_id of the actor (duplicate CRM records unioned). */
  myIds: ReadonlySet<string>
  /** Super user. */
  isAdmin: boolean
}

/** Per-row facts the page computes server-side for the Feedback Collection table. */
export type FeedbackRowExtra = {
  origin: string | null
  /** The meeting's feedback REPORT task (feedback_report_meetings), if mapped. */
  reportTaskId: string | null
  /** YYYY-MM-DD or null. */
  fbReceivedDate: string | null
  /** This viewer may set status / date (decideSetMeetingFeedback passed). */
  canSet: boolean
}

export type FeedbackCollectionExtras = {
  byMeeting: Record<string, FeedbackRowExtra>
  /** Row shortcuts — offered only to viewers who may open those pages. */
  canOpenMeetings: boolean
  canOpenTasks: boolean
  /** Dynamics deep-link base for the meeting drawer. */
  crmBase: string | null
}

/** May this actor set this meeting's feedback status? null = yes. */
export function decideSetMeetingFeedback(m: FeedbackMeetingFacts, actor: FeedbackActor): string | null {
  if (m.origin !== "dashboard") return "This meeting is managed in Dynamics until go-live."
  if (m.meetingStatus !== "Confirmed" || (m.state ?? "Active") !== "Active") {
    return "Feedback can only be set on a confirmed, active meeting."
  }
  const rep = feedbackRepresentativeId(m)
  if (actor.isAdmin || (rep !== null && actor.myIds.has(rep))) return null
  return "Only the meeting's feedback representative or an admin can set its feedback."
}

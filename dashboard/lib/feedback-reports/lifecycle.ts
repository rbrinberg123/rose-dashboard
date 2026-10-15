/**
 * PURE rules for the feedback-report LIFECYCLE shown on the event drawer's
 * Meetings & Reports cards. No I/O; the server actions
 * (app/events/feedback-lifecycle-actions.ts) re-check the same rules on a
 * fresh read, so the card's buttons are only cosmetic.
 *
 * DERIVED from the two EXISTING tasks — there is no report entity and no
 * extra flag:
 *   collecting  Feedback task Open, no crdfa_feedback_received_date
 *               → step 1 "Collection" (action: Mark feedback all in)
 *   feedback_in Feedback task Open, received date set, unclaimed
 *               → step 1 done, waiting on step 2
 *   claimed     Feedback task Open and claimed — owner = the writer
 *   (feedback_in + claimed: the card shows the SHARED ownership buttons —
 *   Claim · Release · Assign/Reassign · Close — app/feedback-manager/
 *   claim-actions.tsx, exactly as on Feedback Reports; Close completes the
 *   Feedback task and needs someone assigned)
 *   review      Feedback task Completed; its "Feedback Report Sent" task Open,
 *               owner = the client's associate. It stays here until ready
 *               (action: Send = close the sent task)
 *   sent        the Feedback Report Sent task closed (Completed, or the
 *               closed_at sidecar) — the lifecycle is done.
 * A Feedback task closed any other way (Canceled) is "closed".
 *
 * See content/docs/27-feedback-reports.md → "Report lifecycle".
 */

export type LifecycleStage = "collecting" | "feedback_in" | "claimed" | "review" | "sent" | "closed"

/** The strip: four steps. */
export const LIFECYCLE_STEPS = [
  { key: "collection", label: "Collection" },
  { key: "claimed", label: "Claimed" },
  { key: "review", label: "Review" },
  { key: "sent", label: "Sent" },
] as const

/** The Feedback (report) task's fields the lifecycle needs. */
export type LifecycleReportTask = {
  state: string | null
  receivedDate: string | null
  claimedById: string | null
  claimedByName: string | null
  /** Who completed it (the writer's "Submit for review"). */
  closedByName: string | null
}

/** Its "Feedback Report Sent" task (review_of_task_id = the report), if any. */
export type LifecycleSentTask = {
  taskId: string
  state: string | null
  ownerId: string | null
  ownerName: string | null
  closedAt: string | null
  closedByName: string | null
  /** actual_end, else closed_at — when it was sent. */
  sentAt: string | null
}

export type LifecycleViewer = {
  myIds: ReadonlySet<string>
  isAdmin: boolean
  hasCapability: boolean
  /** Super user and NOT in "View as" — the requireCrmWriter gate. */
  crmWriter: boolean
  /** On this event's client's account team (any of the six roles). */
  onClientTeam: boolean
}

/** The card's own stage actions; ownership (Claim … Close) is ClaimActions. */
export type LifecycleAction = "mark_in" | "send"

export function deriveStage(report: LifecycleReportTask, sent: LifecycleSentTask | null): LifecycleStage {
  if (report.state === "Open") {
    if (report.claimedById) return "claimed"
    if (report.receivedDate) return "feedback_in"
    return "collecting"
  }
  if (report.state === "Completed") {
    if (sent && (sent.state !== "Open" || sent.closedAt)) return "sent"
    return "review"
  }
  return "closed"
}

/** Index into LIFECYCLE_STEPS of the CURRENT step (feedback in = waiting on Claimed). */
export function stageIndex(stage: LifecycleStage): number {
  switch (stage) {
    case "collecting":
      return 0
    case "feedback_in":
    case "claimed":
      return 1
    case "review":
      return 2
    case "sent":
      return 3
    default:
      return -1
  }
}

const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })
const day = (iso: string | null) => (iso ? DAY.format(new Date(iso)) : null)

/** The plain-language line naming the people at this stage. */
export function lifecycleNote(
  stage: LifecycleStage,
  report: LifecycleReportTask,
  sent: LifecycleSentTask | null,
): string {
  const writer = report.claimedByName ?? report.closedByName ?? "someone"
  const reviewer = sent?.ownerName ?? "no associate assigned"
  switch (stage) {
    case "collecting":
      return "Feedback not ready — mark all in once every meeting's feedback is back"
    case "feedback_in":
      return `Feedback all in${report.receivedDate ? ` · ${day(report.receivedDate)}` : ""} · ready to claim`
    case "claimed":
      return `Claimed by ${writer} · working`
    case "review":
      return sent ? `Worked by ${writer} · in review by ${reviewer}` : `Worked by ${writer} · review task not created yet`
    case "sent":
      return `Sent by ${sent?.closedByName ?? "someone"}${sent?.sentAt ? ` · ${day(sent.sentAt)}` : ""}`
    case "closed":
      return `Report ${report.state?.toLowerCase() ?? "closed"}`
  }
}

/** The ONE next action for this stage (null at the end). */
export function nextAction(stage: LifecycleStage, sent: LifecycleSentTask | null): LifecycleAction | null {
  switch (stage) {
    case "collecting":
      return "mark_in"
    case "review":
      return sent ? "send" : null
    default:
      return null
  }
}

/**
 * May this viewer take `action`? null = yes; otherwise the reason. Mirrors the
 * server checks (which also re-run the existing claim / close / account-team
 * gates):
 *   mark_in  the existing Mark received gate — super user, not in View as;
 *   send     decideSentClose — the sent task's owner (the associate) OR the
 *            client's account team OR hasSuperUserPrivileges; the same rule
 *            closeFeedbackReview enforces on every path.
 */
export function canAct(
  action: LifecycleAction,
  report: LifecycleReportTask,
  sent: LifecycleSentTask | null,
  v: LifecycleViewer,
): string | null {
  switch (action) {
    case "mark_in":
      return v.crmWriter ? null : "Only a CRM editor can mark feedback all in."
    case "send": {
      if (!sent) return "The review task doesn't exist yet."
      // MIRRORS decideSentClose (lib/feedback-claims/policy.ts) — the server
      // rule. Kept inline so this module stays import-free for node --test;
      // lifecycle.test.ts asserts the two always agree.
      const isOwner = !!sent.ownerId && v.myIds.has(sent.ownerId)
      if (isOwner || v.onClientTeam || v.isAdmin) return null
      return "Not authorised — only the associate, the client's account team, or an admin can send this report."
    }
  }
}

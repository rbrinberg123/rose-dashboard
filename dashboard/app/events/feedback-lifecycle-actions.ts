"use server"

import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { isUuid } from "@/lib/crm-write"
import { canViewEvent } from "@/lib/events/view-gate"
import { isAutomationOrigin } from "@/lib/feedback-reports/policy"
import { loadClaimViewer } from "@/lib/feedback-claims/server"
import type { LifecycleReportTask, LifecycleSentTask } from "@/lib/feedback-reports/lifecycle"
import { closeFeedbackReview, loadClaimControls } from "@/app/feedback-manager/actions"
import { loadEventFeedbackReports, type EventFeedbackReports } from "./feedback-report-actions"
import type { ClaimControls } from "@/lib/feedback-claims/types"
import { perfTimer } from "@/lib/perf-log"

/**
 * Event drawer → Meetings & Reports → the per-report LIFECYCLE card's own
 * stage actions: Mark feedback all in, and Send.
 *
 * Built ON the two existing tasks and the EXISTING actions — nothing here is a
 * parallel workflow:
 *   Mark all in       markFeedbackReceived (feedback-report-actions.ts; the card
 *                     uses the same MarkReceivedControl) — unchanged.
 *   Claim · Release · Assign/Reassign · Close — NOT here: the card renders the
 *                     SHARED ClaimActions (app/feedback-manager/claim-actions.tsx)
 *                     calling the Feedback Reports actions directly
 *                     (claimFeedbackTask … closeFeedbackTask), so both surfaces
 *                     behave and permission-gate identically. Claim / reassign
 *                     also make the assignee the task owner; Close needs someone
 *                     assigned, completes the Feedback task, and the database
 *                     trigger opens its "Feedback Report Sent" task, owned by
 *                     the client's associate (assignReviewTaskToAssociate). The
 *                     report then sits in Review while that task is open.
 *   Send              closeFeedbackReview — the existing close of the sent task
 *                     (owner-only gate since 2026-10-16: the associate who owns
 *                     it, or an admin; native completion).
 *                     Closing it = Sent = done; there is no separate review flag.
 * The pure rules are lib/feedback-reports/lifecycle.ts (canAct); every action
 * re-runs them on a FRESH read before delegating, and the delegated actions
 * re-run their own gates. Dashboard-origin only (isAutomationOrigin); Dynamics
 * reports never reach the card.
 */

const PATHS = ["/events"]
const revalidate = () => {
  for (const p of PATHS) revalidatePath(p)
}

export type ReportLifecycle = { report: LifecycleReportTask; sent: LifecycleSentTask | null }

export type EventReportLifecycles = {
  /** Keyed by the Feedback (report) task id. */
  byReport: Record<string, ReportLifecycle>
  viewer: { myIds: string[]; isAdmin: boolean; hasCapability: boolean; crmWriter: boolean; markReceived: boolean }
}

type ReportRow = {
  task_id: string
  state_label: string | null
  crdfa_feedback_received_date: string | null
  claimed_by_id: string | null
  claimed_by_name: string | null
  bcs_claimed_by_id: string | null
  bcs_claimed_by_name: string | null
  closed_by_name: string | null
}
type SentRow = {
  task_id: string
  review_of_task_id: string
  state_label: string | null
  owner_id: string | null
  owner_name: string | null
  closed_at: string | null
  closed_by_name: string | null
  actual_end: string | null
}

const REPORT_COLS =
  "task_id, state_label, crdfa_feedback_received_date, claimed_by_id, claimed_by_name, bcs_claimed_by_id, bcs_claimed_by_name, closed_by_name"
const SENT_COLS = "task_id, review_of_task_id, state_label, owner_id, owner_name, closed_at, closed_by_name, actual_end"

function toReport(r: ReportRow): LifecycleReportTask {
  return {
    state: r.state_label,
    receivedDate: r.crdfa_feedback_received_date,
    claimedById: r.claimed_by_id ?? r.bcs_claimed_by_id,
    claimedByName: r.claimed_by_name ?? r.bcs_claimed_by_name,
    closedByName: r.closed_by_name,
  }
}
function toSent(s: SentRow): LifecycleSentTask {
  return {
    taskId: s.task_id,
    state: s.state_label,
    ownerId: s.owner_id,
    ownerName: s.owner_name,
    closedAt: s.closed_at,
    closedByName: s.closed_by_name,
    sentAt: s.actual_end ?? s.closed_at,
  }
}

/** The Feedback Report Sent tasks of these reports. */
async function readSentTasks(reportIds: string[]): Promise<ActionResult<SentRow[]>> {
  if (reportIds.length === 0) return ok([])
  const { data, error } = await getSupabaseServer()
    .from("tasks")
    .select(SENT_COLS)
    .in("review_of_task_id", reportIds)
    .eq("bcs_task_subtype_label", "Feedback Report Sent")
  if (error) return fail(describeError(error))
  return ok((data ?? []) as unknown as SentRow[])
}

/** The card's data: every report of the event + its sent task + who is looking. */
export async function loadEventReportLifecycles(eventId: string): Promise<ActionResult<EventReportLifecycles>> {
  // Read-only Meetings & Reports tab (2026-10-16): anyone who can view the event.
  if (!(await canViewEvent(eventId))) return fail("Not authorised.")
  if (!isUuid(eventId)) return fail("Unknown event.")
  const sb = getSupabaseServer()
  const { data: reps, error } = await sb
    .from("tasks")
    .select(REPORT_COLS)
    .eq("bcs_event_id", eventId)
    .eq("bcs_task_subtype_label", "Feedback")
    .not("feedback_report_seq", "is", null)
  if (error) return fail(describeError(error))
  const reports = (reps ?? []) as ReportRow[]
  const sent = await readSentTasks(reports.map((r) => r.task_id))
  if (!sent.ok) return sent
  const sentBy = new Map(sent.data!.map((s) => [s.review_of_task_id, s]))

  const v = await loadClaimViewer()
  const byReport: Record<string, ReportLifecycle> = {}
  for (const r of reports) {
    const s = sentBy.get(r.task_id)
    byReport[r.task_id] = { report: toReport(r), sent: s ? toSent(s) : null }
  }
  return ok({
    byReport,
    viewer: {
      myIds: [...v.myIds],
      isAdmin: v.isAdmin,
      hasCapability: v.hasCapability,
      crmWriter: v.isAdmin && !v.impersonated,
      markReceived: v.markReceived,
    },
  })
}

/** Fresh read of ONE report (Feedback task) + its sent task, dashboard-origin only. */
async function readLifecycle(
  reportTaskId: string,
): Promise<ActionResult<{ origin: string | null; life: ReportLifecycle }>> {
  if (!isUuid(reportTaskId)) return fail("Unknown report.")
  const { data, error } = await getSupabaseServer()
    .from("tasks")
    .select(REPORT_COLS + ", origin, bcs_task_subtype_label, feedback_report_seq")
    .eq("task_id", reportTaskId)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!data) return fail("That report no longer exists.")
  const row = data as unknown as ReportRow & {
    origin: string | null
    bcs_task_subtype_label: string | null
    feedback_report_seq: number | null
  }
  if (row.bcs_task_subtype_label !== "Feedback" || row.feedback_report_seq == null) {
    return fail("That isn't a feedback report.")
  }
  if (!isAutomationOrigin(row.origin)) {
    return fail("This report is synced from Dynamics and is read-only until cutover.")
  }
  const sent = await readSentTasks([row.task_id])
  if (!sent.ok) return sent
  const s = sent.data![0]
  return ok({ origin: row.origin, life: { report: toReport(row), sent: s ? toSent(s) : null } })
}

/**
 * Send → the existing close of the sent task = Sent = done. The permission is
 * closeFeedbackReview's (checkSentTaskClose): the sent task's owner OR
 * hasSuperUserPrivileges (owner-only, 2026-10-16) — identical to Feedback
 * Reports' Close, with no extra card-only check.
 */
export async function sendReport(reportTaskId: string): Promise<ActionResult> {
  const read = await readLifecycle(reportTaskId)
  if (!read.ok) return read
  const { report, sent } = read.data!.life
  if (report.state !== "Completed") return fail("Close the report task first.")
  if (!sent) return fail("The review task doesn't exist yet.")
  const res = await closeFeedbackReview(sent.taskId)
  if (res.ok) revalidate()
  return res
}

/**
 * Meetings & Reports tab (2026-10-16 perf): feedback reports + lifecycles +
 * claim controls in ONE call — still fired only when the tab is open. It calls
 * the same three loaders (same gates, each its own ActionResult) side by side,
 * so the per-request cache() memos — the claim viewer and the active-users
 * table (loadIdentity) — are read once and shared instead of once per call.
 */
export async function loadEventReportsTab(eventId: string): Promise<{
  reports: ActionResult<EventFeedbackReports>
  lifecycles: ActionResult<EventReportLifecycles>
  controls: ActionResult<ClaimControls>
}> {
  const perf = perfTimer("event:reports")
  const [reports, lifecycles, controls] = await Promise.all([
    loadEventFeedbackReports(eventId),
    loadEventReportLifecycles(eventId),
    loadClaimControls(),
  ])
  perf.step("reports+life+claims")
  return { reports, lifecycles, controls }
}

import "server-only"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { isUuid } from "@/lib/crm-write"
import { resolveAccountTeamScope } from "@/lib/access/account-team-scope"
import { isAutomationOrigin } from "@/lib/feedback-reports/policy"
import { FEEDBACK_SUBTYPE, decideClose, decideSentClose } from "@/lib/feedback-claims/policy"
import { loadClaimViewer, resolveClaimActor } from "@/lib/feedback-claims/server"

/**
 * The FEEDBACK close rules, as server-side checks that every close path runs —
 * so they can't be bypassed by closing from somewhere else:
 *
 *   Feedback (report) task  → decideClose: dashboard-origin, Open, SOMEONE
 *     ASSIGNED, and the assignee or an admin (hasSuperUserPrivileges).
 *     Used by closeFeedbackTask (Feedback Reports + the event card, via
 *     prepare()), and by app/tasks/actions.ts closeTask / updateTask.
 *   Feedback Report Sent task → decideSentClose: the report's OPEN review task,
 *     and the viewer is its owner (the associate) OR on the client's account
 *     team OR has hasSuperUserPrivileges. Used by closeFeedbackReview (Feedback
 *     Reports + the event card's Send) and by closeTask / updateTask.
 *
 * Check only — nothing is written here.
 */

export const FEEDBACK_REPORT_SENT_SUBTYPE = "Feedback Report Sent"

/** Is this sub-type governed by the feedback close rules instead of the generic one? */
export function isFeedbackCloseSubtype(subtype: string | null | undefined): boolean {
  return subtype === FEEDBACK_SUBTYPE || subtype === FEEDBACK_REPORT_SENT_SUBTYPE
}

/** May the current viewer close this Feedback (report) task? (decideClose on a fresh read) */
export async function checkFeedbackTaskClose(taskId: string): Promise<ActionResult> {
  const gate = await resolveClaimActor()
  if (!gate.ok) return fail(gate.error)
  if (!isUuid(taskId)) return fail("Unknown task.")
  const { data, error } = await getSupabaseServer()
    .from("tasks")
    .select("origin, state_label, bcs_task_subtype_label, crdfa_feedback_received_date, claimed_by_id, bcs_claimed_by_id")
    .eq("task_id", taskId)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!data) return fail("That task no longer exists.")
  const t = data as {
    origin: string | null
    state_label: string | null
    bcs_task_subtype_label: string | null
    crdfa_feedback_received_date: string | null
    claimed_by_id: string | null
    bcs_claimed_by_id: string | null
  }
  const reason = decideClose(
    {
      origin: t.origin,
      stateLabel: t.state_label,
      subtypeLabel: t.bcs_task_subtype_label,
      receivedDate: t.crdfa_feedback_received_date,
      // The assignee — same fallback as the claim actions' ownerOf().
      ownerId: t.claimed_by_id ?? t.bcs_claimed_by_id,
    },
    gate.actor,
  )
  return reason ? fail(reason) : ok()
}

export type SentCloseTarget = {
  taskId: string
  origin: string | null
  reviewOfTaskId: string | null
  /** Stamped as closed_by_*. */
  actor: { userId: string | null; name: string | null }
}

/** May the current viewer close (send) this Feedback Report Sent task? */
export async function checkSentTaskClose(reviewTaskId: string): Promise<ActionResult<SentCloseTarget>> {
  // Preconditions (unchanged): not in "View as", a signed-in user.
  const viewer = await loadClaimViewer()
  if (viewer.impersonated) return fail("Exit “View as” before closing a review.")
  if (!viewer.email) return fail("Not authorised.")
  if (!isUuid(reviewTaskId)) return fail("Unknown task.")

  const sb = getSupabaseServer()
  const { data: review, error } = await sb
    .from("tasks")
    .select("task_id, origin, state_label, closed_at, bcs_task_subtype_label, review_of_task_id, bcs_account_id, owner_id")
    .eq("task_id", reviewTaskId)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!review) return fail("That task no longer exists.")
  const r = review as {
    task_id: string
    origin: string | null
    state_label: string | null
    closed_at: string | null
    bcs_task_subtype_label: string | null
    review_of_task_id: string | null
    bcs_account_id: string | null
    owner_id: string | null
  }
  if (r.bcs_task_subtype_label !== FEEDBACK_REPORT_SENT_SUBTYPE) {
    return fail("Only the report's Feedback Report Sent task can be closed here.")
  }
  if (r.state_label !== "Open" || r.closed_at) return fail("This review is already closed.")

  // It must be a real report's review task — and resolve its client.
  let clientId: string | null = r.bcs_account_id
  if (r.review_of_task_id && isAutomationOrigin(r.origin)) {
    // Automation review task: report → event → client (fallbacks: the fields).
    const { data: report } = await sb
      .from("tasks")
      .select("bcs_event_id, bcs_account_id")
      .eq("task_id", r.review_of_task_id)
      .maybeSingle()
    clientId = (report?.bcs_account_id as string | null) ?? r.bcs_account_id
    if (report?.bcs_event_id) {
      const { data: ev } = await sb
        .from("events")
        .select("client_account_id")
        .eq("event_id", report.bcs_event_id as string)
        .maybeSingle()
      clientId = (ev?.client_account_id as string | null) ?? clientId
    }
  } else {
    // Any other pair (Dynamics): must be a pending_review row's review_task_id.
    const { data: row, error: pipeErr } = await sb
      .from("v_feedback_pipeline")
      .select("client_account_id")
      .eq("category", "pending_review")
      .eq("review_task_id", r.task_id)
      .limit(1)
      .maybeSingle()
    if (pipeErr) {
      return /review_task_id/.test(pipeErr.message)
        ? fail("Closing this report needs the 2026-10-08 feedback-pipeline SQL patch run first.")
        : fail(describeError(pipeErr))
    }
    if (!row) return fail("This task isn't waiting in Pending Review.")
    clientId = (row.client_account_id as string | null) ?? clientId
  }

  // The unified rule: owner OR account team OR super-user privileges.
  const team = await resolveAccountTeamScope({ email: viewer.email })
  const reason = decideSentClose({
    isOwner: !!r.owner_id && viewer.myIds.has(r.owner_id),
    onClientTeam: !!clientId && team.mode === "filter" && team.accountIds.has(clientId),
    isAdmin: viewer.isAdmin,
  })
  if (reason) return fail(reason)
  return ok({
    taskId: r.task_id,
    origin: r.origin,
    reviewOfTaskId: r.review_of_task_id,
    actor: { userId: viewer.userId, name: viewer.name },
  })
}

import "server-only"

import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"

/**
 * Default the owner of an auto-created "Feedback Report Sent" (Pending Review)
 * task to the client's ASSOCIATE.
 *
 * The review task itself is created by the database — trg_tasks_feedback_close_review
 * (sql/patches/2026-10-07b_feedback_report_automation.sql) fires inside the
 * UPDATE that completes a Feedback task and inserts it with NO owner. Every app
 * path that completes a Feedback task (Feedback Reports → Close, the task card's
 * Close, Tasks → Edit → Completed) calls this right after its UPDATE, when the
 * review task already exists.
 *
 * ASSOCIATE SOURCE: accounts.associate_id / associate_name — the account-team
 * "associate" role (lib/account-teams/roles.ts). For dashboard clients the
 * project_account_team trigger copies account_team_members onto these columns;
 * for Dynamics clients they are the CRM lookup. Client = the report's event's
 * client, falling back to the task's own client (as closeFeedbackReview).
 *
 * ONLY FILLS AN EMPTY OWNER: the trigger always inserts owner_id = null, so a
 * non-null owner means someone already chose one — never overwritten. No
 * associate on the client → the task is left exactly as the trigger made it.
 *
 * Best-effort: a failure is logged, never surfaced — the close itself succeeded.
 */
export async function assignReviewTaskToAssociate(closedTaskId: string): Promise<void> {
  try {
    const sb = getSupabaseServer()
    const { data: review, error } = await sb
      .from("tasks")
      .select("task_id, owner_id, bcs_account_id, bcs_event_id")
      .eq("review_of_task_id", closedTaskId)
      .eq("bcs_task_subtype_label", "Feedback Report Sent")
      .maybeSingle()
    if (error) throw error
    if (!review || review.owner_id) return

    let clientId = review.bcs_account_id as string | null
    if (review.bcs_event_id) {
      const { data: ev } = await sb
        .from("events")
        .select("client_account_id")
        .eq("event_id", review.bcs_event_id as string)
        .maybeSingle()
      clientId = (ev?.client_account_id as string | null) ?? clientId
    }
    if (!clientId) return

    const { data: acct, error: acctErr } = await sb
      .from("accounts")
      .select("associate_id, associate_name")
      .eq("account_id", clientId)
      .maybeSingle()
    if (acctErr) throw acctErr
    const associateId = (acct?.associate_id as string | null) ?? null
    if (!associateId) return // No associate → leave the trigger's owner as-is.
    const associateName = (acct?.associate_name as string | null) ?? null

    const { data: changed, error: upErr } = await sb
      .from("tasks")
      .update({ owner_id: associateId, owner_name: associateName })
      .eq("task_id", review.task_id as string)
      .is("owner_id", null)
      .select("task_id")
    if (upErr) throw upErr
    if (!changed || changed.length !== 1) return

    await recordAudit({
      action: "update",
      entity: "tasks",
      recordId: review.task_id as string,
      changes: { owner_name: { from: null, to: associateName }, review_of_task_id: closedTaskId },
      context: "automation:feedback-report:review-owner-associate",
    })
  } catch (e) {
    console.warn("[feedback-reports] review owner → associate failed:", e instanceof Error ? e.message : e)
  }
}

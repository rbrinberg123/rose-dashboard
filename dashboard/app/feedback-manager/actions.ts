"use server"

import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import { isUuid } from "@/lib/crm-write"
import {
  FEEDBACK_CLAIMS_INCLUDE_DYNAMICS,
  decideClaim,
  decideClose,
  decideReassign,
  decideRelease,
  type ClaimTask,
  type Decision,
} from "@/lib/feedback-claims/policy"
import { loadClaimRoster, resolveClaimActor, type ClaimViewer } from "@/lib/feedback-claims/server"
import { TASK_STATUS_OPTIONS } from "@/lib/tasks/create"
import { getEffectiveIdentity } from "@/lib/effective-identity"
import { resolveAccountTeamScope } from "@/lib/access/account-team-scope"
import { isAutomationOrigin } from "@/lib/feedback-reports/policy"

/**
 * Feedback Reports → claim / release / reassign / close.
 *
 * ── GATES (all server-side; the buttons are cosmetic) ──────────────────────
 *   1. resolveClaimActor(): refuses "View as", requires a CRM-matched user.
 *   2. The pure policy (lib/feedback-claims/policy.ts) on a FRESH read of the
 *      task: capability for claim, owner-or-admin for release / close, admin
 *      for reassign, and the pool (Feedback subtype, Open, origin).
 *   3. The UPDATE repeats the pool + the owner it read in its WHERE clause and
 *      must touch exactly one row — so two people racing to claim, or a close
 *      racing a reassign, cannot both win.
 *
 * ── ORIGIN ─────────────────────────────────────────────────────────────────
 * These actions do NOT go through lib/crm-write.ts (updateDashboardRow /
 * requireCrmWriter). That path is the generic "edit a CRM record" gate —
 * super-user only and dashboard-origin only. Claiming is gated on its own
 * CAPABILITY instead. Today the policy's pool is still dashboard-origin only;
 * at cutover FEEDBACK_CLAIMS_INCLUDE_DYNAMICS opens it to Dynamics-origin rows
 * with no other change.
 *
 * ── WHAT IS WRITTEN ────────────────────────────────────────────────────────
 *   claimed_by_id / claimed_by_name / claimed_at, closed_by_* / closed_at —
 *     dashboard-owned columns the sync never writes (2026-10-07 patch).
 *   bcs_claimed_by_id / bcs_claimed_by_name — kept IN STEP with claimed_by_*
 *     so every existing reader (v_feedback_pipeline → Feedback Reports, Alerts,
 *     the nav badge, My Dashboard; the Tasks page) shows the claim unchanged.
 *   Close: the task's native completion fields — state Completed / status
 *     Completed / actual_end = now — i.e. the EXISTING completion workflow, so
 *     the report moves to Pending Review exactly as a CRM completion does.
 * Every change appends a feedback_claim_events row AND an audit_log entry.
 */

const PATHS = ["/feedback-manager", "/my-dashboard", "/clients/alerts"]

const COMPLETED = TASK_STATUS_OPTIONS.find((s) => s.key === "completed")!

type TaskRow = {
  task_id: string
  origin: string | null
  state_label: string | null
  bcs_task_subtype_label: string | null
  crdfa_feedback_received_date: string | null
  claimed_by_id: string | null
  claimed_by_name: string | null
  bcs_claimed_by_id: string | null
  bcs_claimed_by_name: string | null
}

/**
 * The current owner. claimed_by_id is the record; bcs_claimed_by_id is read
 * only as a fallback for a dashboard task whose "Claimed by" was set from the
 * Tasks form (which writes the bcs_ field) before it was ever claimed here.
 */
function ownerOf(t: TaskRow): { id: string | null; name: string | null } {
  if (t.claimed_by_id) return { id: t.claimed_by_id, name: t.claimed_by_name }
  return { id: t.bcs_claimed_by_id, name: t.bcs_claimed_by_name }
}

function toClaimTask(t: TaskRow): ClaimTask {
  return {
    origin: t.origin,
    stateLabel: t.state_label,
    subtypeLabel: t.bcs_task_subtype_label,
    receivedDate: t.crdfa_feedback_received_date,
    ownerId: ownerOf(t).id,
  }
}

async function readTask(taskId: string): Promise<ActionResult<TaskRow>> {
  if (!isUuid(taskId)) return fail("Unknown task.")
  const { data, error } = await getSupabaseServer()
    .from("tasks")
    .select(
      "task_id, origin, state_label, bcs_task_subtype_label, crdfa_feedback_received_date, claimed_by_id, claimed_by_name, bcs_claimed_by_id, bcs_claimed_by_name",
    )
    .eq("task_id", taskId)
    .maybeSingle()
  if (error) {
    if (/claimed_by_id|closed_at/.test(error.message)) {
      return fail("Feedback claiming needs the 2026-10-07 feedback-claims SQL patch run first.")
    }
    return fail(describeError(error))
  }
  if (!data) return fail("That task no longer exists.")
  return ok(data as TaskRow)
}

/**
 * The guarded UPDATE: pool + the owner we read, exactly one row or nothing.
 * Returns a friendly "changed under you" message when the row moved on.
 */
async function guardedUpdate(t: TaskRow, patch: Record<string, unknown>): Promise<ActionResult> {
  let q = getSupabaseServer()
    .from("tasks")
    .update(patch)
    .eq("task_id", t.task_id)
    .eq("state_label", "Open")
    .eq("bcs_task_subtype_label", "Feedback")
    .in("origin", FEEDBACK_CLAIMS_INCLUDE_DYNAMICS ? ["dashboard", "dynamics"] : ["dashboard"])
  // The owner must still be the one we read (see ownerOf for the fallback).
  if (t.claimed_by_id) {
    q = q.eq("claimed_by_id", t.claimed_by_id)
  } else {
    q = q.is("claimed_by_id", null)
    q = t.bcs_claimed_by_id ? q.eq("bcs_claimed_by_id", t.bcs_claimed_by_id) : q.is("bcs_claimed_by_id", null)
  }
  const { data, error } = await q.select("task_id")
  if (error) return fail(describeError(error))
  if (!data || data.length !== 1) {
    return fail("This task changed while you were looking at it — refresh and try again.")
  }
  return ok()
}

async function logEvent(
  taskId: string,
  event: "claim" | "release" | "reassign" | "close",
  from: { id: string | null; name: string | null },
  to: { id: string | null; name: string | null },
  actor: ClaimViewer,
  changes: Record<string, unknown>,
): Promise<void> {
  const { error } = await getSupabaseServer().from("feedback_claim_events").insert({
    task_id: taskId,
    event,
    from_user_id: from.id,
    from_user_name: from.name,
    to_user_id: to.id,
    to_user_name: to.name,
    actor_user_id: actor.userId,
    actor_name: actor.name,
    actor_email: actor.email,
  })
  if (error) console.warn("[feedback-claims] history insert failed:", error.message)
  await recordAudit({
    action: "update",
    entity: "tasks",
    recordId: taskId,
    changes,
    context: "feedback-claim:" + event,
  })
}

function revalidate() {
  for (const p of PATHS) revalidatePath(p)
}

/** Shared front half of every action: who, which task, is it allowed. */
async function prepare(
  taskId: string,
  decide: (t: ClaimTask, a: ClaimViewer) => Decision,
): Promise<ActionResult<{ actor: ClaimViewer; task: TaskRow }>> {
  const gate = await resolveClaimActor()
  if (!gate.ok) return fail(gate.error)
  const read = await readTask(taskId)
  if (!read.ok) return read
  const reason = decide(toClaimTask(read.data), gate.actor)
  if (reason) return fail(reason)
  return ok({ actor: gate.actor, task: read.data })
}

const claimCols = (id: string | null, name: string | null, at: string | null) => ({
  claimed_by_id: id,
  claimed_by_name: name,
  claimed_at: at,
  bcs_claimed_by_id: id,
  bcs_claimed_by_name: name,
})

export async function claimFeedbackTask(taskId: string): Promise<ActionResult> {
  const prep = await prepare(taskId, decideClaim)
  if (!prep.ok) return prep
  const { actor, task } = prep.data
  const now = new Date().toISOString()
  const res = await guardedUpdate(task, claimCols(actor.userId, actor.name, now))
  if (!res.ok) return res
  await logEvent(task.task_id, "claim", { id: null, name: null }, { id: actor.userId, name: actor.name }, actor, {
    claimed_by_name: { from: null, to: actor.name },
  })
  revalidate()
  return ok()
}

export async function releaseFeedbackTask(taskId: string): Promise<ActionResult> {
  const prep = await prepare(taskId, decideRelease)
  if (!prep.ok) return prep
  const { actor, task } = prep.data
  const from = ownerOf(task)
  const res = await guardedUpdate(task, claimCols(null, null, null))
  if (!res.ok) return res
  await logEvent(task.task_id, "release", from, { id: null, name: null }, actor, {
    claimed_by_name: { from: from.name, to: null },
  })
  revalidate()
  return ok()
}

export async function reassignFeedbackTask(taskId: string, toUserId: string): Promise<ActionResult> {
  const prep = await prepare(taskId, (t, a) => decideReassign(t, a, toUserId || null))
  if (!prep.ok) return prep
  const { actor, task } = prep.data
  // Never trust the browser's pick: it must be an active, real person.
  const roster = await loadClaimRoster()
  const target = roster.find((r) => r.userId === toUserId)
  if (!target) return fail("Pick an active staff member.")
  const from = ownerOf(task)
  const res = await guardedUpdate(task, claimCols(target.userId, target.name, new Date().toISOString()))
  if (!res.ok) return res
  await logEvent(task.task_id, "reassign", from, { id: target.userId, name: target.name }, actor, {
    claimed_by_name: { from: from.name, to: target.name },
  })
  revalidate()
  return ok()
}

export async function closeFeedbackTask(taskId: string): Promise<ActionResult> {
  const prep = await prepare(taskId, decideClose)
  if (!prep.ok) return prep
  const { actor, task } = prep.data
  const now = new Date().toISOString()
  const owner = ownerOf(task)
  // The EXISTING completion workflow: the same native fields a CRM completion
  // sets (statecode/statuscode Completed + actualend). v_feedback_pipeline then
  // moves the report from In progress to Pending Review on its own.
  const res = await guardedUpdate(task, {
    state_code: COMPLETED.state,
    state_label: COMPLETED.stateLabel,
    status_code: COMPLETED.status,
    status_label: COMPLETED.statusLabel,
    actual_end: now,
    closed_by_id: actor.userId,
    closed_by_name: actor.name,
    closed_at: now,
    modified_on: now,
    modified_by_id: actor.userId,
    modified_by_name: actor.name,
  })
  if (!res.ok) return res
  await logEvent(task.task_id, "close", owner, owner, actor, {
    state_label: { from: "Open", to: COMPLETED.stateLabel },
    closed_by_name: { from: null, to: actor.name },
  })
  revalidate()
  return ok()
}

// ---------------------------------------------------------------------------
// Pending Review → Close: complete the "Feedback Report Pending Review" task.
// ---------------------------------------------------------------------------

/**
 * The final step of a dashboard feedback report: complete its review task.
 *
 * GATES (server-side; the button is cosmetic):
 *   1. Not in "View as" (a preview must not act).
 *   2. The task is an automation-created review task — sub-type Feedback
 *      Report Sent, review_of_task_id set, still Open — and its origin is in
 *      the feedback-automation scope (dashboard-origin today; the same cutover
 *      switch the automations use, lib/feedback-reports/policy.ts).
 *   3. The viewer is on the ACCOUNT TEAM of the client — resolved report →
 *      event → client, through resolveAccountTeamScope (any of the six roles;
 *      for dashboard-created clients those come from account_team_members).
 *      No super-user bypass (account-team only, as specified).
 *   4. A guarded UPDATE (Open, same origin, same sub-type) that must change
 *      exactly one row.
 * Completion uses the same native fields as every other task completion.
 */
export async function closeFeedbackReview(reviewTaskId: string): Promise<ActionResult> {
  const identity = await getEffectiveIdentity()
  if (identity.impersonated) return fail("Exit “View as” before closing a review.")
  if (!identity.email) return fail("Not authorised.")
  if (!isUuid(reviewTaskId)) return fail("Unknown task.")

  const sb = getSupabaseServer()
  const { data: review, error } = await sb
    .from("tasks")
    .select("task_id, origin, state_label, bcs_task_subtype_label, review_of_task_id, bcs_account_id, subject")
    .eq("task_id", reviewTaskId)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!review) return fail("That task no longer exists.")
  const r = review as {
    task_id: string
    origin: string | null
    state_label: string | null
    bcs_task_subtype_label: string | null
    review_of_task_id: string | null
    bcs_account_id: string | null
    subject: string | null
  }
  if (r.bcs_task_subtype_label !== "Feedback Report Sent" || !r.review_of_task_id) {
    return fail("Only a Feedback Report Pending Review task can be closed here.")
  }
  if (!isAutomationOrigin(r.origin)) return fail("This review is managed in Dynamics until cutover.")
  if (r.state_label !== "Open") return fail("This review is already closed.")

  // Client: the linked report → its event → the event's client (fallback: the
  // report's / review's own client field).
  const { data: report } = await sb
    .from("tasks")
    .select("bcs_event_id, bcs_account_id")
    .eq("task_id", r.review_of_task_id)
    .maybeSingle()
  let clientId = (report?.bcs_account_id as string | null) ?? r.bcs_account_id
  if (report?.bcs_event_id) {
    const { data: ev } = await sb
      .from("events")
      .select("client_account_id")
      .eq("event_id", report.bcs_event_id as string)
      .maybeSingle()
    clientId = (ev?.client_account_id as string | null) ?? clientId
  }
  const team = await resolveAccountTeamScope(identity)
  if (!clientId || team.mode !== "filter" || !team.accountIds.has(clientId)) {
    return fail("Not authorised — only the client's account team can close this review.")
  }

  const now = new Date().toISOString()
  const patch = {
    state_code: COMPLETED.state,
    state_label: COMPLETED.stateLabel,
    status_code: COMPLETED.status,
    status_label: COMPLETED.statusLabel,
    actual_end: now,
    closed_by_id: identity.userId,
    closed_by_name: identity.name,
    closed_at: now,
    modified_on: now,
    modified_by_id: identity.userId,
    modified_by_name: identity.name,
  }
  const { data: updated, error: upErr } = await sb
    .from("tasks")
    .update(patch)
    .eq("task_id", r.task_id)
    .eq("state_label", "Open")
    .eq("bcs_task_subtype_label", "Feedback Report Sent")
    .eq("origin", r.origin as string)
    .select("task_id")
  if (upErr) return fail(describeError(upErr))
  if (!updated || updated.length !== 1) {
    return fail("This task changed while you were looking at it — refresh and try again.")
  }

  await recordAudit({
    action: "update",
    entity: "tasks",
    recordId: r.task_id,
    changes: {
      state_label: { from: "Open", to: COMPLETED.stateLabel },
      closed_by_name: { from: null, to: identity.name },
      review_of_task_id: r.review_of_task_id,
    },
    context: "feedback-review:close",
  })
  revalidate()
  return ok()
}

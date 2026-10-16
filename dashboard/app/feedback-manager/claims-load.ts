import { getSupabaseServer } from "@/lib/supabase"
import { FEEDBACK_CLAIMS_INCLUDE_DYNAMICS, FEEDBACK_SUBTYPE } from "@/lib/feedback-claims/policy"
import { loadClaimRoster, loadClaimViewer } from "@/lib/feedback-claims/server"
import { isAutomationOrigin } from "@/lib/feedback-reports/policy"
import { resolveAccountTeamScope } from "@/lib/access/account-team-scope"
import type { ClaimsContext, ClosedClaimRow } from "@/lib/feedback-claims/types"

/**
 * The claim overlay for Feedback Reports: which rows are in the claimable pool
 * (and when they were claimed), the recently closed tasks, the viewer's rights,
 * and — for admins — the Reassign roster. Read with the EFFECTIVE identity so
 * "View as" previews the right buttons; the actions re-check everything.
 */
export async function loadClaimsContext(): Promise<ClaimsContext> {
  const sb = getSupabaseServer()
  const origins = FEEDBACK_CLAIMS_INCLUDE_DYNAMICS ? ["dashboard", "dynamics"] : ["dashboard"]

  const viewer = await loadClaimViewer()
  const [poolRes, closedRes, roster, reviewRes, team] = await Promise.all([
    sb
      .from("tasks")
      .select("task_id, claimed_at")
      .eq("bcs_task_subtype_label", FEEDBACK_SUBTYPE)
      .eq("state_label", "Open")
      .in("origin", origins),
    sb
      .from("tasks")
      .select("task_id, bcs_account_name, bcs_event_name, subject, claimed_by_name, closed_by_name, closed_at")
      .eq("bcs_task_subtype_label", FEEDBACK_SUBTYPE)
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: false })
      .limit(100),
    // Everyone gets the roster: owners may reassign their own task too
    // (canManageAssignment). The actions re-check.
    loadClaimRoster(),
    // Open automation-created review tasks ("Feedback Report Pending Review"),
    // keyed back to their report — the Pending Review rows that get Close.
    sb
      .from("tasks")
      .select("task_id, review_of_task_id, origin, bcs_account_id, owner_id")
      .eq("bcs_task_subtype_label", "Feedback Report Sent")
      .eq("state_label", "Open")
      .not("review_of_task_id", "is", null),
    resolveAccountTeamScope({ email: viewer.email }),
  ])

  // Open Feedback Report Sent tasks the viewer OWNS — Pending Review → Close is
  // owner-only (2026-10-16), and Dynamics-origin rows carry no review info.
  const ownedRes =
    viewer.myIds.size > 0
      ? await sb
          .from("tasks")
          .select("task_id")
          .eq("bcs_task_subtype_label", "Feedback Report Sent")
          .eq("state_label", "Open")
          .is("closed_at", null)
          .in("owner_id", [...viewer.myIds])
      : { data: [], error: null }
  const ownedReviewTaskIds = (ownedRes.error ? [] : ((ownedRes.data ?? []) as { task_id: string }[])).map(
    (r) => r.task_id,
  )

  // Close on Pending Review: the review task's owner or an admin (display;
  // closeFeedbackReview re-checks).
  const reviews: ClaimsContext["reviews"] = {}
  for (const r of (reviewRes.error ? [] : (reviewRes.data ?? [])) as {
    task_id: string
    review_of_task_id: string
    origin: string | null
    bcs_account_id: string | null
    owner_id: string | null
  }[]) {
    if (!isAutomationOrigin(r.origin)) continue
    reviews[r.review_of_task_id] = {
      reviewTaskId: r.task_id,
      // The unified Sent-close rule (decideSentClose, owner-only 2026-10-16):
      // owner OR super-user privileges — display only; closeFeedbackReview re-checks.
      canClose: (!!r.owner_id && viewer.myIds.has(r.owner_id)) || viewer.isAdmin,
    }
  }

  const setupMissing = [poolRes.error, closedRes.error].some(
    (e) => e && /claimed_at|closed_at|closed_by_name|does not exist/.test(e.message),
  )

  const meta: ClaimsContext["meta"] = {}
  for (const r of (poolRes.data ?? []) as { task_id: string; claimed_at: string | null }[]) {
    meta[r.task_id] = { claimedAt: r.claimed_at }
  }

  const closed: ClosedClaimRow[] = (
    (closedRes.data ?? []) as {
      task_id: string
      bcs_account_name: string | null
      bcs_event_name: string | null
      subject: string | null
      claimed_by_name: string | null
      closed_by_name: string | null
      closed_at: string
    }[]
  ).map((r) => ({
    taskId: r.task_id,
    client: r.bcs_account_name,
    event: r.bcs_event_name ?? r.subject,
    ownerName: r.claimed_by_name,
    closedByName: r.closed_by_name,
    closedAt: r.closed_at,
  }))

  return {
    viewer: {
      canClaim: viewer.hasCapability || viewer.isAdmin,
      isAdmin: viewer.isAdmin,
      canManageAll: viewer.isAdmin || viewer.markReceived,
      myIds: [...viewer.myIds],
      impersonated: viewer.impersonated,
    },
    meta: setupMissing ? {} : meta,
    teamAccountIds: team.mode === "filter" ? [...team.accountIds] : [],
    reviews,
    closed: setupMissing ? [] : closed,
    roster,
    ownedReviewTaskIds,
    setupMissing,
  }
}

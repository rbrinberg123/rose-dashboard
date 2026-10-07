import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { ListTitleCard } from "@/components/page-masthead"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { getUserRole } from "@/lib/user-role"
import { getEffectiveIdentity } from "@/lib/effective-identity"
import { resolveMeetingScope, filterVisibleMeetingIds } from "@/lib/access/data-scope"
import { NoMeetingsAssigned } from "@/components/scoped-empty"
import { loadFeedbackOutstandingRows } from "@/app/feedback/load"
import { FeedbackView } from "@/app/feedback/feedback-view"
import { SendEmailControls } from "@/app/feedback/send-email-controls"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { canAccessRoute } from "@/lib/access-control"
import { getAllowedRoutes } from "@/lib/page-access"
import { loadClaimViewer } from "@/lib/feedback-claims/server"
import { decideSetMeetingFeedback, type FeedbackCollectionExtras } from "@/lib/feedback-collection/policy"

// Feedback Collection — concluded meetings still needing feedback. Its own
// page/route with an INDEPENDENT role grant (separate from Feedback Reports),
// and it is ROW-SCOPED by the Pass-2 meeting resolver (Booker / Host / Feedback
// + account-team meetings). The old /feedback route redirects here.

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Feedback Collection" }

export default async function FeedbackCollectionPage() {
  const collection = await loadFeedbackOutstandingRows()

  if (collection.error) {
    return (
      <PageShell title="Feedback Collection">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_feedback_outstanding</div>
          <div className="mt-1 text-muted-foreground">{collection.error}</div>
        </div>
      </PageShell>
    )
  }

  // Level-2 meeting scoping — driven off the effective identity so View-as
  // previews it. mode "all" (Super User / all) → unfiltered; "none" → deny.
  const scope = await resolveMeetingScope(await getEffectiveIdentity())
  let rows = collection.rows
  let scopedEmpty = false
  if (scope.mode === "none") {
    rows = []
    scopedEmpty = true
  } else if (scope.mode === "filter") {
    const allowed = await filterVisibleMeetingIds(
      scope,
      collection.rows.map((r) => r.meeting_id),
    )
    rows = collection.rows.filter((r) => allowed.has(r.meeting_id))
    scopedEmpty = rows.length === 0
  }

  // Email controls are super-user-only (the send route enforces the same gate
  // server-side). Gate on the REAL session role, not the effective identity.
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userEmail = user?.email ?? undefined
  const canSend = (await getUserRole(userEmail)) === "super_user"

  const extras = await loadRowExtras(rows.map((r) => r.meeting_id))

  return (
    <PageShell title="Feedback Collection" hideHeader canvas>
      <div className="mb-4">
        <ListTitleCard
          eyebrow="Logistics · Feedback"
          title="Feedback Collection"
          subtitle="Concluded meetings still needing feedback — scoped to the meetings you booked, hosted, are the feedback assignee for, or are on the client's account team."
          rightSlot={canSend ? <SendEmailControls userEmail={userEmail} /> : undefined}
        />
      </div>

      {scopedEmpty ? <NoMeetingsAssigned /> : <FeedbackView rows={rows} extras={extras} />}
    </PageShell>
  )
}

/**
 * Per-row facts for the shortcuts + the feedback-status control, computed
 * SERVER-SIDE for the already-scoped rows: each meeting's origin / feedback
 * person / host / FB Received date (public.meetings), its report task
 * (feedback_report_meetings), and whether THIS viewer may set its feedback
 * (decideSetMeetingFeedback — the same rule setMeetingFeedback re-applies).
 * "View as" previews the target's view, read-only (canSet false).
 */
async function loadRowExtras(meetingIds: string[]): Promise<FeedbackCollectionExtras> {
  const sb = getSupabaseServer()
  const [role, viewer] = await Promise.all([getEffectiveRole(), loadClaimViewer()])
  const allowed = await getAllowedRoutes(role)
  const byMeeting: FeedbackCollectionExtras["byMeeting"] = {}

  for (let i = 0; i < meetingIds.length; i += 200) {
    const chunk = meetingIds.slice(i, i + 200)
    const [mRes, mapRes] = await Promise.all([
      sb
        .from("meetings")
        .select("meeting_id, origin, meeting_status_label, state_label, feedback_id, host_id, fb_received_date")
        .in("meeting_id", chunk),
      sb.from("feedback_report_meetings").select("meeting_id, report_task_id").in("meeting_id", chunk),
    ])
    // Fail-soft: without these facts the rows simply render as before (no
    // shortcuts to a task, read-only status) — never a broken page.
    const reportOf = new Map(
      ((mapRes.error ? [] : mapRes.data) ?? []).map((x) => [x.meeting_id as string, x.report_task_id as string]),
    )
    for (const m of (mRes.data ?? []) as Record<string, string | null>[]) {
      const facts = {
        origin: m.origin,
        meetingStatus: m.meeting_status_label,
        state: m.state_label,
        feedbackId: m.feedback_id,
        hostId: m.host_id,
      }
      byMeeting[m.meeting_id as string] = {
        origin: m.origin,
        reportTaskId: reportOf.get(m.meeting_id as string) ?? null,
        fbReceivedDate: m.fb_received_date ? String(m.fb_received_date).slice(0, 10) : null,
        canSet: !viewer.impersonated && decideSetMeetingFeedback(facts, viewer) === null,
      }
    }
  }

  return {
    byMeeting,
    canOpenMeetings: canAccessRoute(role, "/meetings", allowed),
    canOpenTasks: canAccessRoute(role, "/tasks", allowed),
    crmBase: process.env.NEXT_PUBLIC_DYNAMICS_URL?.replace(/\/$/, "") || "https://clientcrm.crm.dynamics.com",
  }
}

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

      {scopedEmpty ? <NoMeetingsAssigned /> : <FeedbackView rows={rows} />}
    </PageShell>
  )
}

import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { ListTitleCard } from "@/components/page-masthead"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { getUserRole } from "@/lib/user-role"
import { getEffectiveIdentity } from "@/lib/effective-identity"
import { resolveMeetingScope, filterVisibleMeetingIds } from "@/lib/access/data-scope"
import { NoMeetingsAssigned } from "@/components/scoped-empty"
import { loadFeedbackOutstandingRows, loadFeedbackPipelineRows } from "@/app/feedback/load"
import { FeedbackPipelineView } from "./feedback-manager-view"
import { FeedbackView } from "@/app/feedback/feedback-view"
import { SendEmailControls } from "@/app/feedback/send-email-controls"
import { ScrollToCollection } from "./collection-scroll"

// Merged "Feedback" page. Feedback Report Pipeline is the base (top); Feedback
// Collection is appended below the #collection anchor. One combined header (no
// KPI tiles) — just eyebrow + title + subtitle + a jump-to-Collection button.
// The old /feedback route redirects here to #collection (see
// app/feedback/page.tsx), preserving its ?client= deep link.

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Feedback" }

export default async function FeedbackManagerPage() {
  // Load both data sets: the report pipeline (base) and the outstanding
  // collection (reusing the shared /feedback loaders, same queries as before).
  const [pipeline, collection] = await Promise.all([
    loadFeedbackPipelineRows(),
    loadFeedbackOutstandingRows(),
  ])

  if (pipeline.error || collection.error) {
    const which = pipeline.error ? "v_feedback_pipeline" : "v_feedback_outstanding"
    const message = pipeline.error ?? collection.error
    return (
      <PageShell title="Feedback">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load {which}</div>
          <div className="mt-1 text-muted-foreground">{message}</div>
        </div>
      </PageShell>
    )
  }

  const pipelineRows = pipeline.rows

  // Level-2 meeting scoping applies to the COLLECTION section only (concluded
  // meetings needing feedback). The Reports pipeline stays visible to everyone
  // with page access (all-access by design). Driven off the effective identity
  // so View-as previews it.
  const scope = await resolveMeetingScope(await getEffectiveIdentity())
  let collectionRows = collection.rows
  let collectionScopedEmpty = false
  if (scope.mode === "none") {
    collectionRows = []
    collectionScopedEmpty = true
  } else if (scope.mode === "filter") {
    const allowed = await filterVisibleMeetingIds(
      scope,
      collection.rows.map((r) => r.meeting_id),
    )
    collectionRows = collection.rows.filter((r) => allowed.has(r.meeting_id))
    collectionScopedEmpty = collectionRows.length === 0
  }

  // Stable "today" (UTC calendar day) for the pipeline view's aging / due-date math.
  const today = new Date().toISOString().slice(0, 10)

  // Prefill the Send-test box + gate the control to super-users. The Collection
  // section renders the control; the send route enforces the same gate server-side.
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userEmail = user?.email ?? undefined
  const canSend = (await getUserRole(userEmail)) === "super_user"

  return (
    <PageShell title="Feedback" hideHeader canvas>
      <div className="mb-4">
        <ListTitleCard
          eyebrow="Logistics · Feedback"
          title="Feedback"
          subtitle="Report pipeline and outstanding collection in one place — reports up top, meeting-level collection below."
          rightSlot={
            // Stacked, right-aligned: jump button on top, compact email links
            // below (super-users only). Sized to fit the masthead height.
            <div className="flex flex-col items-end gap-1.5">
              <ScrollToCollection
                title="Jump to Feedback Collection"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#1E2858] px-3.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
              >
                Jump to Feedback Collection ↓
              </ScrollToCollection>
              {canSend && <SendEmailControls userEmail={userEmail} variant="links" />}
            </div>
          }
        />
      </div>

      {/* Report pipeline — the base content (Open + Pending Review tables and
          the Claimed By / Account Manager filters), unchanged. */}
      <FeedbackPipelineView rows={pipelineRows} today={today} embedded />

      {/* Feedback Collection — appended below the anchor the header jumps to.
          Scoped to the viewer's meetings; the Reports pipeline above is not. */}
      <div id="collection" className="mt-10 scroll-mt-4">
        {collectionScopedEmpty ? <NoMeetingsAssigned /> : <FeedbackView rows={collectionRows} />}
      </div>
    </PageShell>
  )
}

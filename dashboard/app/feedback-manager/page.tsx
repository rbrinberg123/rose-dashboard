import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { loadFeedbackPipelineRows } from "@/app/feedback/load"
import { FeedbackPipelineView } from "./feedback-manager-view"
import { loadClaimsContext } from "./claims-load"
import { canAccessRoute } from "@/lib/access-control"
import { getEffectiveRole } from "@/lib/effective-identity"
import { getAllowedRoutes } from "@/lib/page-access"

// Feedback Reports — the report pipeline (Open + Pending Review), all-access by
// design (no row scoping). Feedback Collection is a SEPARATE page/route
// (app/feedback-collection) with its own independent grant + meeting scoping.

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Feedback Reports" }

export default async function FeedbackReportsPage() {
  const [pipeline, claims, role] = await Promise.all([
    loadFeedbackPipelineRows(),
    loadClaimsContext(),
    getEffectiveRole(),
  ])
  // The row shortcuts open the Events / Tasks drawers, so they are offered only
  // to viewers who may open those pages. loadEventRecord / loadTaskRecord
  // re-check on the server (super user) regardless.
  const allowed = await getAllowedRoutes(role)
  const canOpen = {
    events: canAccessRoute(role, "/events", allowed),
    tasks: canAccessRoute(role, "/tasks", allowed),
  }

  if (pipeline.error) {
    return (
      <PageShell title="Feedback Reports">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_feedback_pipeline</div>
          <div className="mt-1 text-muted-foreground">{pipeline.error}</div>
        </div>
      </PageShell>
    )
  }

  // Stable "today" (UTC calendar day) for the pipeline view's aging / due-date math.
  const today = new Date().toISOString().slice(0, 10)

  return (
    <PageShell title="Feedback Reports" hideHeader canvas>
      {/* Not embedded → the view renders its own "Feedback Reports" masthead. */}
      <FeedbackPipelineView rows={pipeline.rows} today={today} claims={claims} canOpen={canOpen} />
    </PageShell>
  )
}

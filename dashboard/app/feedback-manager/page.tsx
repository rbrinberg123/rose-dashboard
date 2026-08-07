import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { loadFeedbackPipelineRows } from "@/app/feedback/load"
import { FeedbackPipelineView } from "./feedback-manager-view"

// Feedback Reports — the report pipeline (Open + Pending Review), all-access by
// design (no row scoping). Feedback Collection is a SEPARATE page/route
// (app/feedback-collection) with its own independent grant + meeting scoping.

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Feedback Reports" }

export default async function FeedbackReportsPage() {
  const pipeline = await loadFeedbackPipelineRows()

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
      <FeedbackPipelineView rows={pipeline.rows} today={today} />
    </PageShell>
  )
}

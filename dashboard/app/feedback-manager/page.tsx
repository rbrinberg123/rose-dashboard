import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { loadFeedbackPipelineRows } from "@/app/feedback/load"
import { FeedbackPipelineView } from "./feedback-manager-view"
import { loadClaimsContext } from "./claims-load"
import { canAccessRoute } from "@/lib/access-control"
import { getEffectiveRole } from "@/lib/effective-identity"
import { getAllowedRoutes } from "@/lib/page-access"
import { getSupabaseServer } from "@/lib/supabase"

// Feedback Reports — the report pipeline (Open + Pending Review), all-access by
// design (no row scoping). Feedback Collection is a SEPARATE page/route
// (app/feedback-collection) with its own independent grant + meeting scoping.

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Feedback Reports" }

/**
 * Report part per report task — ONLY for events split into 2+ reports
 * (tasks.feedback_report_seq, dashboard-owned: 1/2/3 = A/B/C). A lone report has
 * no entry, so its row shows no "Part A". Small set (automation-created reports
 * only); fails soft to {} (rows just show no part).
 */
async function loadSplitReportParts(): Promise<Map<string, number>> {
  const { data, error } = await getSupabaseServer()
    .from("tasks")
    .select("task_id, bcs_event_id, feedback_report_seq")
    .not("feedback_report_seq", "is", null)
    .limit(5000)
  if (error || !data) return new Map()
  const rows = data as { task_id: string; bcs_event_id: string | null; feedback_report_seq: number }[]
  const perEvent = new Map<string, number>()
  for (const r of rows) if (r.bcs_event_id) perEvent.set(r.bcs_event_id, (perEvent.get(r.bcs_event_id) ?? 0) + 1)
  return new Map(
    rows
      .filter((r) => r.bcs_event_id && (perEvent.get(r.bcs_event_id) ?? 0) > 1)
      .map((r) => [r.task_id, r.feedback_report_seq]),
  )
}

export default async function FeedbackReportsPage() {
  const [pipeline, claims, role, parts] = await Promise.all([
    loadFeedbackPipelineRows(),
    loadClaimsContext(),
    getEffectiveRole(),
    loadSplitReportParts(),
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
      <FeedbackPipelineView
        rows={pipeline.rows.map((r) => (parts.has(r.task_id) ? { ...r, report_part: parts.get(r.task_id) } : r))}
        today={today}
        claims={claims}
        canOpen={canOpen}
      />
    </PageShell>
  )
}

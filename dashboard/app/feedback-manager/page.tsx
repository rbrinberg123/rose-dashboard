import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { FeedbackPipelineRow } from "@/lib/types"
import { FeedbackPipelineView } from "./feedback-manager-view"

// Feedback Report Pipeline — the TWO-CATEGORY model, driven by v_feedback_pipeline:
//   • In Progress    — Feedback tasks (Open, feedback received), claimed/unclaimed.
//   • Pending Review — Open "Feedback Report Sent" tasks with a matching CLOSED
//                      Feedback task (linked by the event-code token; see the view
//                      comment in sql/03_views.sql for the linkage rationale).
// One row per task. Replaces the older multi-state v_feedback_manager view.

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Feedback Report Pipeline" }

export default async function FeedbackManagerPage() {
  const sb = getSupabaseServer()

  // Small result set (a few hundred rows), but page in chunks as a guard against
  // PostgREST's db-max-rows cap. task_id gives pagination a stable total order.
  const PAGE_SIZE = 1000
  const rows: FeedbackPipelineRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("v_feedback_pipeline")
      .select("*")
      .order("task_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      return (
        <PageShell title="Feedback Report Pipeline">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="font-medium text-destructive">
              Could not load v_feedback_pipeline
            </div>
            <div className="mt-1 text-muted-foreground">{error.message}</div>
          </div>
        </PageShell>
      )
    }

    const page = (data ?? []) as FeedbackPipelineRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  // Stable "today" (UTC calendar day) computed once on the server and passed to
  // the client view, so due-date / aging math never mismatches between the SSR
  // render and hydration.
  const today = new Date().toISOString().slice(0, 10)

  return (
    <PageShell title="Feedback Report Pipeline" hideHeader canvas>
      <FeedbackPipelineView rows={rows} today={today} />
    </PageShell>
  )
}

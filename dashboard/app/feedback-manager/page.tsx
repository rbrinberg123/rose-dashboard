import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { FeedbackManagerRow } from "@/lib/types"
import { FeedbackManagerView } from "./feedback-manager-view"

// ⚗️ CONCEPT PAGE — a standalone Feedback Manager driven by v_feedback_manager
// (one row per active-pipeline event with a "Feedback" task; "Done" events are
// excluded by the view). It does NOT touch the existing /feedback page. To
// remove the experiment: delete this app/feedback-manager folder and the
// "Feedback Mgr" entry in components/nav.tsx.

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Feedback Manager" }

export default async function FeedbackManagerPage() {
  const sb = getSupabaseServer()

  // The active-pipeline set is small (a few hundred events at most), but we
  // still page in PAGE_SIZE chunks as a guard against PostgREST's db-max-rows
  // cap. event_id gives pagination a stable total order.
  const PAGE_SIZE = 1000
  const rows: FeedbackManagerRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("v_feedback_manager")
      .select("*")
      .order("event_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      return (
        <PageShell title="Feedback Manager">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="font-medium text-destructive">
              Could not load v_feedback_manager
            </div>
            <div className="mt-1 text-muted-foreground">{error.message}</div>
          </div>
        </PageShell>
      )
    }

    const page = (data ?? []) as FeedbackManagerRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return (
    <PageShell title="Feedback Manager" hideHeader canvas>
      <FeedbackManagerView rows={rows} />
    </PageShell>
  )
}

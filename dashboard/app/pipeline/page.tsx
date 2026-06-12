import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { Pipeline30dRow, SchedulerMeetingRow } from "@/lib/types"
import { PipelineView } from "./pipeline-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Pipeline (Next 30 Days)" }

export default async function PipelinePage() {
  const sb = getSupabaseServer()

  // Upcoming meetings (next 30 days) — small set, single fetch.
  const pipelineRes = await sb
    .from("v_pipeline_30d")
    .select("*")
    .order("meeting_date", { ascending: true })

  if (pipelineRes.error) {
    return (
      <PageShell title="Pipeline (Next 30 Days)" description="Upcoming meetings by client and event">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_pipeline_30d</div>
          <div className="mt-1 text-muted-foreground">{pipelineRes.error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (pipelineRes.data ?? []) as Pipeline30dRow[]

  // All hosted confirmed meetings (~11k rows) — powers the host suggestions for
  // unassigned pipeline meetings (institution→host / client→host affinity and
  // availability). PostgREST caps a single response at db-max-rows (1,000 by
  // default on Supabase Cloud), so we paginate to get every row.
  const PAGE_SIZE = 1000
  const hosted: SchedulerMeetingRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("v_scheduler_meetings")
      .select("*")
      .order("meeting_day", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      return (
        <PageShell title="Pipeline (Next 30 Days)" description="Upcoming meetings by client and event">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="font-medium text-destructive">Could not load v_scheduler_meetings</div>
            <div className="mt-1 text-muted-foreground">{error.message}</div>
          </div>
        </PageShell>
      )
    }

    const page = (data ?? []) as SchedulerMeetingRow[]
    hosted.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return (
    <PageShell
      title="Pipeline (Next 30 Days)"
      description={`${rows.length.toLocaleString()} meetings on the books`}
      hideHeader
      canvas
    >
      <PipelineView rows={rows} hosted={hosted} />
    </PageShell>
  )
}

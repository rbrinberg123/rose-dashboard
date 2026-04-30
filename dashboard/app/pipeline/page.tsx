import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { Pipeline30dRow } from "@/lib/types"
import { PipelineKpis } from "./pipeline-kpis"
import { PipelineTable } from "./pipeline-table"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Pipeline (Next 30 Days)" }

export default async function PipelinePage() {
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("v_pipeline_30d")
    .select("*")
    .order("meeting_date", { ascending: true })

  if (error) {
    return (
      <PageShell title="Pipeline (Next 30 Days)" description="Upcoming meetings by client and event">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_pipeline_30d</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (data ?? []) as Pipeline30dRow[]

  return (
    <PageShell
      title="Pipeline (Next 30 Days)"
      description={`${rows.length.toLocaleString()} meetings on the books`}
    >
      <PipelineKpis rows={rows} />
      <PipelineTable rows={rows} />
    </PageShell>
  )
}

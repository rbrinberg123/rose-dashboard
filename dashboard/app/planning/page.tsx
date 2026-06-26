import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { PlanningEventRow } from "@/lib/types"
import { PlanningView } from "./planning-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Planning" }

export default async function PlanningPage() {
  const sb = getSupabaseServer()

  // v_planning_events is scoped to upcoming events only (a few hundred rows), so
  // it is small. We still loop in PAGE_SIZE chunks as a guard against
  // PostgREST's db-max-rows cap. The view is pre-ordered by
  // (event_id, meeting_date, meeting_id); we add the same order keys here so
  // pagination has a stable total order.
  const PAGE_SIZE = 1000
  const rows: PlanningEventRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("v_planning_events")
      .select("*")
      .order("event_id", { ascending: true })
      .order("meeting_date", { ascending: true })
      .order("meeting_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      return (
        <PageShell title="Planning">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="font-medium text-destructive">
              Could not load v_planning_events
            </div>
            <div className="mt-1 text-muted-foreground">{error.message}</div>
          </div>
        </PageShell>
      )
    }

    const page = (data ?? []) as PlanningEventRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return (
    <PageShell title="Planning" hideHeader canvas>
      <PlanningView rows={rows} />
    </PageShell>
  )
}

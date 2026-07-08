import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { PlanningEventRow } from "@/lib/types"
import { PlanningV2View } from "./planning-v2-view"

// ⚗️ EXPERIMENTAL SANDBOX COPY of app/planning/page.tsx.
// Reads the SAME v_planning_events view as the real Planning page — no SQL or
// data-layer duplication. Only the UI component (./planning-v2-view) is a copy.
// To remove the experiment: delete this app/planning-v2 folder and the
// "Planning Lab" entry in components/nav.tsx.

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Planning Lab" }

export default async function PlanningV2Page() {
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
        <PageShell title="Planning Lab">
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
    <PageShell title="Planning Lab" hideHeader canvas>
      <PlanningV2View rows={rows} />
    </PageShell>
  )
}

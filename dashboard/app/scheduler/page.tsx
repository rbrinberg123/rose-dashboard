import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { SchedulerMeetingRow, SchedulerUnassignedRow } from "@/lib/types"
import { SchedulerView } from "./scheduler-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Scheduler" }

export default async function SchedulerPage() {
  const sb = getSupabaseServer()

  // ~11k confirmed, hosted meetings. PostgREST caps a single response at
  // db-max-rows (1,000 by default on Supabase Cloud), so we paginate to make
  // sure every row comes back regardless of project setting.
  const PAGE_SIZE = 1000
  const meetings: SchedulerMeetingRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("v_scheduler_meetings")
      .select("*")
      // meeting_day is not unique (many meetings per day); add meeting_id (one
      // row per meeting in this view) as a tiebreaker so pagination has a stable
      // total order and can't drop/duplicate rows across page boundaries.
      .order("meeting_day", { ascending: true })
      .order("meeting_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      return (
        <PageShell title="Scheduler">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="font-medium text-destructive">
              Could not load v_scheduler_meetings
            </div>
            <div className="mt-1 text-muted-foreground">{error.message}</div>
          </div>
        </PageShell>
      )
    }

    const page = (data ?? []) as SchedulerMeetingRow[]
    meetings.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  // Host-less upcoming confirmed meetings. This set is small (host_id IS NULL,
  // today onward), so a single fetch with no pagination is enough.
  const unassignedRes = await sb
    .from("v_scheduler_unassigned")
    .select("*")
    .order("meeting_date", { ascending: true })

  if (unassignedRes.error) {
    return (
      <PageShell title="Scheduler">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">
            Could not load v_scheduler_unassigned
          </div>
          <div className="mt-1 text-muted-foreground">{unassignedRes.error.message}</div>
        </div>
      </PageShell>
    )
  }

  const unassigned = (unassignedRes.data ?? []) as SchedulerUnassignedRow[]

  return (
    <PageShell title="Scheduler" hideHeader canvas>
      <SchedulerView meetings={meetings} unassigned={unassigned} />
    </PageShell>
  )
}

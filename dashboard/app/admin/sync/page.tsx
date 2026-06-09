import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { SyncStatusView, type SyncRunRow, type SyncErrorRow } from "./sync-status-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Sync Status" }

export default async function SyncStatusPage() {
  const sb = getSupabaseServer()

  const [runsRes, errorsRes] = await Promise.all([
    sb.from("sync_runs").select("*").order("entity_name", { ascending: true }),
    sb
      .from("sync_errors")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
  ])

  const firstError = runsRes.error ?? errorsRes.error
  if (firstError) {
    return (
      <PageShell title="Sync Status" description="Nightly Dynamics → Supabase sync">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load sync status</div>
          <div className="mt-1 text-muted-foreground">{firstError.message}</div>
        </div>
      </PageShell>
    )
  }

  const runs = (runsRes.data ?? []) as SyncRunRow[]
  const errors = (errorsRes.data ?? []) as SyncErrorRow[]

  return (
    <PageShell
      title="Sync Status"
      description="Nightly Dynamics → Supabase sync (runs 7 AM UTC)"
    >
      <SyncStatusView runs={runs} errors={errors} />
    </PageShell>
  )
}

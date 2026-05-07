import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { ClientStatisticsRow } from "@/lib/types"
import { ClientStatisticsView } from "./client-statistics-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Client Statistics" }

export default async function ClientStatisticsPage() {
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("v_client_statistics")
    .select("*")
    .single()

  if (error) {
    return (
      <PageShell title="Client Statistics" description="Top-line numbers across the client book">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_client_statistics</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
        </div>
      </PageShell>
    )
  }

  const row = data as ClientStatisticsRow

  return (
    <PageShell title="Client Statistics" description="Top-line numbers across the client book">
      <ClientStatisticsView row={row} />
    </PageShell>
  )
}

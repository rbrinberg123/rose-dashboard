import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { ClientMarketingStatusRow } from "@/lib/types"
import { MarketingStatusTable } from "./marketing-status-table"

// Always fetch fresh — the view recomputes on every read (event timeline and
// feedback-task lifecycle both move daily).
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Client Marketing Status" }

export default async function ClientMarketingStatusPage() {
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("v_client_marketing_status")
    .select("*")
    .order("name", { ascending: true })

  if (error) {
    return (
      <PageShell
        title="Client Marketing Status"
        description="One row per active client — event timeline + feedback-report lifecycle"
      >
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">
            Could not load v_client_marketing_status
          </div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (data ?? []) as ClientMarketingStatusRow[]

  return (
    <PageShell
      title="Client Marketing Status"
      description={`${rows.length.toLocaleString()} active clients — event timeline + feedback-report lifecycle`}
      hideHeader
      canvas
    >
      <MarketingStatusTable rows={rows} />
    </PageShell>
  )
}

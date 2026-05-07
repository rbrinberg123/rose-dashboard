import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { ClientStatisticsRow, ClientStatsBucketRow } from "@/lib/types"
import { ClientStatisticsView } from "./client-statistics-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Client Statistics" }

export default async function ClientStatisticsPage() {
  const sb = getSupabaseServer()

  const [statsRes, marketCapRes, regionRes, sectorRes] = await Promise.all([
    sb.from("v_client_statistics").select("*").single(),
    sb.from("v_client_stats_by_market_cap").select("*").order("display_order"),
    sb.from("v_client_stats_by_region").select("*").order("display_order"),
    sb.from("v_client_stats_by_sector").select("*"),
  ])

  const firstError =
    statsRes.error ?? marketCapRes.error ?? regionRes.error ?? sectorRes.error
  if (firstError) {
    return (
      <PageShell title="Client Statistics" description="Top-line numbers across the client book">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load Client Statistics views</div>
          <div className="mt-1 text-muted-foreground">{firstError.message}</div>
        </div>
      </PageShell>
    )
  }

  const row = statsRes.data as ClientStatisticsRow
  const marketCap = (marketCapRes.data ?? []) as ClientStatsBucketRow[]
  const region = (regionRes.data ?? []) as ClientStatsBucketRow[]
  const sector = (sectorRes.data ?? []) as ClientStatsBucketRow[]

  return (
    <PageShell title="Client Statistics" description="Top-line numbers across the client book">
      <ClientStatisticsView
        row={row}
        marketCap={marketCap}
        region={region}
        sector={sector}
      />
    </PageShell>
  )
}

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { ClientPortfolioRow } from "@/lib/types"
import { PortfolioKpis } from "./portfolio-kpis"
import { PortfolioTable } from "./portfolio-table"

// Always fetch fresh from Supabase; the views recompute on every read and we
// don't want stale margin numbers hanging around in the static cache.
export const dynamic = "force-dynamic"

export default async function ClientPortfolioPage() {
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("v_client_portfolio")
    .select("*")
    .order("name", { ascending: true })

  if (error) {
    return (
      <PageShell title="Client Portfolio" description="One row per client — health at a glance">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_client_portfolio</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (data ?? []) as ClientPortfolioRow[]

  return (
    <PageShell
      title="Client Portfolio"
      description={`${rows.length.toLocaleString()} clients — health at a glance`}
    >
      <PortfolioKpis rows={rows} />
      <PortfolioTable rows={rows} />
    </PageShell>
  )
}

import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { ClientPortfolioRow } from "@/lib/types"
import { PortfolioTable } from "./portfolio-table"

// Always fetch fresh from Supabase; the views recompute on every read and we
// don't want stale margin numbers hanging around in the static cache.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Client Portfolio" }

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

  // v_client_portfolio only exposes the account manager (sales_lead_primary_name).
  // The other three account-team roles live on the accounts table, so pull them
  // in one bulk read and merge by account_id. Mirrors what Client Detail does.
  const { data: teamData } = await sb
    .from("accounts")
    .select(
      "account_id, secondary_manager_name, associate_name, logistics_coordinator_name",
    )
  const teamById = new Map(
    (teamData ?? []).map((t) => [t.account_id as string, t]),
  )

  const rows = ((data ?? []) as ClientPortfolioRow[]).map((r) => {
    const t = teamById.get(r.account_id)
    return {
      ...r,
      secondary_manager_name: (t?.secondary_manager_name ?? null) as string | null,
      associate_name: (t?.associate_name ?? null) as string | null,
      logistics_coordinator_name:
        (t?.logistics_coordinator_name ?? null) as string | null,
    }
  })

  return (
    <PageShell
      title="Client Portfolio"
      description={`${rows.length.toLocaleString()} clients — health at a glance`}
      hideHeader
    >
      <PortfolioTable rows={rows} />
    </PageShell>
  )
}

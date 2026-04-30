import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { ClientQuarterlyPnlRow } from "@/lib/types"
import { MarginView } from "./margin-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Margin by Client" }

export default async function MarginPage() {
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("v_client_quarterly_pnl")
    .select("*")
    .order("period_year", { ascending: false })
    .order("period_quarter", { ascending: false })
    .order("client_account_name", { ascending: true })

  if (error) {
    return (
      <PageShell title="Margin by Client" description="Revenue minus labor, direct costs, and overhead">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_client_quarterly_pnl</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (data ?? []) as ClientQuarterlyPnlRow[]

  return (
    <PageShell
      title="Margin by Client"
      description="Revenue minus labor, direct costs, and overhead"
    >
      <MarginView rows={rows} />
    </PageShell>
  )
}

import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { ContractRenewalRow } from "@/lib/types"
import { RenewalsKpis } from "./renewals-kpis"
import { RenewalsTable } from "./renewals-table"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Contract Renewals" }

export default async function RenewalsPage() {
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("v_contract_renewals")
    .select("*")
    .order("contract_renewal_date", { ascending: true })

  if (error) {
    return (
      <PageShell title="Contract Renewals" description="Renewal calendar and ARR exposure">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_contract_renewals</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (data ?? []) as ContractRenewalRow[]

  return (
    <PageShell
      title="Contract Renewals"
      description={`${rows.length.toLocaleString()} active contracts on the renewal calendar`}
    >
      <RenewalsKpis rows={rows} />
      <RenewalsTable rows={rows} />
    </PageShell>
  )
}

import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { ContractManagementRow } from "@/lib/types"
import { ContractManagementView } from "./contract-management-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Contract Management" }

export default async function ContractManagementPage() {
  const sb = getSupabaseServer()

  const res = await sb.from("v_contract_management").select("*")

  if (res.error) {
    return (
      <PageShell title="Contract Management" description="All active clients · sorted by soonest contract expiry">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load Contract Management</div>
          <div className="mt-1 text-muted-foreground">{res.error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (res.data ?? []) as ContractManagementRow[]

  return (
    <PageShell title="Contract Management" description="All active clients · sorted by soonest contract expiry">
      <ContractManagementView rows={rows} />
    </PageShell>
  )
}

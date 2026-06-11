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

  // contract_url isn't exposed by v_contract_management, so look it up from the
  // contracts table by contract_id and attach it to each row.
  const contractIds = Array.from(
    new Set(rows.map((r) => r.contract_id).filter((id): id is string => Boolean(id))),
  )
  const urlByContractId = new Map<string, string | null>()
  if (contractIds.length > 0) {
    const urlRes = await sb
      .from("contracts")
      .select("contract_id, contract_url")
      .in("contract_id", contractIds)
    for (const c of (urlRes.data ?? []) as {
      contract_id: string
      contract_url: string | null
    }[]) {
      urlByContractId.set(c.contract_id, c.contract_url ?? null)
    }
  }
  const rowsWithUrl: ContractManagementRow[] = rows.map((r) => ({
    ...r,
    contract_url: r.contract_id ? urlByContractId.get(r.contract_id) ?? null : null,
  }))

  return (
    <PageShell
      title="Contract Management"
      description="All active clients · sorted by soonest contract expiry"
      hideHeader
    >
      <ContractManagementView rows={rowsWithUrl} />
    </PageShell>
  )
}

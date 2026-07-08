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

  // Contract fields aren't on v_client_portfolio either. Pull them from
  // v_contract_management (the same view the Contract tab uses) in one bulk read
  // and merge by account_id, so Term End / Days Left / Auto-Renew / Status match.
  const { data: contractData } = await sb
    .from("v_contract_management")
    .select(
      "account_id, contract_id, initial_term_end, days_to_expiry, auto_renew, contract_status_label, has_active_contract, total_contract_count",
    )
  const contractById = new Map(
    (contractData ?? []).map((c) => [c.account_id as string, c]),
  )

  // contract_url isn't on v_contract_management, so look it up from the contracts
  // table by contract_id and attach it per client. Mirrors the Contract tab.
  const contractIds = Array.from(
    new Set(
      (contractData ?? [])
        .map((c) => c.contract_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
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

  const rows = ((data ?? []) as ClientPortfolioRow[]).map((r) => {
    const t = teamById.get(r.account_id)
    const c = contractById.get(r.account_id)
    const contractId = (c?.contract_id ?? null) as string | null
    return {
      ...r,
      secondary_manager_name: (t?.secondary_manager_name ?? null) as string | null,
      associate_name: (t?.associate_name ?? null) as string | null,
      logistics_coordinator_name:
        (t?.logistics_coordinator_name ?? null) as string | null,
      initial_term_end: (c?.initial_term_end ?? null) as string | null,
      days_to_expiry: (c?.days_to_expiry ?? null) as number | null,
      auto_renew: (c?.auto_renew ?? null) as boolean | null,
      contract_status_label: (c?.contract_status_label ?? null) as string | null,
      has_active_contract: (c?.has_active_contract ?? null) as boolean | null,
      total_contract_count: (c?.total_contract_count ?? null) as number | null,
      contract_url: contractId
        ? urlByContractId.get(contractId) ?? null
        : null,
    }
  })

  return (
    <PageShell
      title="Client Portfolio"
      description={`${rows.length.toLocaleString()} clients — health at a glance`}
      hideHeader
      canvas
    >
      <PortfolioTable rows={rows} />
    </PageShell>
  )
}

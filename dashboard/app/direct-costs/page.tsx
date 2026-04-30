import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { ClientDirectCostRow, AccountOption, UserOption } from "@/lib/types"
import { DirectCostForm } from "./direct-cost-form"
import { DirectCostsTable } from "./direct-costs-table"

export const dynamic = "force-dynamic"

export default async function DirectCostsPage() {
  const sb = getSupabaseServer()

  const [costsRes, accountsRes, usersRes] = await Promise.all([
    sb
      .from("client_direct_costs")
      .select("*")
      .order("cost_date", { ascending: false })
      .order("created_at", { ascending: false }),
    sb
      .from("accounts")
      .select("account_id, name, ticker_symbol")
      .order("name", { ascending: true }),
    sb
      .from("users")
      .select("user_id, display_name")
      .order("display_name", { ascending: true }),
  ])

  const firstError = costsRes.error ?? accountsRes.error ?? usersRes.error
  if (firstError) {
    return (
      <PageShell title="Direct Costs" description="T&E, event fees, and ad-hoc client charges">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load direct costs</div>
          <div className="mt-1 text-muted-foreground">{firstError.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (costsRes.data ?? []) as ClientDirectCostRow[]
  const accounts = (accountsRes.data ?? []) as AccountOption[]
  const users = (usersRes.data ?? []) as UserOption[]

  return (
    <PageShell
      title="Direct Costs"
      description="T&E, event fees, and ad-hoc client charges"
    >
      <DirectCostForm accounts={accounts} />
      <DirectCostsTable rows={rows} accounts={accounts} users={users} />
    </PageShell>
  )
}

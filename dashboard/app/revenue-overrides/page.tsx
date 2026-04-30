import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { RevenueOverrideRow, AccountOption } from "@/lib/types"
import { RevenueOverrideForm } from "./revenue-override-form"
import { RevenueOverridesTable } from "./revenue-overrides-table"

export const dynamic = "force-dynamic"

export default async function RevenueOverridesPage() {
  const sb = getSupabaseServer()

  const [overridesRes, accountsRes] = await Promise.all([
    sb
      .from("revenue_overrides")
      .select("*")
      .order("period_year", { ascending: false })
      .order("period_quarter", { ascending: false })
      .order("created_at", { ascending: false }),
    sb
      .from("accounts")
      .select("account_id, name, ticker_symbol")
      .order("name", { ascending: true }),
  ])

  const firstError = overridesRes.error ?? accountsRes.error
  if (firstError) {
    return (
      <PageShell title="Revenue Overrides" description="Manual adjustments to contract-derived revenue">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load revenue overrides</div>
          <div className="mt-1 text-muted-foreground">{firstError.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (overridesRes.data ?? []) as RevenueOverrideRow[]
  const accounts = (accountsRes.data ?? []) as AccountOption[]

  return (
    <PageShell
      title="Revenue Overrides"
      description="Manual adjustments to contract-derived revenue"
    >
      <RevenueOverrideForm accounts={accounts} />
      <RevenueOverridesTable rows={rows} accounts={accounts} />
    </PageShell>
  )
}

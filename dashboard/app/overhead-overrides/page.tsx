import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type {
  AccountOption,
  OverheadOverrideRow,
  OverheadPeriodRow,
} from "@/lib/types"
import { OverheadOverridesTable } from "./overhead-overrides-table"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Overhead Overrides" }

export default async function OverheadOverridesPage() {
  const sb = getSupabaseServer()

  const [overridesRes, accountsRes, periodsRes] = await Promise.all([
    sb
      .from("overhead_overrides")
      .select("*")
      .order("period_year", { ascending: false })
      .order("period_quarter", { ascending: false }),
    sb
      .from("accounts")
      .select("account_id, name, ticker_symbol")
      .order("name", { ascending: true }),
    sb.from("overhead_periods").select("*"),
  ])

  const firstError = overridesRes.error ?? accountsRes.error ?? periodsRes.error
  if (firstError) {
    return (
      <PageShell title="Overhead Overrides" description="Direct overhead allocation for advisory clients">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load overhead overrides</div>
          <div className="mt-1 text-muted-foreground">{firstError.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (overridesRes.data ?? []) as OverheadOverrideRow[]
  const accounts = (accountsRes.data ?? []) as AccountOption[]
  const periods = (periodsRes.data ?? []) as OverheadPeriodRow[]

  return (
    <PageShell
      title="Overhead Overrides"
      description="Direct overhead allocation for advisory clients"
    >
      <OverheadOverridesTable rows={rows} accounts={accounts} periods={periods} />
    </PageShell>
  )
}

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { OverheadPeriodRow } from "@/lib/types"
import { OverheadPeriodsTable } from "./overhead-periods-table"

export const dynamic = "force-dynamic"

export default async function QuarterlyOverheadPage() {
  const sb = getSupabaseServer()

  // Fetch periods plus an aggregate of how many overrides reference each
  // (year, quarter). The dialog uses this to warn before changes that affect
  // existing overrides.
  const [periodsRes, overridesRes] = await Promise.all([
    sb
      .from("overhead_periods")
      .select("*")
      .order("period_year", { ascending: false })
      .order("period_quarter", { ascending: false }),
    sb.from("overhead_overrides").select("period_year, period_quarter"),
  ])

  if (periodsRes.error) {
    return (
      <PageShell title="Quarterly Overhead" description="Total overhead pot allocated each quarter">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load overhead_periods</div>
          <div className="mt-1 text-muted-foreground">{periodsRes.error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (periodsRes.data ?? []) as OverheadPeriodRow[]

  // Index overrides by period_id by matching (year, quarter).
  const counts: Record<number, number> = {}
  if (!overridesRes.error && overridesRes.data) {
    const overridesByYQ = new Map<string, number>()
    for (const o of overridesRes.data as { period_year: number; period_quarter: number }[]) {
      const key = `${o.period_year}-${o.period_quarter}`
      overridesByYQ.set(key, (overridesByYQ.get(key) ?? 0) + 1)
    }
    for (const r of rows) {
      counts[r.id] = overridesByYQ.get(`${r.period_year}-${r.period_quarter}`) ?? 0
    }
  }

  return (
    <PageShell
      title="Quarterly Overhead"
      description="Total overhead pot allocated each quarter"
    >
      <OverheadPeriodsTable rows={rows} overrideCountsByPeriodId={counts} />
    </PageShell>
  )
}

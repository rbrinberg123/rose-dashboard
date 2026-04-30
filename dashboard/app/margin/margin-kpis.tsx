import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatPercent } from "@/lib/format"
import type { ClientQuarterlyPnlRow } from "@/lib/types"

/**
 * KPI strip rolls up all rows for the selected quarter.
 *
 * "Average margin %" is a weighted figure: total margin / total revenue.
 * Averaging the per-client margin_pct directly would over-weight tiny
 * clients, so we recompute from totals.
 */
export function MarginKpis({ rows }: { rows: ClientQuarterlyPnlRow[] }) {
  const totalRevenue = rows.reduce((s, r) => s + (r.revenue ?? 0), 0)
  const totalLabor = rows.reduce((s, r) => s + (r.meeting_labor_cost ?? 0), 0)
  const totalDirect = rows.reduce((s, r) => s + (r.direct_cost ?? 0), 0)
  const totalOverhead = rows.reduce((s, r) => s + (r.overhead_share ?? 0), 0)
  const totalMargin = rows.reduce((s, r) => s + (r.margin ?? 0), 0)
  const avgMarginPct = totalRevenue > 0 ? totalMargin / totalRevenue : null

  const kpis = [
    { label: "Total revenue", value: formatCurrency(totalRevenue), hint: `${rows.length} clients` },
    { label: "Total labor cost", value: formatCurrency(totalLabor), hint: "Booker + host meeting cost" },
    { label: "Total direct costs", value: formatCurrency(totalDirect), hint: "Per-client direct costs" },
    { label: "Total overhead", value: formatCurrency(totalOverhead), hint: "Allocated by meeting share" },
    { label: "Total margin", value: formatCurrency(totalMargin), hint: "Revenue − labor − direct − overhead" },
    { label: "Avg margin %", value: formatPercent(avgMarginPct), hint: "Weighted by revenue" },
  ]

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
      {kpis.map((k) => (
        <Card key={k.label}>
          <CardHeader className="pb-2">
            <CardDescription>{k.label}</CardDescription>
            <CardTitle className="text-xl tabular-nums">{k.value}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">{k.hint}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

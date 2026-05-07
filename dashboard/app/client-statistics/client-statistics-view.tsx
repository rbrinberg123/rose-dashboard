import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"
import type { ClientStatisticsRow } from "@/lib/types"

export function ClientStatisticsView({ row }: { row: ClientStatisticsRow }) {
  const kpis = [
    {
      label: "Active Accounts",
      value: row.active_account_count.toLocaleString(),
      hint: "Active records in CRM",
    },
    {
      label: "Annualized Retainer Revenue",
      value: formatCurrency(row.annualized_retainer_revenue),
      hint: "Quarterly retainer × 4, active contracts",
    },
    {
      label: "Avg Annualized Retainer / Account",
      value: formatCurrency(row.avg_annualized_retainer),
      hint: "Per active account",
    },
  ]

  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {kpis.map((k) => (
        <Card key={k.label}>
          <CardHeader className="pb-2">
            <CardDescription>{k.label}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{k.value}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">{k.hint}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

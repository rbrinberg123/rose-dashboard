import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"
import type { ClientPortfolioRow } from "@/lib/types"

/**
 * Top-of-page KPI strip. Computed server-side from the same row set the
 * table renders, so the numbers and the table can never disagree.
 *
 * "Active clients" uses account_state (the Dynamics state of the account
 * record), not client_status_label (which has values like Current/Past/Pitch).
 * Active vs. Inactive is the sharper "is this an account record we still
 * care about" cut.
 */
export function PortfolioKpis({ rows }: { rows: ClientPortfolioRow[] }) {
  const total = rows.length
  const active = rows.filter((r) => r.account_state === "Active").length
  const revenue = rows.reduce((s, r) => s + (r.current_quarter_revenue ?? 0), 0)
  const margin = rows.reduce((s, r) => s + (r.current_quarter_margin ?? 0), 0)

  const kpis = [
    { label: "Total clients", value: total.toLocaleString(), hint: "All client records in the portfolio" },
    { label: "Active accounts", value: active.toLocaleString(), hint: `${total - active} inactive` },
    { label: "Current Q revenue", value: formatCurrency(revenue), hint: "Sum across all clients" },
    { label: "Current Q margin", value: formatCurrency(margin), hint: "Revenue − labor − direct − overhead" },
  ]

  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

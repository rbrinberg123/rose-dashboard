import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"
import type { ContractRenewalRow } from "@/lib/types"

/**
 * KPI strip for renewals. "ARR at risk in next 90d" sums quarterly_retainer × 4
 * for contracts whose urgency is overdue / urgent / soon — i.e. anything
 * within the 90-day horizon. Contracts with NULL retainer count toward the
 * urgency buckets but contribute $0 to the ARR sum.
 */
export function RenewalsKpis({ rows }: { rows: ContractRenewalRow[] }) {
  const overdue = rows.filter((r) => r.renewal_urgency === "overdue").length
  const urgent = rows.filter((r) => r.renewal_urgency === "urgent").length
  const soon = rows.filter((r) => r.renewal_urgency === "soon").length

  const arrAtRisk = rows
    .filter((r) =>
      r.renewal_urgency === "overdue" ||
      r.renewal_urgency === "urgent" ||
      r.renewal_urgency === "soon",
    )
    .reduce((s, r) => s + (r.quarterly_retainer ?? 0) * 4, 0)

  const kpis = [
    { label: "Overdue", value: overdue.toLocaleString(), hint: "Renewal date is in the past" },
    { label: "Urgent (<30d)", value: urgent.toLocaleString(), hint: "Within next 30 days" },
    { label: "Soon (<90d)", value: soon.toLocaleString(), hint: "Within next 90 days" },
    { label: "ARR at risk (90d)", value: formatCurrency(arrAtRisk), hint: "Quarterly retainer × 4" },
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

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { Pipeline30dRow } from "@/lib/types"

/**
 * KPI strip for pipeline rows. Booleans from Postgres can technically be NULL
 * if the underlying meeting field was missing, so we treat NULL as "not in
 * person / not virtual / not group" — only meetings explicitly flagged true
 * count toward the slice.
 */
export function PipelineKpis({ rows }: { rows: Pipeline30dRow[] }) {
  const total = rows.length
  const inPerson = rows.filter((r) => r.is_in_person === true).length
  const virtual = rows.filter((r) => r.is_in_person === false).length
  const group = rows.filter((r) => r.group_meeting === true).length

  const kpis = [
    { label: "Meetings (next 30d)", value: total.toLocaleString(), hint: "Active, not cancelled" },
    { label: "In-person", value: inPerson.toLocaleString(), hint: `${total - inPerson} not in-person` },
    { label: "Virtual", value: virtual.toLocaleString(), hint: `${total - virtual} not virtual` },
    { label: "Group meetings", value: group.toLocaleString(), hint: `${total - group} 1:1 or unspecified` },
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

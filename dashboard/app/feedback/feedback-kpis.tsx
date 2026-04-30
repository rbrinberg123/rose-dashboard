import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatPercent, formatQuarter } from "@/lib/format"
import type { FeedbackOverallRow } from "@/lib/types"

/**
 * Overall-tab KPIs. The "current quarter" KPIs use the most recent quarter
 * present in v_feedback_overall — that's the source of truth for what
 * actually has data, rather than EXTRACT from today's date.
 */
export function FeedbackKpis({ rows }: { rows: FeedbackOverallRow[] }) {
  const sortedDesc = [...rows].sort((a, b) => {
    if (a.period_year !== b.period_year) return b.period_year - a.period_year
    return b.period_quarter - a.period_quarter
  })

  const latest = sortedDesc[0]
  const prev = sortedDesc[1]

  const allTimeMeetings = rows.reduce((s, r) => s + (r.total_meetings ?? 0), 0)
  const allTimeFeedback = rows.reduce((s, r) => s + (r.meetings_with_feedback ?? 0), 0)
  const allTimeRate = allTimeMeetings > 0 ? allTimeFeedback / allTimeMeetings : null

  const kpis = [
    {
      label: "Latest quarter",
      value: latest ? formatQuarter(latest.period_year, latest.period_quarter) : "—",
      hint: latest ? `${latest.total_meetings.toLocaleString()} meetings` : "No data",
    },
    {
      label: "Latest feedback rate",
      value: formatPercent(latest?.feedback_rate ?? null),
      hint: latest ? `${latest.meetings_with_feedback.toLocaleString()} of ${latest.total_meetings.toLocaleString()}` : "—",
    },
    {
      label: "Prior quarter rate",
      value: formatPercent(prev?.feedback_rate ?? null),
      hint: prev ? formatQuarter(prev.period_year, prev.period_quarter) : "—",
    },
    {
      label: "All-time rate",
      value: formatPercent(allTimeRate),
      hint: `${allTimeFeedback.toLocaleString()} of ${allTimeMeetings.toLocaleString()}`,
    },
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

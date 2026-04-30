import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatPercent } from "@/lib/format"
import type { AnalystActivityRow } from "@/lib/types"

/**
 * KPI strip shows quarter-scoped totals (computed from rows already filtered
 * by year+quarter on the page) so the strip and table never disagree.
 *
 * "Firm-wide feedback rate" is meetings_with_feedback / non-cancelled hosted
 * meetings, computed from the filtered set rather than reading
 * v_feedback_overall — keeps it consistent with what the table shows.
 */
export function AnalystKpis({ rows }: { rows: AnalystActivityRow[] }) {
  const analysts = rows.length
  const totalMeetings = rows.reduce((s, r) => s + (r.meetings_hosted ?? 0), 0)
  const totalFeedback = rows.reduce((s, r) => s + (r.feedback_collected_hosted ?? 0), 0)
  const totalCancelledHosted = rows.reduce((s, r) => s + (r.meetings_cancelled_hosted ?? 0), 0)
  const denom = totalMeetings - totalCancelledHosted
  const feedbackRate = denom > 0 ? totalFeedback / denom : null

  const kpis = [
    { label: "Analysts active", value: analysts.toLocaleString(), hint: "Anyone who booked or hosted" },
    { label: "Meetings hosted", value: totalMeetings.toLocaleString(), hint: "All hosted in this quarter" },
    { label: "Feedback collected", value: totalFeedback.toLocaleString(), hint: "Closed - All in" },
    { label: "Firm-wide feedback rate", value: formatPercent(feedbackRate), hint: "Excludes cancelled" },
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

"use client"

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"
import { formatPercent, formatQuarter } from "@/lib/format"
import type { FeedbackOverallRow } from "@/lib/types"

/**
 * Firm-wide feedback rate by quarter. Quarters are emitted oldest → newest
 * so the line reads left-to-right as time progresses. Recharts wants flat
 * numeric data so we precompute a `pct` field (% in 0..100) for the Y axis.
 */
export function FeedbackTrend({ rows }: { rows: FeedbackOverallRow[] }) {
  const data = [...rows]
    .sort((a, b) => {
      if (a.period_year !== b.period_year) return a.period_year - b.period_year
      return a.period_quarter - b.period_quarter
    })
    .map((r) => ({
      label: formatQuarter(r.period_year, r.period_quarter),
      pct: r.feedback_rate == null ? null : Math.round(r.feedback_rate * 1000) / 10,
      total: r.total_meetings,
      withFeedback: r.meetings_with_feedback,
      rate: r.feedback_rate,
    }))

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No quarters with data yet.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-medium">Firm-wide feedback rate by quarter</h3>
        <p className="text-xs text-muted-foreground">{data.length} quarters</p>
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tickFormatter={(v) => `${v}%`}
              domain={[0, 100]}
              width={36}
            />
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 12,
              }}
              formatter={(_v, _n, item) => {
                const d = item?.payload as { rate: number | null; withFeedback: number; total: number }
                return [`${formatPercent(d.rate)} (${d.withFeedback}/${d.total})`, "Feedback rate"]
              }}
            />
            <Line
              type="monotone"
              dataKey="pct"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--primary)" }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

"use client"

import * as React from "react"
import { GradientHero } from "@/components/gradient-hero"
import { StatCard } from "@/components/stat-card"
import { PRODUCTIVITY_CARD_GRADIENTS } from "@/lib/gradients"
import { formatDate, formatPercent } from "@/lib/format"
import type { ProductivityRoleRow } from "@/lib/types"
import { DateRangeControl } from "./date-range-control"
import { ProductivityTable } from "./productivity-table"

export function ProductivityView({
  from,
  to,
  rows,
}: {
  from: string
  to: string
  rows: ProductivityRoleRow[]
}) {
  // Firm-wide totals for the selected range — recomputed whenever the
  // in-range rows change (i.e. when the date range is changed).
  const summary = React.useMemo(() => {
    let scheduled = 0
    let hosted = 0
    let inPerson = 0
    let feedback = 0
    let active = 0
    for (const r of rows) {
      scheduled += r.booked
      hosted += r.hosted
      inPerson += r.in_person_hosted
      feedback += r.feedback
      if (r.booked > 0 || r.hosted > 0) active += 1
    }
    return {
      scheduled,
      hosted,
      inPerson,
      feedback,
      active,
      inPersonShare: hosted > 0 ? inPerson / hosted : null,
      feedbackRate: hosted > 0 ? feedback / hosted : null,
    }
  }, [rows])

  return (
    <>
      <div className="mb-4">
        <GradientHero
          title="Productivity Summary"
          subtitle={`Activity by person · ${formatDate(from)} – ${formatDate(to)}`}
          rightSlot={<DateRangeControl from={from} to={to} tone="hero" />}
        />
      </div>

      {/* Activity summary — firm-wide totals across the selected range. */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Meetings scheduled"
          value={summary.scheduled.toLocaleString()}
          gradient={PRODUCTIVITY_CARD_GRADIENTS.scheduled}
        />
        <StatCard
          label="Hosted"
          value={summary.hosted.toLocaleString()}
          gradient={PRODUCTIVITY_CARD_GRADIENTS.hosted}
        />
        <StatCard
          label="In-person share"
          value={formatPercent(summary.inPersonShare)}
          hint="of hosted"
          gradient={PRODUCTIVITY_CARD_GRADIENTS.inPerson}
        />
        <StatCard
          label="Feedback rate"
          value={formatPercent(summary.feedbackRate)}
          hint="feedback ÷ hosted"
          gradient={PRODUCTIVITY_CARD_GRADIENTS.feedback}
        />
        <StatCard
          label="Active people"
          value={summary.active.toLocaleString()}
          gradient={PRODUCTIVITY_CARD_GRADIENTS.activeClients}
        />
      </div>

      <ProductivityTable rows={rows} />
    </>
  )
}

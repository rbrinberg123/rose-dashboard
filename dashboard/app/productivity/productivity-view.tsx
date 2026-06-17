"use client"

import * as React from "react"
import { ListTitleCard } from "@/components/page-masthead"
import { StatCard } from "@/components/stat-card"
import { formatDate, formatPercent, formatPercent0 } from "@/lib/format"
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
    let booked = 0
    let hosted = 0
    let inPerson = 0
    let feedback = 0
    let feedbackClosed = 0
    let active = 0
    for (const r of rows) {
      booked += r.booked
      hosted += r.hosted
      inPerson += r.in_person_hosted
      feedback += r.feedback
      feedbackClosed += r.feedback_closed
      if (r.booked > 0 || r.hosted > 0) active += 1
    }
    return {
      booked,
      hosted,
      inPerson,
      feedback,
      feedbackClosed,
      active,
      inPersonShare: hosted > 0 ? inPerson / hosted : null,
      // collected ÷ closed — same definition as Client / Institution Detail.
      feedbackRate: feedbackClosed > 0 ? feedback / feedbackClosed : null,
    }
  }, [rows])

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          title="Productivity Summary"
          subtitle={`Activity by person · ${formatDate(from)} – ${formatDate(to)}`}
          rightSlot={<DateRangeControl from={from} to={to} />}
        />
      </div>

      {/* Activity summary — firm-wide totals across the selected range. */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          floating
          label="Meetings booked"
          value={summary.booked.toLocaleString()}
        />
        <StatCard floating label="Hosted" value={summary.hosted.toLocaleString()} />
        <StatCard
          floating
          label="In-person share"
          value={formatPercent(summary.inPersonShare)}
          hint="of hosted"
        />
        <StatCard
          floating
          label="Feedback rate"
          value={formatPercent0(summary.feedbackRate)}
          hint={`${summary.feedback.toLocaleString()} of ${summary.feedbackClosed.toLocaleString()} closed`}
        />
        <StatCard
          floating
          label="Active people"
          value={summary.active.toLocaleString()}
        />
      </div>

      <ProductivityTable rows={rows} />
    </>
  )
}

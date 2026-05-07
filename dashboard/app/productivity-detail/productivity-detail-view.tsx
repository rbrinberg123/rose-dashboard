"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { formatCurrency } from "@/lib/format"
import type { ProductivityDetailRow } from "@/lib/types"

const NAVY = "#1E2858"
const TEAL = "#00B8B8"

function formatCompactDollars(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0"
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`
  return formatCurrency(value)
}

export function ProductivityDetailView({ rows }: { rows: ProductivityDetailRow[] }) {
  const [selectedId, setSelectedId] = React.useState<string | undefined>(rows[0]?.display_name)

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        No users with activity in the trailing 12 months.
      </div>
    )
  }

  const selectedIndex = Math.max(
    0,
    rows.findIndex((r) => r.display_name === selectedId),
  )
  const selected = rows[selectedIndex]

  const goPrev = () => {
    const next = (selectedIndex - 1 + rows.length) % rows.length
    setSelectedId(rows[next].display_name)
  }
  const goNext = () => {
    const next = (selectedIndex + 1) % rows.length
    setSelectedId(rows[next].display_name)
  }

  const inPersonPct =
    selected.meetings_hosted_12m > 0
      ? Math.round((selected.meetings_in_person_12m / selected.meetings_hosted_12m) * 100)
      : 0

  const feedbackPctText =
    selected.feedback_collection_rate_12m == null
      ? "—"
      : `${Math.round(selected.feedback_collection_rate_12m * 100)}%`

  const tiles: Array<{
    label: string
    value: string
    hint: string
    valueColor?: string
  }> = [
    {
      label: "Scheduled",
      value: selected.meetings_scheduled_12m.toLocaleString(),
      hint: "As booker",
    },
    {
      label: "Hosted",
      value: selected.meetings_hosted_12m.toLocaleString(),
      hint: "As host",
    },
    {
      label: "In Person",
      value: selected.meetings_in_person_12m.toLocaleString(),
      hint: `${inPersonPct}% of hosted`,
    },
    {
      label: "Feedback Rec'd",
      value: feedbackPctText,
      hint: "Of hosted meetings",
      valueColor: TEAL,
    },
    {
      label: "Active Clients",
      value: selected.active_clients_as_sales_lead.toLocaleString(),
      hint: "As sales lead",
    },
    {
      label: "Sales Lead Book",
      value: formatCompactDollars(selected.sales_lead_book_annualized),
      hint: "Annualized retainer",
    },
  ]

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            className="text-2xl font-medium tracking-tight"
            style={{ color: NAVY }}
          >
            Productivity Detail · {selected.display_name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Activity over the trailing 12 months
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous person"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card hover:bg-accent"
          >
            <ChevronLeft className="size-4" />
          </button>
          <select
            value={selected.display_name}
            onChange={(e) => setSelectedId(e.target.value)}
            className="h-9 min-w-[200px] rounded-md border border-border bg-card px-2 text-sm"
            aria-label="Select person"
          >
            {rows.map((r) => (
              <option key={r.display_name} value={r.display_name}>
                {r.display_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={goNext}
            aria-label="Next person"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card hover:bg-accent"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-lg border bg-slate-50 p-3.5"
          >
            <div
              className="text-2xl font-medium tracking-tight tabular-nums"
              style={{ color: t.valueColor ?? NAVY }}
            >
              {t.value}
            </div>
            <div
              className="mt-1 text-xs font-medium"
              style={{ color: NAVY }}
            >
              {t.label}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {t.hint}
            </div>
          </div>
        ))}
      </div>

      <div className="my-6 flex items-center gap-3">
        <span
          className="shrink-0 text-base font-medium"
          style={{ color: NAVY }}
        >
          Monthly Activity
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
        Charts coming in Phase 2
      </div>
    </>
  )
}

"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"
import type {
  AnalystMonthlyActivityRow,
  ProductivityDetailRow,
} from "@/lib/types"

const NAVY = "#1E2858"
const TEAL = "#00B8B8"
const TICK_FILL = "#64748B"
const GRID_STROKE = "#E5E7EB"

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

function formatMonthLabel(periodLabel: string): string {
  const [yyyy, mm] = periodLabel.split("-")
  const monthIdx = Number.parseInt(mm, 10) - 1
  if (monthIdx < 0 || monthIdx > 11) return periodLabel
  return `${MONTH_NAMES[monthIdx]} ${yyyy.slice(2)}`
}

function formatCompactDollars(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0"
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`
  return formatCurrency(value)
}

export function ProductivityDetailView({
  rows,
  monthlyRows,
}: {
  rows: ProductivityDetailRow[]
  monthlyRows: AnalystMonthlyActivityRow[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedName = searchParams.get("display_name") ?? undefined
  const matchedName = requestedName
    ? rows.find((r) => r.display_name === requestedName)?.display_name
    : undefined
  const initialName = matchedName ?? rows[0]?.display_name
  const [selectedId, setSelectedId] = React.useState<string | undefined>(initialName)

  // Keep state in sync if the URL changes (e.g. user follows a deep-link
  // from another page) without a full reload.
  React.useEffect(() => {
    if (matchedName && matchedName !== selectedId) {
      setSelectedId(matchedName)
    }
  }, [matchedName, selectedId])

  const goTo = React.useCallback(
    (name: string) => {
      setSelectedId(name)
      router.push(`/productivity-detail?display_name=${encodeURIComponent(name)}`)
    },
    [router],
  )

  const chartData = React.useMemo(
    () =>
      selectedId
        ? monthlyRows
            .filter((r) => r.display_name === selectedId)
            .map((r) => ({
              period_label: r.period_label,
              month_label: formatMonthLabel(r.period_label),
              meetings_scheduled: r.meetings_scheduled,
              meetings_hosted: r.meetings_hosted,
              meetings_in_person: r.meetings_in_person,
              meetings_virtual: r.meetings_virtual,
              feedback_pct:
                r.feedback_collection_rate == null
                  ? null
                  : r.feedback_collection_rate * 100,
            }))
        : [],
    [monthlyRows, selectedId],
  )

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
    goTo(rows[next].display_name)
  }
  const goNext = () => {
    const next = (selectedIndex + 1) % rows.length
    goTo(rows[next].display_name)
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
    labelColor?: string
  }> = [
    {
      label: "Scheduled",
      value: selected.meetings_scheduled_12m.toLocaleString(),
      hint: "As booker",
      valueColor: "#0154A6",
      labelColor: "#0154A6",
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
            onChange={(e) => goTo(e.target.value)}
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
              style={{ color: t.labelColor ?? NAVY }}
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

      <div className="grid grid-cols-1 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium" style={{ color: NAVY }}>
              Meetings Scheduled
            </CardTitle>
            <CardDescription className="text-xs">
              Booked by this person
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={110}>
              <BarChart data={chartData} margin={{ top: 24, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="month_label"
                  tick={{ fill: TICK_FILL, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID_STROKE }}
                />
                <YAxis
                  tick={{ fill: TICK_FILL, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID_STROKE }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(value) => Number(value || 0).toLocaleString()}
                />
                <Bar dataKey="meetings_scheduled" fill="#0154A6">
                  <LabelList
                    dataKey="meetings_scheduled"
                    position="top"
                    fontSize={11}
                    fill={NAVY}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium" style={{ color: NAVY }}>
              Meetings Hosted
            </CardTitle>
            <CardDescription className="text-xs">
              Split: virtual vs. in-person
            </CardDescription>
            <CardAction>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: NAVY }}
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">Virtual</span>
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: TEAL }}
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">In-person</span>
                </span>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={110}>
              <BarChart data={chartData} margin={{ top: 24, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="month_label"
                  tick={{ fill: TICK_FILL, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID_STROKE }}
                />
                <YAxis
                  tick={{ fill: TICK_FILL, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID_STROKE }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(value) => Number(value || 0).toLocaleString()}
                />
                <Bar dataKey="meetings_virtual" stackId="hosted" fill={NAVY} />
                <Bar dataKey="meetings_in_person" stackId="hosted" fill={TEAL}>
                  <LabelList
                    dataKey="meetings_hosted"
                    position="top"
                    fontSize={11}
                    fill={NAVY}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium" style={{ color: NAVY }}>
              Feedback Collection
            </CardTitle>
            <CardDescription className="text-xs">
              % of hosted meetings with feedback collected
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={110}>
              <BarChart data={chartData} margin={{ top: 24, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="month_label"
                  tick={{ fill: TICK_FILL, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID_STROKE }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: TICK_FILL, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID_STROKE }}
                  tickFormatter={(value) => `${Number(value || 0)}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(value) => `${Math.round(Number(value || 0))}%`}
                />
                <Bar dataKey="feedback_pct" fill={TEAL}>
                  <LabelList
                    dataKey="feedback_pct"
                    position="top"
                    fontSize={11}
                    fill={NAVY}
                    formatter={(value) =>
                      value == null ? "" : `${Math.round(Number(value))}%`
                    }
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

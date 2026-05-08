"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { format, parseISO } from "date-fns"
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
import { formatCurrency } from "@/lib/format"
import type {
  ClientDetailQuarterlyRow,
  ClientDetailReachDepthRow,
  ClientDetailRecentMeetingRow,
  ClientDetailSummaryRow,
  ClientDetailTopHostRow,
  ClientDetailTopInstitutionRow,
} from "@/lib/types"

// Brand palette — inline-styled where Tailwind classes don't cover the exact hex.
const NAVY_DEEP = "#1E2858"
const NAVY_MID = "#3D4A8C"
const TEAL = "#00B8B8"
const TEAL_LIGHT = "#7DD9D9"
const TEAL_LIGHTEST = "#C4E8E8"
const RED = "#C53030"
const AMBER = "#B7791F"
const GREEN = "#2D7A2D"
const GRAY_BG = "#F2F4F8"
const TICK_FILL = "#64748B"
const GRID_STROKE = "#E5E7EB"

const BUCKET_FILLS: Record<number, string> = {
  1: TEAL_LIGHTEST,
  2: TEAL_LIGHT,
  3: TEAL,
  4: NAVY_MID,
  5: NAVY_DEEP,
}

function safeParseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = parseISO(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatMonthYear(value: string | null | undefined): string {
  const d = safeParseDate(value)
  return d ? format(d, "MMM yyyy") : "—"
}

function formatLongMonthYear(value: string | null | undefined): string {
  const d = safeParseDate(value)
  return d ? format(d, "MMMM yyyy") : "—"
}

function formatLongDate(value: string | null | undefined): string {
  const d = safeParseDate(value)
  return d ? format(d, "MMM d, yyyy") : "—"
}

function formatShortDate(value: string | null | undefined): string {
  const d = safeParseDate(value)
  return d ? format(d, "MMM d") : "—"
}

function formatCompactDollars(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`
  return formatCurrency(value)
}

export function ClientDetailView({
  allClients,
  selected,
  quarterly,
  topInstitutions,
  reachDepth,
  topHosts,
  recentMeetings,
}: {
  allClients: ClientDetailSummaryRow[]
  selected: ClientDetailSummaryRow
  quarterly: ClientDetailQuarterlyRow[]
  topInstitutions: ClientDetailTopInstitutionRow[]
  reachDepth: ClientDetailReachDepthRow[]
  topHosts: ClientDetailTopHostRow[]
  recentMeetings: ClientDetailRecentMeetingRow[]
}) {
  const router = useRouter()

  const goTo = React.useCallback(
    (accountId: string) => {
      router.push(`/client-detail?account_id=${accountId}`)
    },
    [router],
  )

  const selectedIndex = Math.max(
    0,
    allClients.findIndex((c) => c.account_id === selected.account_id),
  )
  const goPrev = () => {
    const next = (selectedIndex - 1 + allClients.length) % allClients.length
    goTo(allClients[next].account_id)
  }
  const goNext = () => {
    const next = (selectedIndex + 1) % allClients.length
    goTo(allClients[next].account_id)
  }

  // ---------- Header subtitle ----------
  const since = formatLongMonthYear(selected.client_since)
  const subtitleParts: string[] = []
  if (selected.client_since) subtitleParts.push(`Client since ${since}`)
  subtitleParts.push(`${selected.lifetime_meetings.toLocaleString()} meetings lifetime`)
  if (selected.sales_lead_name) subtitleParts.push(`sales lead ${selected.sales_lead_name}`)

  // ---------- KPI tiles ----------
  const delta = selected.ltm_meetings_delta
  const deltaText =
    delta > 0
      ? `▲ +${delta.toLocaleString()} vs prior 12mo`
      : delta < 0
        ? `▼ ${delta.toLocaleString()} vs prior 12mo`
        : `— no change vs prior 12mo`
  const deltaColor = delta > 0 ? GREEN : delta < 0 ? RED : TICK_FILL

  const feedbackPct =
    selected.ltm_feedback_rate == null
      ? null
      : Math.round(selected.ltm_feedback_rate * 100)
  const feedbackValue = feedbackPct == null ? "—" : `${feedbackPct}%`
  const feedbackColor =
    feedbackPct != null && feedbackPct < 60 ? RED : NAVY_DEEP

  const quarterlyDollars = selected.annualized_retainer / 4

  const days = selected.days_to_renewal
  const renewalValue = days == null ? "—" : days.toLocaleString()
  const renewalColor =
    days == null
      ? NAVY_DEEP
      : days < 30
        ? RED
        : days < 90
          ? AMBER
          : NAVY_DEEP
  const renewalHint =
    selected.latest_term_end == null
      ? "No active contract"
      : `Term ends ${formatLongDate(selected.latest_term_end)}`

  type Tile = {
    label: string
    value: string
    hint: React.ReactNode
    valueColor?: string
  }
  const tiles: Tile[] = [
    {
      label: "Meetings (LTM)",
      value: `${selected.ltm_meetings.toLocaleString()} / ${selected.lifetime_meetings.toLocaleString()}`,
      hint: <span style={{ color: deltaColor }}>{deltaText}</span>,
    },
    {
      label: "Institutions (LTM)",
      value: selected.ltm_unique_institutions.toLocaleString(),
      hint: `${selected.ltm_unique_investors.toLocaleString()} individual investors`,
    },
    {
      label: "Feedback Rec'd (LTM)",
      value: feedbackValue,
      valueColor: feedbackColor,
      hint: `${selected.ltm_feedback_collected.toLocaleString()} of ${selected.ltm_feedback_total_closed.toLocaleString()} closed`,
    },
    {
      label: "Annualized Retainer",
      value: formatCompactDollars(selected.annualized_retainer),
      valueColor: TEAL,
      hint:
        selected.annualized_retainer > 0
          ? `${formatCompactDollars(quarterlyDollars)}/quarter`
          : "No active contract",
    },
    {
      label: "$ per Meeting",
      value: formatCompactDollars(selected.dollars_per_meeting_ltm),
      hint: "LTM, retainer ÷ meetings",
    },
    {
      label: "Contract Renewal",
      value: renewalValue,
      valueColor: renewalColor,
      hint: renewalHint,
    },
  ]

  // ---------- Quarterly chart data ----------
  // NOTE (deviation from spec): we render the period_label ("2025 Q3") on a
  // single X-axis row rather than implementing the multi-row year tick.
  const chartData = React.useMemo(
    () =>
      quarterly.map((q) => ({
        period_label: q.period_label,
        live_count: q.live_count,
        virtual_count: q.virtual_count,
        total: q.total,
      })),
    [quarterly],
  )

  // ---------- Reach depth ----------
  // Always show all 5 buckets in canonical order, filling missing ones with 0.
  const allBuckets: Array<{ order: number; label: string }> = [
    { order: 1, label: "1 meeting" },
    { order: 2, label: "2-3 meetings" },
    { order: 3, label: "4-5 meetings" },
    { order: 4, label: "6-10 meetings" },
    { order: 5, label: "10+ meetings" },
  ]
  const bucketByOrder = new Map(reachDepth.map((b) => [b.bucket_order, b]))
  const reachRows = allBuckets.map((b) => ({
    order: b.order,
    label: b.label,
    count: bucketByOrder.get(b.order)?.institution_count ?? 0,
  }))
  const reachTotal = reachRows.reduce((sum, r) => sum + r.count, 0)
  const reachMax = Math.max(1, ...reachRows.map((r) => r.count))
  const oneOffCount = reachRows.find((r) => r.order === 1)?.count ?? 0
  const deepCount =
    (reachRows.find((r) => r.order === 4)?.count ?? 0) +
    (reachRows.find((r) => r.order === 5)?.count ?? 0)

  // ---------- Render ----------
  return (
    <>
      {/* Section 1: Header */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1
            className="text-2xl font-medium tracking-tight"
            style={{ color: NAVY_DEEP }}
          >
            {selected.client_name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {subtitleParts.join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous client"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card hover:bg-accent"
          >
            <ChevronLeft className="size-4" />
          </button>
          <select
            value={selected.account_id}
            onChange={(e) => goTo(e.target.value)}
            className="h-9 min-w-[220px] rounded-md border border-border bg-card px-2 text-sm"
            aria-label="Select client"
          >
            {allClients.map((c) => (
              <option key={c.account_id} value={c.account_id}>
                {c.client_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={goNext}
            aria-label="Next client"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card hover:bg-accent"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Section 2: 6 KPI tiles */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-lg border p-3.5"
            style={{ backgroundColor: GRAY_BG }}
          >
            <div
              className="text-2xl font-medium tracking-tight tabular-nums"
              style={{ color: t.valueColor ?? NAVY_DEEP }}
            >
              {t.value}
            </div>
            <div
              className="mt-1 text-xs font-medium"
              style={{ color: NAVY_DEEP }}
            >
              {t.label}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {t.hint}
            </div>
          </div>
        ))}
      </div>

      {/* Section 3: Section divider */}
      <div className="my-6 flex items-center gap-3">
        <span
          className="shrink-0 text-base font-medium"
          style={{ color: NAVY_DEEP }}
        >
          Rose &amp; Co Meeting History
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      {/* Section 4: Quarterly chart card */}
      <div className="mb-3 rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <div className="text-sm font-medium" style={{ color: NAVY_DEEP }}>
              Meetings by Quarter
            </div>
            <div className="text-xs text-muted-foreground">
              Last 8 quarters · stacked: virtual + live
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: NAVY_DEEP }}
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
              <span className="text-muted-foreground">Live</span>
            </span>
          </div>
        </div>
        {chartData.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            No confirmed meetings in the last 8 quarters.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={chartData} margin={{ top: 24, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
              <XAxis
                dataKey="period_label"
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
              <Bar dataKey="virtual_count" stackId="a" fill={NAVY_DEEP} />
              <Bar dataKey="live_count" stackId="a" fill={TEAL}>
                <LabelList
                  dataKey="total"
                  position="top"
                  fontSize={11}
                  fill={NAVY_DEEP}
                  formatter={(value) => Number(value || 0).toLocaleString()}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Section 5: Top 20 Institutions */}
      <div className="mb-3 rounded-lg border bg-card p-4">
        <div className="mb-3">
          <div className="text-sm font-medium" style={{ color: NAVY_DEEP }}>
            Top 20 Institutions Met
          </div>
          <div className="text-xs text-muted-foreground">
            Lifetime · of {reachTotal.toLocaleString()} unique institutions
          </div>
        </div>
        {topInstitutions.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No confirmed meetings on record.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
            {[topInstitutions.slice(0, 10), topInstitutions.slice(10, 20)].map(
              (rows, colIdx) =>
                rows.length === 0 ? null : (
                  <table key={colIdx} className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="px-2 py-2 text-left font-medium w-10">#</th>
                        <th className="px-2 py-2 text-left font-medium">Institution</th>
                        <th className="px-2 py-2 text-right font-medium">Meetings</th>
                        <th className="px-2 py-2 text-right font-medium">LTM</th>
                        <th className="px-2 py-2 text-right font-medium">First Met</th>
                        <th className="px-2 py-2 text-right font-medium">Last Met</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={`${row.account_id}-${row.rank}`} className="border-b last:border-b-0">
                          <td className="px-2 py-2 text-muted-foreground tabular-nums">{row.rank}</td>
                          <td className="px-2 py-2 font-medium" style={{ color: NAVY_DEEP }}>
                            {row.institution_name}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {row.lifetime_count.toLocaleString()}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {row.ltm_count.toLocaleString()}
                          </td>
                          <td className="px-2 py-2 text-right text-muted-foreground">
                            {formatMonthYear(row.first_met)}
                          </td>
                          <td className="px-2 py-2 text-right text-muted-foreground">
                            {formatMonthYear(row.last_met)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ),
            )}
          </div>
        )}
      </div>

      {/* Section 6: Reach Depth + Top Hosts side by side */}
      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Reach Depth */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3">
            <div className="text-sm font-medium" style={{ color: NAVY_DEEP }}>
              Investor Reach Depth
            </div>
            <div className="text-xs text-muted-foreground">
              Lifetime: {reachTotal.toLocaleString()} unique institutions
            </div>
          </div>
          <div className="space-y-2.5">
            {reachRows.map((row) => {
              const widthPct = reachMax > 0 ? (row.count / reachMax) * 100 : 0
              const sharePct =
                reachTotal > 0 ? Math.round((row.count / reachTotal) * 100) : 0
              return (
                <div key={row.order}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span style={{ color: NAVY_DEEP }}>{row.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {row.count.toLocaleString()} · {sharePct}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: BUCKET_FILLS[row.order],
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-4 text-xs italic text-muted-foreground">
            {reachTotal === 0
              ? "No institution coverage yet."
              : `${oneOffCount.toLocaleString()} institutions met just once · ${deepCount.toLocaleString()} have been visited 6+ times.`}
          </p>
        </div>

        {/* Top Hosts */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3">
            <div className="text-sm font-medium" style={{ color: NAVY_DEEP }}>
              Top Hosts (LTM)
            </div>
            <div className="text-xs text-muted-foreground">
              Rose &amp; Co team members hosting
            </div>
          </div>
          {topHosts.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No hosts in the trailing 12 months.
            </div>
          ) : (
            <div className="space-y-2">
              {topHosts.map((h) => (
                <div
                  key={h.host_name}
                  className="flex items-baseline justify-between border-b last:border-b-0 py-1.5"
                >
                  <span className="font-medium" style={{ color: NAVY_DEEP }}>
                    {h.host_name}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {h.ltm_count.toLocaleString()} meetings · last {formatShortDate(h.last_met)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs italic text-muted-foreground">
            {selected.sales_lead_name
              ? `Relationship lead: ${selected.sales_lead_name}.`
              : "No relationship lead on record."}
          </p>
        </div>
      </div>

      {/* Section 7: divider */}
      <div className="my-6 flex items-center gap-3">
        <span
          className="shrink-0 text-base font-medium"
          style={{ color: NAVY_DEEP }}
        >
          Recent Activity
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      {/* Section 8: Last 8 Meetings */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 text-sm font-medium" style={{ color: NAVY_DEEP }}>
          Last 8 Meetings
        </div>
        {recentMeetings.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No recent confirmed meetings.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">Date</th>
                <th className="px-2 py-2 text-left font-medium">Institution</th>
                <th className="px-2 py-2 text-left font-medium">Host</th>
                <th className="px-2 py-2 text-left font-medium">Type</th>
                <th className="px-2 py-2 text-left font-medium">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {recentMeetings.map((m) => {
                const isLive = m.is_in_person === true
                const typeLabel = m.meeting_type_label ?? (isLive ? "Live" : "Virtual")
                const pillStyle = isLive
                  ? { backgroundColor: TEAL_LIGHTEST, color: NAVY_DEEP }
                  : { backgroundColor: NAVY_DEEP, color: "#FFFFFF" }
                let feedbackNode: React.ReactNode
                if (m.feedback_status_label === "Closed - All in") {
                  feedbackNode = (
                    <span style={{ color: GREEN }}>{"● Collected"}</span>
                  )
                } else if (m.feedback_status_label === "Closed - No Feedback") {
                  feedbackNode = (
                    <span style={{ color: RED }}>{"○ None"}</span>
                  )
                } else {
                  feedbackNode = (
                    <span className="text-muted-foreground">Pending</span>
                  )
                }
                return (
                  <tr key={m.meeting_id} className="border-b last:border-b-0">
                    <td className="px-2 py-2 tabular-nums">
                      {formatLongDate(m.meeting_date)}
                    </td>
                    <td className="px-2 py-2 font-medium" style={{ color: NAVY_DEEP }}>
                      {m.institution_name ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {m.host_name ?? "—"}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className="inline-block rounded px-2 py-0.5 text-xs font-medium"
                        style={pillStyle}
                      >
                        {typeLabel}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs">{feedbackNode}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

"use client"

import * as React from "react"
import Link from "next/link"
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
import { StatCard } from "@/components/stat-card"
import { EntityMasthead, MastheadSelector } from "@/components/page-masthead"
import { CARD_CLASS } from "@/lib/design"
import type {
  InstitutionDetailQuarterlyRow,
  InstitutionDetailRecentMeetingRow,
  InstitutionDetailStyleRow,
  InstitutionDetailSummaryRow,
  InstitutionDetailTopBookerRow,
  InstitutionDetailTopClientRow,
  InstitutionDetailTopHostRow,
  InstitutionSummaryRow,
} from "@/lib/types"

// Brand palette
const NAVY_DEEP = "#1E2858"
const NAVY_MID = "#3D4A8C"
const TEAL = "#00B8B8"
const TEAL_LIGHT = "#7DD9D9"
const TEAL_LIGHTEST = "#C4E8E8"
const RED = "#C53030"
const GREEN = "#2D7A2D"
const TICK_FILL = "#64748B"
const GRID_STROKE = "#E5E7EB"

const RANK_PALETTE = [NAVY_DEEP, NAVY_MID, TEAL, TEAL_LIGHT, TEAL_LIGHTEST]

type NavRow = InstitutionSummaryRow & { institution_id: string }

function safeParseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = parseISO(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatLongMonthYear(value: string | null | undefined): string {
  const d = safeParseDate(value)
  return d ? format(d, "MMM yyyy") : "—"
}

function formatShortDate(value: string | null | undefined): string {
  const d = safeParseDate(value)
  return d ? format(d, "MMM d") : "—"
}

function formatLongDate(value: string | null | undefined): string {
  const d = safeParseDate(value)
  return d ? format(d, "MMM d, yyyy") : "—"
}

// Rank-based color picker: largest count → deepest navy → step lighter.
function rankColors(counts: number[]): string[] {
  const ranked = counts
    .map((c, i) => ({ i, c }))
    .sort((a, b) => b.c - a.c)
  const out: string[] = new Array(counts.length)
  ranked.forEach((entry, rank) => {
    out[entry.i] = RANK_PALETTE[Math.min(rank, RANK_PALETTE.length - 1)]
  })
  return out
}

// Canonical market cap buckets — always show all 5 in this order.
const MARKET_CAP_BUCKETS: Array<{ order: number; label: string }> = [
  { order: 1, label: "Mega" },
  { order: 2, label: "Large" },
  { order: 3, label: "Mid" },
  { order: 4, label: "Small" },
  { order: 5, label: "Micro" },
]

// Canonical region buckets — always show all 3 in this order.
const REGION_BUCKETS: Array<{ order: number; label: string }> = [
  { order: 1, label: "Americas" },
  { order: 2, label: "EMEA" },
  { order: 3, label: "APAC" },
]

const SECTOR_TOP_N = 6

/** Initials from an institution name: first letters of its first two words. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ""
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Tiny inline-SVG trend line with a faint area fill (no axes, no chrome). */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null
  const w = 88
  const h = 20
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / span) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const line = pts.join(" ")
  const area = `0,${h} ${line} ${w},${h}`
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polygon points={area} fill={color} opacity={0.1} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Thin ratio bar (received ÷ total style). `fill` is any CSS background. */
function RatioBar({ pct, fill }: { pct: number; fill: string }) {
  const w = Math.max(0, Math.min(100, pct))
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: "#EEF0F4" }}
    >
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: fill }} />
    </div>
  )
}

export function InstitutionDetailView({
  selected,
  navTop,
  quarterly,
  topClients,
  style,
  topHosts,
  topBookers,
  recentMeetings,
}: {
  selected: InstitutionDetailSummaryRow
  navTop: NavRow[]
  quarterly: InstitutionDetailQuarterlyRow[]
  topClients: InstitutionDetailTopClientRow[]
  style: InstitutionDetailStyleRow[]
  topHosts: InstitutionDetailTopHostRow[]
  topBookers: InstitutionDetailTopBookerRow[]
  recentMeetings: InstitutionDetailRecentMeetingRow[]
}) {
  const router = useRouter()

  const goTo = React.useCallback(
    (institutionId: string) => {
      router.push(`/institution-detail?institution_id=${institutionId}`)
    },
    [router],
  )

  // Where the selected institution sits inside the top-50 navigator.
  // -1 if the user navigated here from outside the top 50.
  const selectedIndex = React.useMemo(() => {
    if (!selected.institution_id) return -1
    return navTop.findIndex((r) => r.institution_id === selected.institution_id)
  }, [navTop, selected.institution_id])

  const goPrev = () => {
    if (navTop.length === 0) return
    if (selectedIndex < 0) {
      goTo(navTop[navTop.length - 1].institution_id)
      return
    }
    const next = (selectedIndex - 1 + navTop.length) % navTop.length
    goTo(navTop[next].institution_id)
  }
  const goNext = () => {
    if (navTop.length === 0) return
    if (selectedIndex < 0) {
      goTo(navTop[0].institution_id)
      return
    }
    const next = (selectedIndex + 1) % navTop.length
    goTo(navTop[next].institution_id)
  }

  // ---------- Header subtitle ----------
  const since = formatLongMonthYear(selected.first_met)
  const subtitleParts: string[] = []
  if (selected.first_met) subtitleParts.push(`First met ${since}`)
  subtitleParts.push(
    `${selected.lifetime_meetings.toLocaleString()} meetings lifetime`,
  )
  subtitleParts.push(
    `${selected.lifetime_clients.toLocaleString()} Rose & Co clients reached`,
  )

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

  const lastMetClient = selected.last_met_client_name ?? "—"
  const lastMetHost = selected.last_met_host_name ?? "—"

  // Real per-quarter total series already powering the Meetings-by-Quarter chart.
  const quarterlyTotals = quarterly.map((q) => q.total)

  type Tile = {
    label: string
    value: string
    hint: React.ReactNode
    valueColor?: string
    sparkline?: React.ReactNode
  }
  const tiles: Tile[] = [
    {
      label: "Meetings (LTM)",
      value: selected.ltm_meetings.toLocaleString(),
      hint: <span style={{ color: deltaColor }}>{deltaText}</span>,
      sparkline:
        quarterlyTotals.length >= 2 ? (
          <Sparkline values={quarterlyTotals} color="#0355A7" />
        ) : undefined,
    },
    {
      label: "Clients Met (LTM)",
      value: selected.ltm_clients.toLocaleString(),
      hint: `${selected.lifetime_clients.toLocaleString()} lifetime`,
    },
    {
      label: "People (LTM)",
      value: selected.ltm_people.toLocaleString(),
      hint: `${selected.lifetime_people.toLocaleString()} lifetime`,
    },
    {
      label: "Feedback Rec'd (LTM)",
      value: feedbackValue,
      valueColor: TEAL,
      sparkline:
        feedbackPct != null ? (
          <RatioBar pct={feedbackPct} fill="linear-gradient(90deg, #1C9E72, #37B88C)" />
        ) : undefined,
      hint: `${selected.ltm_feedback_collected.toLocaleString()} of ${selected.ltm_feedback_total_closed.toLocaleString()} closed`,
    },
    {
      label: "Last Met",
      value: formatShortDate(selected.last_met),
      hint: `${lastMetClient} · ${lastMetHost}`,
    },
  ]

  // ---------- Quarterly chart data ----------
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

  // ---------- Investor Style data ----------
  const marketCapRows = React.useMemo(() => {
    const byOrder = new Map<number, InstitutionDetailStyleRow>()
    for (const s of style) {
      if (s.dimension_type === "market_cap") byOrder.set(s.bucket_order, s)
    }
    return MARKET_CAP_BUCKETS.map((b) => ({
      order: b.order,
      label: b.label,
      count: byOrder.get(b.order)?.client_count ?? 0,
    }))
  }, [style])

  const sectorRowsAll = React.useMemo(() => {
    return style
      .filter((s) => s.dimension_type === "sector")
      .slice()
      .sort((a, b) => a.bucket_order - b.bucket_order)
  }, [style])
  const sectorTop = sectorRowsAll.slice(0, SECTOR_TOP_N)
  const sectorRest = sectorRowsAll.slice(SECTOR_TOP_N)
  const sectorRestCount = sectorRest.reduce((sum, r) => sum + r.client_count, 0)

  const regionRows = React.useMemo(() => {
    const byOrder = new Map<number, InstitutionDetailStyleRow>()
    for (const s of style) {
      if (s.dimension_type === "region") byOrder.set(s.bucket_order, s)
    }
    return REGION_BUCKETS.map((b) => ({
      order: b.order,
      label: b.label,
      count: byOrder.get(b.order)?.client_count ?? 0,
    }))
  }, [style])

  const marketCapTotal = marketCapRows.reduce((s, r) => s + r.count, 0)
  const sectorTotal = sectorRowsAll.reduce((s, r) => s + r.client_count, 0)
  const regionTotal = regionRows.reduce((s, r) => s + r.count, 0)

  const marketCapColors = rankColors(marketCapRows.map((r) => r.count))
  const sectorColors = rankColors(sectorTop.map((r) => r.client_count))
  const regionColors = rankColors(regionRows.map((r) => r.count))

  // ---------- Render ----------
  return (
    <>
      {/* Section 1: Floating masthead — badge, name, selector/navigator. */}
      <div className="mb-4">
        <EntityMasthead
          badge={initials(selected.institution_name)}
          name={selected.institution_name}
          subtitle={subtitleParts.join(" · ")}
          rightSlot={
            <MastheadSelector
              items={[
                // When the selected institution is outside the top-50 navigator,
                // prepend it so the dropdown can still show its name as current.
                ...(selectedIndex < 0 && selected.institution_id
                  ? [
                      {
                        value: selected.institution_id,
                        label: selected.institution_name,
                      },
                    ]
                  : []),
                ...navTop.map((r) => ({
                  value: r.institution_id,
                  label: r.institution_name,
                })),
              ]}
              value={selected.institution_id ?? ""}
              onChange={goTo}
              onPrev={goPrev}
              onNext={goNext}
              ariaLabel="Select institution"
            />
          }
        />
      </div>

      {/* Section 2: 5 KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <StatCard
            key={t.label}
            floating
            label={t.label}
            value={t.value}
            hint={t.hint}
            valueColor={t.valueColor}
            sparkline={t.sparkline}
          />
        ))}
      </div>

      {/* Section 3: divider */}
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
      <div className={`mb-3 p-4 ${CARD_CLASS}`}>
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
          <div className="flex h-[110px] items-center justify-center text-sm text-muted-foreground">
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

      {/* Section 5: divider */}
      <div className="my-6 flex items-center gap-3">
        <span
          className="shrink-0 text-base font-medium"
          style={{ color: NAVY_DEEP }}
        >
          Investor Style (Based on Rose &amp; Co Meeting History)
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      {/* Section 6: 3 panels */}
      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* By Market Cap */}
        <div className={`p-4 ${CARD_CLASS}`}>
          <div className="mb-3">
            <div className="text-sm font-medium" style={{ color: NAVY_DEEP }}>
              By Market Cap
            </div>
            <div className="text-xs text-muted-foreground">
              {marketCapTotal.toLocaleString()} clients
            </div>
          </div>
          <ul className="space-y-3">
            {marketCapRows.map((row, i) => {
              const pct =
                marketCapTotal > 0
                  ? Math.round((row.count / marketCapTotal) * 100)
                  : 0
              return (
                <li key={row.order} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium" style={{ color: NAVY_DEEP }}>
                      {row.label}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {row.count.toLocaleString()} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: marketCapColors[i],
                      }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        {/* By Sector */}
        <div className={`p-4 ${CARD_CLASS}`}>
          <div className="mb-3">
            <div className="text-sm font-medium" style={{ color: NAVY_DEEP }}>
              By Sector
            </div>
            <div className="text-xs text-muted-foreground">
              {sectorTotal.toLocaleString()} clients
            </div>
          </div>
          <ul className="space-y-3">
            {sectorTop.map((row, i) => {
              const pct =
                sectorTotal > 0
                  ? Math.round((row.client_count / sectorTotal) * 100)
                  : 0
              return (
                <li key={row.bucket_label} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span
                      className="truncate font-medium"
                      style={{ color: NAVY_DEEP }}
                    >
                      {row.bucket_label}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {row.client_count.toLocaleString()} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: sectorColors[i],
                      }}
                    />
                  </div>
                </li>
              )
            })}
            {sectorTop.length === 0 && (
              <li className="text-xs text-muted-foreground">
                No sector data yet.
              </li>
            )}
          </ul>
          {sectorRest.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              + {sectorRest.length} more sectors ({sectorRestCount.toLocaleString()} clients)
            </p>
          )}
        </div>

        {/* By Region */}
        <div className={`p-4 ${CARD_CLASS}`}>
          <div className="mb-3">
            <div className="text-sm font-medium" style={{ color: NAVY_DEEP }}>
              By Region
            </div>
            <div className="text-xs text-muted-foreground">
              {regionTotal.toLocaleString()} clients
            </div>
          </div>
          <ul className="space-y-3">
            {regionRows.map((row, i) => {
              const pct =
                regionTotal > 0
                  ? Math.round((row.count / regionTotal) * 100)
                  : 0
              return (
                <li key={row.order} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium" style={{ color: NAVY_DEEP }}>
                      {row.label}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {row.count.toLocaleString()} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: regionColors[i],
                      }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      {/* Section 7: Top Hosts + Top Booker side-by-side */}
      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Top Hosts (LTM) */}
        <div className={`p-4 ${CARD_CLASS}`}>
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
                  <Link
                    href={`/productivity-detail?display_name=${encodeURIComponent(h.host_name)}`}
                    className="font-medium hover:underline"
                    style={{ color: NAVY_DEEP }}
                  >
                    {h.host_name}
                  </Link>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {h.ltm_count.toLocaleString()} mtgs · last {formatShortDate(h.last_met)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Booker (LTM) */}
        <div className={`p-4 ${CARD_CLASS}`}>
          <div className="mb-3">
            <div className="text-sm font-medium" style={{ color: NAVY_DEEP }}>
              Top Booker (LTM)
            </div>
            <div className="text-xs text-muted-foreground">
              Rose &amp; Co team members booking
            </div>
          </div>
          {topBookers.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No bookers in the trailing 12 months.
            </div>
          ) : (
            <div className="space-y-2">
              {topBookers.map((b) => (
                <div
                  key={b.booker_name}
                  className="flex items-baseline justify-between border-b last:border-b-0 py-1.5"
                >
                  <Link
                    href={`/productivity-detail?display_name=${encodeURIComponent(b.booker_name)}`}
                    className="font-medium hover:underline"
                    style={{ color: NAVY_DEEP }}
                  >
                    {b.booker_name}
                  </Link>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {b.ltm_count.toLocaleString()} mtgs · last {formatShortDate(b.last_met)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 7b: Top 10 Clients full width */}
      <div className={`mb-3 p-4 ${CARD_CLASS}`}>
        <div className="mb-3">
          <div className="text-sm font-medium" style={{ color: NAVY_DEEP }}>
            Top 10 Rose &amp; Co Clients Met
          </div>
          <div className="text-xs text-muted-foreground">
            Ranked by lifetime confirmed meetings
          </div>
        </div>
        {topClients.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No Rose &amp; Co client meetings on record.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium w-10">#</th>
                <th className="px-2 py-2 text-left font-medium">Client</th>
                <th className="px-2 py-2 text-right font-medium">Total</th>
                <th className="px-2 py-2 text-right font-medium">LTM</th>
                <th className="px-2 py-2 text-right font-medium">Last Met</th>
              </tr>
            </thead>
            <tbody>
              {topClients.map((row) => (
                <tr
                  key={`${row.client_account_id}-${row.rank}`}
                  className="border-b last:border-b-0"
                >
                  <td className="px-2 py-2 text-muted-foreground tabular-nums">
                    {row.rank}
                  </td>
                  <td className="px-2 py-2">
                    <Link
                      href={`/client-detail?account_id=${row.client_account_id}`}
                      className="font-medium hover:underline"
                      style={{ color: NAVY_DEEP }}
                    >
                      {row.client_account_name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {row.lifetime_count.toLocaleString()}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {row.ltm_count.toLocaleString()}
                  </td>
                  <td className="px-2 py-2 text-right text-muted-foreground">
                    {formatShortDate(row.last_met)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Section 8: divider */}
      <div className="my-6 flex items-center gap-3">
        <span
          className="shrink-0 text-base font-medium"
          style={{ color: NAVY_DEEP }}
        >
          Recent Activity
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      {/* Section 9: Last 25 Meetings */}
      <div className={`p-4 ${CARD_CLASS}`}>
        <div className="mb-3 text-sm font-medium" style={{ color: NAVY_DEEP }}>
          Last 25 Meetings
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
                <th className="px-2 py-2 text-left font-medium">Rose &amp; Co Client</th>
                <th className="px-2 py-2 text-left font-medium">Person</th>
                <th className="px-2 py-2 text-left font-medium">Host</th>
                <th className="px-2 py-2 text-left font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              {recentMeetings.map((m) => {
                const isLive = m.is_in_person === true
                const typeLabel =
                  m.meeting_type_label ?? (isLive ? "Live" : "Virtual")
                const pillStyle = isLive
                  ? { backgroundColor: TEAL_LIGHTEST, color: NAVY_DEEP }
                  : { backgroundColor: NAVY_DEEP, color: "#FFFFFF" }
                const meetingDate = safeParseDate(m.meeting_date)
                const isUpcoming =
                  meetingDate !== null && meetingDate.getTime() > Date.now()
                return (
                  <tr key={m.meeting_id} className="border-b last:border-b-0">
                    <td className="px-2 py-2 tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        {formatLongDate(m.meeting_date)}
                        {isUpcoming && (
                          <span
                            className="inline-block rounded px-2 py-0.5 text-xs font-medium"
                            style={{ backgroundColor: "#EEF2FB", color: "#2D4A8A" }}
                          >
                            Scheduled
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      {m.client_account_id && m.client_account_name ? (
                        <Link
                          href={`/client-detail?account_id=${m.client_account_id}`}
                          className="font-medium hover:underline"
                          style={{ color: NAVY_DEEP }}
                        >
                          {m.client_account_name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {m.investor_text ?? "—"}
                    </td>
                    <td className="px-2 py-2">
                      {m.host_name ? (
                        <Link
                          href={`/productivity-detail?display_name=${encodeURIComponent(m.host_name)}`}
                          className="hover:underline"
                          style={{ color: NAVY_DEEP }}
                        >
                          {m.host_name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className="inline-block rounded px-2 py-0.5 text-xs font-medium"
                        style={pillStyle}
                      >
                        {typeLabel}
                      </span>
                    </td>
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

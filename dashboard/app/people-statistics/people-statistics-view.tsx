"use client"

import * as React from "react"
import { format, parseISO } from "date-fns"
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  ArrowDown,
  BarChart3,
  CalendarRange,
  MessageSquareText,
  Users,
  Waves,
} from "lucide-react"
import { ListTitleCard } from "@/components/page-masthead"
import {
  BRAND_BLUE,
  BRAND_NAVY,
  CARD_CLASS,
  TEAL,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from "@/lib/design"
import type {
  MeetingsMonthlyRow,
  PersonFeedbackWindowsRow,
  PersonRole,
} from "@/lib/types"
import { ROLE_STYLES } from "@/lib/person-role"
import { SegmentedToggle } from "@/components/segmented-toggle"

// Chart palette (per spec): virtual = blue, in-person (live) = teal,
// total trend line = dashed navy.
const VIRTUAL_COLOR = BRAND_BLUE // #0355A7
const LIVE_COLOR = TEAL // #1C8C9C
const TOTAL_COLOR = BRAND_NAVY // #1E2858
const GRID_STROKE = "#E5E7EB"
const TICK_FILL = "#64748B"

type ChartMode = "monthly" | "quarterly"

// A single plotted period. Kept deliberately generic (label + the same
// virtual/live/total split as the source view) so a future "by person"
// series can be layered on without reshaping this structure.
type ChartPoint = {
  key: string // stable, sortable (e.g. '2025-03' or '2025-Q1')
  label: string // short x-axis label
  fullLabel: string // tooltip heading
  virtual_count: number
  live_count: number
  total: number
}

const MONTHS_BACK = 12 // monthly view: trailing 12 months
const QUARTERS_BACK = 16 // quarterly view: trailing 4 years

/** Last 12 months of the source rows, mapped to chart points. */
function toMonthly(rows: MeetingsMonthlyRow[]): ChartPoint[] {
  return rows.slice(-MONTHS_BACK).map((r) => {
    const d = parseISO(`${r.period_label}-01`)
    return {
      key: r.period_label,
      label: format(d, "MMM"),
      fullLabel: format(d, "MMM yyyy"),
      virtual_count: r.virtual_count,
      live_count: r.live_count,
      total: r.total,
    }
  })
}

/** Aggregate the monthly rows into quarters, then take the last 4 years. */
function toQuarterly(rows: MeetingsMonthlyRow[]): ChartPoint[] {
  const byQuarter = new Map<string, ChartPoint>()
  for (const r of rows) {
    const quarter = Math.floor((r.period_month - 1) / 3) + 1
    const key = `${r.period_year}-Q${quarter}`
    const existing = byQuarter.get(key)
    if (existing) {
      existing.virtual_count += r.virtual_count
      existing.live_count += r.live_count
      existing.total += r.total
    } else {
      byQuarter.set(key, {
        key,
        label: `Q${quarter} '${String(r.period_year).slice(-2)}`,
        fullLabel: `${r.period_year} Q${quarter}`,
        virtual_count: r.virtual_count,
        live_count: r.live_count,
        total: r.total,
      })
    }
  }
  // Map preserves insertion order; rows arrive oldest→newest, so this is sorted.
  return Array.from(byQuarter.values()).slice(-QUARTERS_BACK)
}

type Totals = { total: number; virtual: number; live: number; avg: number }

function summarize(points: ChartPoint[]): Totals {
  const total = points.reduce((s, p) => s + p.total, 0)
  const virtual = points.reduce((s, p) => s + p.virtual_count, 0)
  const live = points.reduce((s, p) => s + p.live_count, 0)
  const avg = points.length ? total / points.length : 0
  return { total, virtual, live, avg }
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: ChartPoint }>
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div
      className="rounded-md border bg-white px-3 py-2 text-xs shadow-md"
      style={{ borderColor: "#E6E9EF" }}
    >
      <div className="mb-1 font-medium" style={{ color: TEXT_PRIMARY }}>
        {p.fullLabel}
      </div>
      <Row swatch={VIRTUAL_COLOR} label="Virtual" value={p.virtual_count} />
      <Row swatch={LIVE_COLOR} label="In-person" value={p.live_count} />
      <div className="mt-1 border-t pt-1" style={{ borderColor: "#EEF0F4" }}>
        <Row swatch={TOTAL_COLOR} label="Total" value={p.total} bold />
      </div>
    </div>
  )
}

function Row({
  swatch,
  label,
  value,
  bold,
}: {
  swatch: string
  label: string
  value: number
  bold?: boolean
}) {
  return (
    <div className="flex items-center gap-2" style={{ color: TEXT_SECONDARY }}>
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ backgroundColor: swatch }}
        aria-hidden="true"
      />
      <span className="flex-1">{label}</span>
      <span style={{ fontWeight: bold ? 600 : 400, color: TEXT_PRIMARY }}>
        {value.toLocaleString()}
      </span>
    </div>
  )
}

/** Summary stat strip — recomputes whenever the active dataset changes. */
function StatStrip({ totals, perLabel }: { totals: Totals; perLabel: string }) {
  const stats = [
    { label: "Total", value: totals.total.toLocaleString(), color: TEXT_PRIMARY },
    { label: "Virtual", value: totals.virtual.toLocaleString(), color: VIRTUAL_COLOR },
    { label: "In-person", value: totals.live.toLocaleString(), color: LIVE_COLOR },
    {
      label: perLabel,
      value: totals.avg.toLocaleString(undefined, { maximumFractionDigits: 1 }),
      color: TEXT_PRIMARY,
    },
  ]
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-[10px] px-3 py-2"
          style={{ background: "#F7F9FC", border: "1px solid #EEF0F4" }}
        >
          <div
            className="text-[11px] uppercase tracking-wide"
            style={{ color: TEXT_MUTED }}
          >
            {s.label}
          </div>
          <div className="text-lg font-semibold" style={{ color: s.color }}>
            {s.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Chart B — Seasonality -------------------------------------------------

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

// One row per calendar month (Jan–Dec); a key per overlaid year holding that
// month's total (null where the year has no data yet, e.g. future months of
// the current year — so the line ends rather than dropping to zero).
type SeasonRow = {
  month: number
  monthLabel: string
  // year keys, e.g. "2025": 42 | null
  [year: string]: number | string | null
}

// Indexed by recency: 0 = most recent year (darkest/thickest, area fill).
const SEASON_STYLES = [
  { color: BRAND_NAVY, width: 2.5 }, // newest
  { color: BRAND_BLUE, width: 1.75 },
  { color: "#9DB8DF", width: 1.25 }, // oldest of the three
]

function toSeasonality(
  rows: MeetingsMonthlyRow[],
  // "Today", so the current year's line stops at the current month instead of
  // plotting future months (which would collapse the line to zero).
  currentYear: number,
  currentMonth: number,
): {
  years: number[]
  data: SeasonRow[]
} {
  const years = Array.from(new Set(rows.map((r) => r.period_year)))
    .sort((a, b) => b - a)
    .slice(0, 3)
    .sort((a, b) => a - b) // ascending so the newest renders last (on top)

  const lookup = new Map<string, number>()
  for (const r of rows) lookup.set(`${r.period_year}-${r.period_month}`, r.total)

  const data: SeasonRow[] = MONTH_LABELS.map((monthLabel, i) => {
    const month = i + 1
    const row: SeasonRow = { month, monthLabel }
    for (const y of years) {
      // Truncate the current year at today's month — future months stay null
      // so the line ends rather than dropping to the axis. Prior (complete)
      // years run the full Jan–Dec axis.
      if (y === currentYear && month > currentMonth) {
        row[String(y)] = null
      } else {
        row[String(y)] = lookup.get(`${y}-${month}`) ?? null
      }
    }
    return row
  })

  return { years, data }
}

/** Style for a given year by how recent it is (0 = newest). */
function seasonStyle(years: number[], year: number) {
  const recency = years[years.length - 1] - year // 0 for newest
  return SEASON_STYLES[Math.min(recency, SEASON_STYLES.length - 1)]
}

function SeasonTooltip({
  active,
  payload,
  years,
}: {
  active?: boolean
  payload?: Array<{
    dataKey: string
    value: number | null
    color: string
    payload: SeasonRow
  }>
  years: number[]
}) {
  if (!active || !payload?.length) return null
  const monthLabel = payload[0].payload.monthLabel
  // Newest year first in the tooltip.
  const ordered = [...years].sort((a, b) => b - a)
  return (
    <div
      className="rounded-md border bg-white px-3 py-2 text-xs shadow-md"
      style={{ borderColor: "#E6E9EF" }}
    >
      <div className="mb-1 font-medium" style={{ color: TEXT_PRIMARY }}>
        {monthLabel}
      </div>
      {ordered.map((y) => {
        const entry = payload.find((p) => p.dataKey === String(y))
        if (!entry || entry.value == null) return null
        return (
          <div
            key={y}
            className="flex items-center gap-2"
            style={{ color: TEXT_SECONDARY }}
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />
            <span className="flex-1">{y}</span>
            <span style={{ fontWeight: 600, color: TEXT_PRIMARY }}>
              {entry.value.toLocaleString()}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function SeasonalityCard({ monthly }: { monthly: MeetingsMonthlyRow[] }) {
  const { years, data } = React.useMemo(() => {
    const now = new Date()
    return toSeasonality(monthly, now.getFullYear(), now.getMonth() + 1)
  }, [monthly])

  return (
    <div id="seasonality" className={`mt-4 scroll-mt-20 p-5 ${CARD_CLASS}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 flex size-7 items-center justify-center rounded-lg"
            style={{ background: "#EEF2FB", color: BRAND_BLUE }}
          >
            <CalendarRange className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
              Seasonality
            </div>
            <div className="text-xs" style={{ color: TEXT_MUTED }}>
              Meetings by month · last {years.length} years overlaid on a Jan–Dec axis
            </div>
          </div>
        </div>
        {/* Year legend (oldest → newest) */}
        <div className="flex items-center gap-4 text-xs" style={{ color: TEXT_MUTED }}>
          {years.map((y) => {
            const s = seasonStyle(years, y)
            return (
              <span key={y} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0 w-4"
                  style={{ borderTop: `${s.width}px solid ${s.color}` }}
                  aria-hidden="true"
                />
                <span>{y}</span>
              </span>
            )
          })}
        </div>
      </div>

      {years.length === 0 ? (
        <div
          className="flex h-[300px] items-center justify-center text-sm"
          style={{ color: TEXT_MUTED }}
        >
          No confirmed meetings to chart.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 12, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
            <XAxis
              dataKey="monthLabel"
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
              cursor={{ stroke: GRID_STROKE }}
              content={<SeasonTooltip years={years} />}
            />
            {years.map((y) => {
              const s = seasonStyle(years, y)
              const isNewest = y === years[years.length - 1]
              return isNewest ? (
                <Area
                  key={y}
                  type="monotone"
                  dataKey={String(y)}
                  stroke={s.color}
                  strokeWidth={s.width}
                  fill={s.color}
                  fillOpacity={0.08}
                  dot={false}
                  activeDot={{ r: 4, fill: s.color }}
                  connectNulls={false}
                />
              ) : (
                <Line
                  key={y}
                  type="monotone"
                  dataKey={String(y)}
                  stroke={s.color}
                  strokeWidth={s.width}
                  dot={false}
                  activeDot={{ r: 3.5, fill: s.color }}
                  connectNulls={false}
                />
              )
            })}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ---- Chart C — Activity by Person ------------------------------------------

// One person with their stable TTM role (for grouping) and booked/hosted counts
// for both windows (for the bars).
export type PersonActivity = {
  user_id: string
  display_name: string
  role: PersonRole
  booked_30d: number
  hosted_30d: number
  booked_1y: number
  hosted_1y: number
}

const BOOKED_COLOR = BRAND_BLUE // #0355A7
const HOSTED_COLOR = TEAL // #1C8C9C

type ActivityViewMode = "combined" | "booked" | "hosted"
type ActivityWindow = "1y" | "30d"

// Display order for the group headers. Dot colors come from the shared role
// palette (ROLE_STYLES) so they match the Summary page's role pills exactly;
// Unclassified renders muted, mirroring the Summary page's muted treatment.
const ACTIVITY_GROUPS: Array<{ label: string; role: PersonRole }> = [
  { label: "Bookers", role: "Booker" },
  { label: "Hosts", role: "Host" },
  { label: "Hybrids", role: "Hybrid" },
  { label: "Unclassified", role: null },
]

function roleDotColor(role: PersonRole): string {
  return role ? ROLE_STYLES[role].text : TEXT_TERTIARY
}

function windowCounts(p: PersonActivity, w: ActivityWindow) {
  return w === "1y"
    ? { booked: p.booked_1y, hosted: p.hosted_1y }
    : { booked: p.booked_30d, hosted: p.hosted_30d }
}

/** The value that drives bar length + sort, given the active view + window. */
function activeValue(p: PersonActivity, view: ActivityViewMode, w: ActivityWindow) {
  const { booked, hosted } = windowCounts(p, w)
  if (view === "booked") return booked
  if (view === "hosted") return hosted
  return booked + hosted
}

/** One person row: name · bar · value(s). */
function PersonRow({
  person,
  view,
  window,
  max,
}: {
  person: PersonActivity
  view: ActivityViewMode
  window: ActivityWindow
  max: number
}) {
  const { booked, hosted } = windowCounts(person, window)
  const pct = (n: number) => (max > 0 ? (n / max) * 100 : 0)

  return (
    <div className="flex items-center gap-3 py-[3px]">
      <div
        className="shrink-0 truncate text-xs"
        style={{ width: 130, color: TEXT_SECONDARY }}
        title={person.display_name}
      >
        {person.display_name}
      </div>

      {/* Count first (before the bar), right-aligned in a fixed column so the
          numbers line up vertically. */}
      <div className="shrink-0 text-right text-xs tabular-nums" style={{ width: 76 }}>
        {view === "combined" ? (
          <>
            <span style={{ color: BOOKED_COLOR, fontWeight: 600 }}>
              {booked.toLocaleString()}
            </span>
            <span style={{ color: TEXT_TERTIARY }}> / </span>
            <span style={{ color: HOSTED_COLOR, fontWeight: 600 }}>
              {hosted.toLocaleString()}
            </span>
          </>
        ) : (
          <span
            style={{
              color: view === "booked" ? BOOKED_COLOR : HOSTED_COLOR,
              fontWeight: 600,
            }}
          >
            {(view === "booked" ? booked : hosted).toLocaleString()}
          </span>
        )}
      </div>

      <div
        className="flex h-2.5 flex-1 overflow-hidden rounded-full"
        style={{ background: "#EEF0F4" }}
      >
        {(view === "combined" || view === "booked") && (
          <div style={{ width: `${pct(booked)}%`, background: BOOKED_COLOR }} />
        )}
        {(view === "combined" || view === "hosted") && (
          <div style={{ width: `${pct(hosted)}%`, background: HOSTED_COLOR }} />
        )}
      </div>
    </div>
  )
}

function ActivityByPersonCard({ people }: { people: PersonActivity[] }) {
  const [view, setView] = React.useState<ActivityViewMode>("combined")
  const [window, setWindow] = React.useState<ActivityWindow>("1y")

  // Single firm-wide scale so bars are comparable across every group.
  const max = React.useMemo(
    () => people.reduce((mx, p) => Math.max(mx, activeValue(p, view, window)), 0),
    [people, view, window],
  )

  // Group by stable role; sort each group by the active metric, desc.
  const groups = React.useMemo(
    () =>
      ACTIVITY_GROUPS.map((g) => ({
        ...g,
        members: people
          .filter((p) => p.role === g.role)
          .sort((a, b) => activeValue(b, view, window) - activeValue(a, view, window)),
      })).filter((g) => g.members.length > 0),
    [people, view, window],
  )

  return (
    <div id="activity-by-person" className={`mt-4 scroll-mt-20 p-5 ${CARD_CLASS}`}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 flex size-7 items-center justify-center rounded-lg"
            style={{ background: "#EEF2FB", color: BRAND_BLUE }}
          >
            <Users className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
              Activity by Person
            </div>
            <div className="text-xs" style={{ color: TEXT_MUTED }}>
              Meetings booked &amp; hosted · grouped by primary function ·{" "}
              {window === "1y" ? "last 12 months" : "last 30 days"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedToggle
            value={view}
            onChange={setView}
            options={[
              { value: "combined", label: "Combined" },
              { value: "booked", label: "Booked" },
              { value: "hosted", label: "Hosted" },
            ]}
          />
          <SegmentedToggle
            value={window}
            onChange={setWindow}
            options={[
              { value: "1y", label: "1 year" },
              { value: "30d", label: "30 days" },
            ]}
          />
        </div>
      </div>

      {people.length === 0 ? (
        <div
          className="flex h-[120px] items-center justify-center text-sm"
          style={{ color: TEXT_MUTED }}
        >
          No per-person activity to chart.
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-[#EEF0F4]">
          {groups.map((g) => (
            <div key={g.label} className="py-4 first:pt-0 last:pb-0">
              <div className="mb-1.5 flex items-center gap-2">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: roleDotColor(g.role) }}
                  aria-hidden="true"
                />
                <span
                  className="text-xs font-semibold"
                  style={{ color: TEXT_PRIMARY }}
                >
                  {g.label}
                </span>
                <span className="text-xs" style={{ color: TEXT_MUTED }}>
                  {g.members.length}
                </span>
              </div>
              <div>
                {g.members.map((p) => (
                  <PersonRow
                    key={p.user_id}
                    person={p}
                    view={view}
                    window={window}
                    max={max}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 text-xs" style={{ color: TEXT_MUTED }}>
        <LegendItem swatch={BOOKED_COLOR} label="Booked" />
        <LegendItem swatch={HOSTED_COLOR} label="Hosted" />
      </div>
    </div>
  )
}

// ---- Section KPI cards (top of page) ---------------------------------------

const TREND_UP = "#0E8A5A"
const TREND_DOWN = "#B42318"
const SLATE = "#3D5599"

/** Tiny inline-SVG sparkline with a faint area fill (no axes). */
function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null
  const w = 96
  const h = 24
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
      <polygon points={area} fill={color} opacity={0.12} />
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

// Card 1 — meetings over the last 12 months vs the prior 12, plus a sparkline.
function meetingsKpi(monthly: MeetingsMonthlyRow[]) {
  const last12 = monthly.slice(-12)
  const prev12 = monthly.slice(-24, -12)
  const total = last12.reduce((s, r) => s + r.total, 0)
  const prevTotal = prev12.reduce((s, r) => s + r.total, 0)
  const pct = prevTotal > 0 ? (total / prevTotal - 1) * 100 : null
  return { total, pct, spark: last12.map((r) => r.total) }
}

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

// Card 2 — busiest calendar month (cross-year average) + how the latest
// COMPLETE month compares to its seasonal norm. The in-progress current month
// is excluded from both so its partial total can't skew the picture.
function seasonalityKpi(
  monthly: MeetingsMonthlyRow[],
  curYear: number,
  curMonth: number,
) {
  const complete = monthly.filter(
    (r) => !(r.period_year === curYear && r.period_month === curMonth),
  )
  if (complete.length === 0) return null

  // Average total per calendar month across the years present.
  const byMonth = new Map<number, number[]>()
  for (const r of complete) {
    const arr = byMonth.get(r.period_month) ?? []
    arr.push(r.total)
    byMonth.set(r.period_month, arr)
  }
  let busiest = 1
  let busiestAvg = -1
  for (const [m, arr] of byMonth) {
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length
    if (avg > busiestAvg) {
      busiestAvg = avg
      busiest = m
    }
  }

  // Latest complete month vs prior-years' norm for that same month.
  const latest = complete[complete.length - 1]
  const priorSameMonth = complete.filter(
    (r) => r.period_month === latest.period_month && r.period_year !== latest.period_year,
  )
  let pctVsNorm: number | null = null
  if (priorSameMonth.length > 0) {
    const norm =
      priorSameMonth.reduce((s, r) => s + r.total, 0) / priorSameMonth.length
    if (norm > 0) pctVsNorm = (latest.total / norm - 1) * 100
  }

  return {
    busiestLabel: FULL_MONTHS[busiest - 1],
    latestLabel: FULL_MONTHS[latest.period_month - 1].slice(0, 3),
    pctVsNorm,
  }
}

// Card 4 — firm-wide feedback completion, last 12 months vs the prior 12,
// summed from the same per-person feedback view (one source of truth, so the
// definition is identical to the Feedback by Person chart).
function feedbackKpi(feedback: PersonFeedbackWindowsRow[]) {
  let aCur = 0
  let cCur = 0
  let aPrev = 0
  let cPrev = 0
  for (const p of feedback) {
    aCur += p.assigned_1y
    cCur += p.collected_1y
    aPrev += p.assigned_prev_1y
    cPrev += p.collected_prev_1y
  }
  const curPct = aCur > 0 ? (cCur / aCur) * 100 : null
  const prevPct = aPrev > 0 ? (cPrev / aPrev) * 100 : null
  const ptsDelta = curPct != null && prevPct != null ? curPct - prevPct : null
  return { curPct, ptsDelta, collected: cCur, assigned: aCur }
}

/** One section KPI card: section chrome + click-to-scroll, with a stat body. */
function SectionKpiCard({
  targetId,
  accent,
  icon: Icon,
  label,
  children,
}: {
  targetId: string
  accent: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  return (
    <a
      href={`#${targetId}`}
      onClick={handleClick}
      className={`group flex flex-col p-4 ${CARD_CLASS}`}
    >
      {/* Headline row: icon + section name (the prominent element). */}
      <div className="mb-2 flex items-center gap-2.5">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${accent}1A`, color: accent }}
        >
          <Icon className="size-4" />
        </span>
        <div
          className="text-[13px] font-semibold leading-tight"
          style={{ color: TEXT_PRIMARY }}
        >
          {label}
        </div>
      </div>
      {children}

      {/* Spacer bottom-aligns the footer with comfortable spacing above it. */}
      <div className="min-h-[14px] flex-1" aria-hidden="true" />

      {/* Footer affordance: "View chart ↓" in the card's accent color. The
          down-arrow nudges down on hover to signal a same-page scroll. */}
      <div className="border-t pt-2.5" style={{ borderColor: "#F0F2F5" }}>
        <span
          className="inline-flex items-center gap-1"
          style={{ color: accent, fontWeight: 600, fontSize: 11.5 }}
        >
          View chart
          <ArrowDown className="size-3.5 transition-transform duration-150 group-hover:translate-y-0.5" />
        </span>
      </div>
    </a>
  )
}

function SectionKpiCards({
  monthly,
  people,
  feedback,
}: {
  monthly: MeetingsMonthlyRow[]
  people: PersonActivity[]
  feedback: PersonFeedbackWindowsRow[]
}) {
  const m = React.useMemo(() => meetingsKpi(monthly), [monthly])
  const s = React.useMemo(() => {
    const now = new Date()
    return seasonalityKpi(monthly, now.getFullYear(), now.getMonth() + 1)
  }, [monthly])
  const f = React.useMemo(() => feedbackKpi(feedback), [feedback])

  const roleCounts = React.useMemo(() => {
    const c = { Booker: 0, Host: 0, Hybrid: 0 }
    for (const p of people) {
      if (p.role === "Booker") c.Booker++
      else if (p.role === "Host") c.Host++
      else if (p.role === "Hybrid") c.Hybrid++
    }
    return c
  }, [people])

  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Card 1 — Meetings Over Time */}
      <SectionKpiCard
        targetId="meetings-over-time"
        accent={BRAND_BLUE}
        icon={BarChart3}
        label="Meetings Over Time"
      >
        <div className="mt-1 flex items-end justify-between gap-2">
          <div>
            <div
              className="text-xl font-semibold tabular-nums"
              style={{ color: TEXT_PRIMARY }}
            >
              {m.total.toLocaleString()}
            </div>
            <div className="flex items-center gap-1.5 text-xs" style={{ color: TEXT_TERTIARY }}>
              {m.pct != null && (
                <span
                  className="tabular-nums font-medium"
                  style={{ color: m.pct >= 0 ? TREND_UP : TREND_DOWN }}
                >
                  {m.pct >= 0 ? "▲" : "▼"} {Math.abs(m.pct).toFixed(0)}%
                </span>
              )}
              <span>last 12 mo</span>
            </div>
          </div>
          <MiniSparkline values={m.spark} color={BRAND_BLUE} />
        </div>
      </SectionKpiCard>

      {/* Card 2 — Seasonality */}
      <SectionKpiCard
        targetId="seasonality"
        accent={TEAL}
        icon={Waves}
        label="Seasonality"
      >
        <div className="mt-1">
          <div className="text-xl font-semibold" style={{ color: TEXT_PRIMARY }}>
            {s ? s.busiestLabel : "—"}
          </div>
          <div className="text-xs" style={{ color: TEXT_TERTIARY }}>
            {s && s.pctVsNorm != null ? (
              <>
                busiest season ·{" "}
                <span style={{ color: TEXT_SECONDARY }}>
                  {s.latestLabel}{" "}
                  <span
                    className="tabular-nums font-medium"
                    style={{ color: s.pctVsNorm >= 0 ? TREND_UP : TREND_DOWN }}
                  >
                    {Math.abs(s.pctVsNorm).toFixed(0)}% {s.pctVsNorm >= 0 ? "above" : "below"}
                  </span>{" "}
                  typical
                </span>
              </>
            ) : (
              "busiest month on average"
            )}
          </div>
        </div>
      </SectionKpiCard>

      {/* Card 3 — Activity by Person */}
      <SectionKpiCard
        targetId="activity-by-person"
        accent={SLATE}
        icon={Users}
        label="Activity by Person"
      >
        <div className="mt-1">
          <div
            className="text-xl font-semibold tabular-nums"
            style={{ color: TEXT_PRIMARY }}
          >
            {people.length.toLocaleString()}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: TEXT_SECONDARY }}>
            {(["Booker", "Host", "Hybrid"] as const).map((role) => (
              <span key={role} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: roleDotColor(role) }}
                  aria-hidden="true"
                />
                <span className="tabular-nums font-medium">{roleCounts[role]}</span>
                <span style={{ color: TEXT_TERTIARY }}>
                  {role === "Booker" ? "Bookers" : role === "Host" ? "Hosts" : "Hybrids"}
                </span>
              </span>
            ))}
          </div>
        </div>
      </SectionKpiCard>

      {/* Card 4 — Feedback */}
      <SectionKpiCard
        targetId="feedback-by-person"
        accent="#0E7C56"
        icon={MessageSquareText}
        label="Feedback"
      >
        <div className="mt-1">
          <div
            className="text-xl font-semibold tabular-nums"
            style={{ color: TEXT_PRIMARY }}
          >
            {f.curPct != null ? `${Math.round(f.curPct)}%` : "—"}
          </div>
          <div className="flex flex-col gap-0.5 text-xs" style={{ color: TEXT_TERTIARY }}>
            {f.ptsDelta != null && (
              <span className="flex items-center gap-1.5">
                <span
                  className="tabular-nums font-medium"
                  style={{ color: f.ptsDelta >= 0 ? TREND_UP : TREND_DOWN }}
                >
                  {f.ptsDelta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(f.ptsDelta))} pts
                </span>
                <span>vs prior yr</span>
              </span>
            )}
            <span className="tabular-nums">
              {f.collected.toLocaleString()} of {f.assigned.toLocaleString()} closed
            </span>
          </div>
        </div>
      </SectionKpiCard>
    </div>
  )
}

// ---- Chart D — Feedback by Person ------------------------------------------

// Completion-rate tiers (the % text up front).
function rateColor(pct: number): string {
  if (pct >= 75) return "#0E7C56"
  if (pct >= 50) return "#854F0B"
  return "#A32D2D"
}
const FEEDBACK_GREEN = "#0E7C56" // green fill within each bar (collected)
const FEEDBACK_MIN_ASSIGNED = 25 // exclude low-volume people (denominator < 25)

function feedbackWindowCounts(p: PersonFeedbackWindowsRow, w: ActivityWindow) {
  return w === "1y"
    ? { assigned: p.assigned_1y, collected: p.collected_1y }
    : { assigned: p.assigned_30d, collected: p.collected_30d }
}

function FeedbackRow({
  person,
  window,
  maxAssigned,
}: {
  person: PersonFeedbackWindowsRow
  window: ActivityWindow
  maxAssigned: number
}) {
  const { assigned, collected } = feedbackWindowCounts(person, window)
  const pct = assigned > 0 ? (collected / assigned) * 100 : 0
  // Volume-aware bar: total length ∝ assignments, green fill ∝ completion.
  const barPct = maxAssigned > 0 ? (assigned / maxAssigned) * 100 : 0
  const greenPct = maxAssigned > 0 ? (collected / maxAssigned) * 100 : 0

  return (
    <div className="flex items-center gap-3 py-[3px]">
      <div
        className="shrink-0 truncate text-xs"
        style={{ width: 130, color: TEXT_SECONDARY }}
        title={person.display_name}
      >
        {person.display_name}
      </div>
      <div
        className="shrink-0 text-right text-xs font-semibold tabular-nums"
        style={{ width: 40, color: rateColor(pct) }}
      >
        {Math.round(pct)}%
      </div>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full">
        {/* assignments volume (backdrop) */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${barPct}%`, background: "#E3E6EC" }}
        />
        {/* collected (green fill) */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${greenPct}%`, background: FEEDBACK_GREEN }}
        />
      </div>
      <div
        className="shrink-0 text-right text-xs tabular-nums"
        style={{ width: 72, color: TEXT_TERTIARY }}
      >
        <span style={{ color: FEEDBACK_GREEN, fontWeight: 600 }}>
          {collected.toLocaleString()}
        </span>
        {" / "}
        {assigned.toLocaleString()}
      </div>
    </div>
  )
}

function FeedbackByPersonCard({ feedback }: { feedback: PersonFeedbackWindowsRow[] }) {
  const [window, setWindow] = React.useState<ActivityWindow>("1y")

  const rows = React.useMemo(() => {
    return feedback
      .filter((p) => feedbackWindowCounts(p, window).assigned >= FEEDBACK_MIN_ASSIGNED)
      .sort((a, b) => {
        const ca = feedbackWindowCounts(a, window)
        const cb = feedbackWindowCounts(b, window)
        return cb.collected / cb.assigned - ca.collected / ca.assigned
      })
  }, [feedback, window])

  const maxAssigned = React.useMemo(
    () => rows.reduce((mx, p) => Math.max(mx, feedbackWindowCounts(p, window).assigned), 0),
    [rows, window],
  )

  return (
    <div id="feedback-by-person" className={`mt-4 scroll-mt-20 p-5 ${CARD_CLASS}`}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 flex size-7 items-center justify-center rounded-lg"
            style={{ background: "#EEF2FB", color: BRAND_BLUE }}
          >
            <MessageSquareText className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
              Feedback by Person
            </div>
            <div className="text-xs" style={{ color: TEXT_MUTED }}>
              Completion = “Closed - All in” ÷ resolved assignments (Closed - All in +
              Closed - No Feedback) · host-attributed · ≥{FEEDBACK_MIN_ASSIGNED} in{" "}
              {window === "1y" ? "last 12 months" : "last 30 days"}
            </div>
          </div>
        </div>
        <SegmentedToggle
          value={window}
          onChange={setWindow}
          options={[
            { value: "1y", label: "1 year" },
            { value: "30d", label: "30 days" },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <div
          className="flex h-[120px] items-center justify-center text-center text-sm"
          style={{ color: TEXT_MUTED }}
        >
          No one with ≥{FEEDBACK_MIN_ASSIGNED} feedback assignments in this window.
        </div>
      ) : (
        <div>
          {rows.map((p) => (
            <FeedbackRow
              key={p.user_id}
              person={p}
              window={window}
              maxAssigned={maxAssigned}
            />
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs" style={{ color: TEXT_MUTED }}>
        <LegendItem swatch={FEEDBACK_GREEN} label="Collected" />
        <LegendItem swatch="#E3E6EC" label="Assigned (not collected)" />
        <span className="flex items-center gap-1.5">
          bar length ∝ assignments · green ∝ completion
        </span>
      </div>
    </div>
  )
}

export function PeopleStatisticsView({
  monthly,
  people,
  feedback,
}: {
  monthly: MeetingsMonthlyRow[]
  people: PersonActivity[]
  feedback: PersonFeedbackWindowsRow[]
}) {
  const [mode, setMode] = React.useState<ChartMode>("monthly")

  const monthlyPoints = React.useMemo(() => toMonthly(monthly), [monthly])
  const quarterlyPoints = React.useMemo(() => toQuarterly(monthly), [monthly])

  const points = mode === "monthly" ? monthlyPoints : quarterlyPoints
  const totals = React.useMemo(() => summarize(points), [points])
  const perLabel = mode === "monthly" ? "Avg / mo" : "Avg / qtr"
  const subtitle =
    mode === "monthly"
      ? "Last 12 months · stacked: virtual + in-person, total trend overlaid"
      : "Last 4 years · stacked: virtual + in-person, total trend overlaid"

  return (
    <>
      {/* Floating list-title masthead (firm-wide list page) */}
      <div className="mb-4">
        <ListTitleCard title="Statistics" subtitle="Firm-wide meeting analytics" />
      </div>

      {/* Section KPI cards — tease each section, smooth-scroll to it */}
      <SectionKpiCards monthly={monthly} people={people} feedback={feedback} />

      {/* Chart A — Meetings Over Time */}
      <div id="meetings-over-time" className={`scroll-mt-20 p-5 ${CARD_CLASS}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span
              className="mt-0.5 flex size-7 items-center justify-center rounded-lg"
              style={{ background: "#EEF2FB", color: BRAND_BLUE }}
            >
              <BarChart3 className="size-4" />
            </span>
            <div>
              <div className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
                Meetings Over Time
              </div>
              <div className="text-xs" style={{ color: TEXT_MUTED }}>
                {subtitle}
              </div>
            </div>
          </div>
          <SegmentedToggle
            value={mode}
            onChange={setMode}
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "quarterly", label: "Quarterly" },
            ]}
          />
        </div>

        <StatStrip totals={totals} perLabel={perLabel} />

        {points.length === 0 ? (
          <div
            className="flex h-[300px] items-center justify-center text-sm"
            style={{ color: TEXT_MUTED }}
          >
            No confirmed meetings in this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart
              data={points}
              margin={{ top: 12, right: 8, left: -8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
              <XAxis
                dataKey="label"
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
                cursor={{ fill: "rgba(16,24,40,0.04)" }}
                content={<CustomTooltip />}
              />
              <Bar
                dataKey="virtual_count"
                stackId="a"
                fill={VIRTUAL_COLOR}
                radius={[0, 0, 0, 0]}
                maxBarSize={48}
              />
              <Bar
                dataKey="live_count"
                stackId="a"
                fill={LIVE_COLOR}
                radius={[3, 3, 0, 0]}
                maxBarSize={48}
              />
              <Line
                type="monotone"
                dataKey="total"
                stroke={TOTAL_COLOR}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                activeDot={{ r: 4, fill: TOTAL_COLOR }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {/* Legend */}
        <div className="mt-3 flex items-center gap-4 text-xs" style={{ color: TEXT_MUTED }}>
          <LegendItem swatch={VIRTUAL_COLOR} label="Virtual" />
          <LegendItem swatch={LIVE_COLOR} label="In-person" />
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-0 w-4 border-t-2 border-dashed"
              style={{ borderColor: TOTAL_COLOR }}
              aria-hidden="true"
            />
            <span>Total trend</span>
          </span>
        </div>
      </div>

      {/* Chart B — Seasonality */}
      <SeasonalityCard monthly={monthly} />

      {/* Chart C — Activity by Person */}
      <ActivityByPersonCard people={people} />

      {/* Chart D — Feedback by Person */}
      <FeedbackByPersonCard feedback={feedback} />
    </>
  )
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ backgroundColor: swatch }}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  )
}

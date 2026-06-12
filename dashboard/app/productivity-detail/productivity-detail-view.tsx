"use client"

import * as React from "react"
import Link from "next/link"
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
import { formatCurrency } from "@/lib/format"
import { StatCard } from "@/components/stat-card"
import { EntityMasthead, MastheadSelector } from "@/components/page-masthead"
import { CARD_CLASS, MONEY_GREEN } from "@/lib/design"
import type {
  AnalystMonthlyActivityRow,
  ProductivityDetailInstitutionRow,
  ProductivityDetailRow,
  UserOption,
} from "@/lib/types"

const NAVY = "#1E2858"
const TEAL = "#00B8B8"

/** Initials from a display name: first letters of first + last word. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ""
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}
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

export function ProductivityDetailView({
  rows,
  monthlyRows,
  institutionRows,
  userOptions,
}: {
  rows: ProductivityDetailRow[]
  monthlyRows: AnalystMonthlyActivityRow[]
  institutionRows: ProductivityDetailInstitutionRow[]
  userOptions: UserOption[]
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

  // A single display_name can map to more than one user_id in the users
  // table (same convention v_analyst_monthly_activity uses). Build a
  // name -> set-of-user-ids map so we can pull every matching row from
  // v_productivity_detail_institutions.
  const userIdsByName = React.useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const u of userOptions) {
      if (!u.display_name) continue
      const set = map.get(u.display_name) ?? new Set<string>()
      set.add(u.user_id)
      map.set(u.display_name, set)
    }
    return map
  }, [userOptions])

  const selectedUserIds = React.useMemo(
    () => (selectedId ? userIdsByName.get(selectedId) ?? new Set<string>() : new Set<string>()),
    [selectedId, userIdsByName],
  )

  // Roll up institution rows for the selected person. If two user_id
  // records share the same display_name, sum their per-institution counts.
  const personInstitutions = React.useMemo(() => {
    if (selectedUserIds.size === 0) return []
    const acc = new Map<
      string,
      {
        institution_id: string | null
        institution_name: string
        booked_count: number
        hosted_count: number
      }
    >()
    for (const r of institutionRows) {
      if (!selectedUserIds.has(r.user_id)) continue
      const key = r.institution_name
      const existing = acc.get(key)
      if (existing) {
        existing.booked_count += r.booked_count
        existing.hosted_count += r.hosted_count
        // Prefer the first non-null institution_id we see.
        if (existing.institution_id == null && r.institution_id != null) {
          existing.institution_id = r.institution_id
        }
      } else {
        acc.set(key, {
          institution_id: r.institution_id,
          institution_name: r.institution_name,
          booked_count: r.booked_count,
          hosted_count: r.hosted_count,
        })
      }
    }
    return Array.from(acc.values())
  }, [institutionRows, selectedUserIds])

  const bookedRows = React.useMemo(
    () =>
      personInstitutions
        .filter((r) => r.booked_count > 0)
        .sort((a, b) => b.booked_count - a.booked_count),
    [personInstitutions],
  )
  const hostedRows = React.useMemo(
    () =>
      personInstitutions
        .filter((r) => r.hosted_count > 0)
        .sort((a, b) => b.hosted_count - a.hosted_count),
    [personInstitutions],
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
      <div className={`p-6 text-sm text-muted-foreground ${CARD_CLASS}`}>
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

  const feedbackPctNum =
    selected.feedback_collection_rate_12m == null
      ? null
      : Math.round(selected.feedback_collection_rate_12m * 100)
  const feedbackPctText = feedbackPctNum == null ? "—" : `${feedbackPctNum}%`

  const tiles: Array<{
    label: string
    value: string
    hint: string
    valueColor?: string
    exact?: string
    sparkline?: React.ReactNode
  }> = [
    {
      label: "Scheduled",
      value: selected.meetings_scheduled_12m.toLocaleString(),
      hint: "As booker",
      valueColor: "#0154A6",
      sparkline: (
        <Sparkline values={chartData.map((d) => d.meetings_scheduled)} color="#0355A7" />
      ),
    },
    {
      label: "Hosted",
      value: selected.meetings_hosted_12m.toLocaleString(),
      hint: "As host",
      sparkline: (
        <Sparkline values={chartData.map((d) => d.meetings_hosted)} color="#1C8C9C" />
      ),
    },
    {
      label: "In Person",
      value: selected.meetings_in_person_12m.toLocaleString(),
      hint: `${inPersonPct}% of hosted`,
      sparkline: (
        <RatioBar pct={inPersonPct} fill="linear-gradient(90deg, #0355A7, #1C8C9C)" />
      ),
    },
    {
      label: "Feedback Rec'd",
      value: feedbackPctText,
      hint: "Of hosted meetings",
      valueColor: TEAL,
      sparkline:
        feedbackPctNum != null ? (
          <RatioBar pct={feedbackPctNum} fill="linear-gradient(90deg, #1C9E72, #37B88C)" />
        ) : undefined,
    },
    {
      label: "Active Clients",
      value: selected.active_clients_as_sales_lead.toLocaleString(),
      hint: "As sales lead",
    },
    {
      label: "Revenue Managed",
      value: formatCompactDollars(selected.sales_lead_book_annualized),
      hint: "Annualized retainer",
      valueColor: MONEY_GREEN,
      exact: formatCurrency(selected.sales_lead_book_annualized),
    },
  ]

  return (
    <>
      {/* Floating masthead — badge, name, subtitle, selector */}
      <div className="mb-4">
        <EntityMasthead
          badge={initials(selected.display_name)}
          name={selected.display_name}
          subtitle="Activity over the trailing 12 months"
          rightSlot={
            <MastheadSelector
              items={rows.map((r) => ({
                value: r.display_name,
                label: r.display_name,
              }))}
              value={selected.display_name}
              onChange={goTo}
              onPrev={goPrev}
              onNext={goNext}
              ariaLabel="Select person"
            />
          }
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <StatCard
            key={t.label}
            floating
            label={t.label}
            value={t.exact ? <span title={t.exact}>{t.value}</span> : t.value}
            valueColor={t.valueColor}
            hint={t.hint}
            sparkline={t.sparkline}
          />
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
        <div className={`p-5 ${CARD_CLASS}`}>
          <div className="mb-3">
            <div className="text-sm font-medium" style={{ color: NAVY }}>
              Meetings Scheduled
            </div>
            <div className="text-xs text-muted-foreground">
              Booked by this person
            </div>
          </div>
          <div>
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
          </div>
        </div>

        <div className={`p-5 ${CARD_CLASS}`}>
          <div className="mb-3 flex items-start justify-between">
            <div>
              <div className="text-sm font-medium" style={{ color: NAVY }}>
                Meetings Hosted
              </div>
              <div className="text-xs text-muted-foreground">
                Split: virtual vs. in-person
              </div>
            </div>
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
          </div>
          <div>
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
          </div>
        </div>

        <div className={`p-5 ${CARD_CLASS}`}>
          <div className="mb-3">
            <div className="text-sm font-medium" style={{ color: NAVY }}>
              Feedback Collection
            </div>
            <div className="text-xs text-muted-foreground">
              % of hosted meetings with feedback collected
            </div>
          </div>
          <div>
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
          </div>
        </div>
      </div>

      <div className="my-6 flex items-center gap-3">
        <span
          className="shrink-0 text-base font-medium"
          style={{ color: NAVY }}
        >
          Meetings by Institution
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <InstitutionTable
          title="Meetings booked"
          description="Top 10 institutions, last 12 months"
          rows={bookedRows}
          countKey="booked_count"
        />
        <InstitutionTable
          title="Meetings hosted"
          description="Top 10 institutions, last 12 months"
          rows={hostedRows}
          countKey="hosted_count"
        />
      </div>
    </>
  )
}

function InstitutionTable({
  title,
  description,
  rows,
  countKey,
}: {
  title: string
  description: string
  rows: Array<{
    institution_id: string | null
    institution_name: string
    booked_count: number
    hosted_count: number
  }>
  countKey: "booked_count" | "hosted_count"
}) {
  const TOP_N = 10
  const visible = rows.slice(0, TOP_N)
  const overflow = Math.max(0, rows.length - TOP_N)
  const total = rows.reduce((sum, r) => sum + r[countKey], 0)

  return (
    <div className={`p-5 ${CARD_CLASS}`}>
      <div className="mb-3">
        <div className="text-sm font-medium" style={{ color: NAVY }}>
          {title}
        </div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <div>
        {rows.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">
            No meetings in the last 12 months.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">Institution</th>
                <th className="px-2 py-2 text-right font-medium">Count</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.institution_name} className="border-b last:border-b-0">
                  <td className="px-2 py-2">
                    {row.institution_id ? (
                      <Link
                        href={`/institution-detail?institution_id=${row.institution_id}`}
                        className="font-medium hover:underline"
                        style={{ color: NAVY }}
                      >
                        {row.institution_name}
                      </Link>
                    ) : (
                      <span className="font-medium" style={{ color: NAVY }}>
                        {row.institution_name}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {row[countKey].toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td
                  className="px-2 pt-2 text-xs font-medium"
                  style={{ color: NAVY }}
                >
                  Total (all)
                </td>
                <td
                  className="px-2 pt-2 text-right text-xs font-medium tabular-nums"
                  style={{ color: NAVY }}
                >
                  {total.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
        {overflow > 0 && (
          <div className="mt-2 px-2 text-xs italic text-muted-foreground">
            + {overflow.toLocaleString()} more institution{overflow === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  )
}

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
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react"
import { formatCurrency } from "@/lib/format"
import { GradientHero } from "@/components/gradient-hero"
import { StatCard } from "@/components/stat-card"
import { STAT_GRADIENTS, type PillVariant, type StatGradient } from "@/lib/gradients"
import type {
  ClientDetailQuarterlyRow,
  ClientDetailReachDepthRow,
  ClientDetailRecentMeetingRow,
  ClientDetailRecentNoteRow,
  ClientDetailSummaryRow,
  ClientDetailTopHostRow,
  ClientDetailTopInstitutionRow,
  ClientDetailTouchpointRow,
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

// First letter of the first and last word of a name ("Jane A. Doe" → "JD").
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ""
  if (words.length === 1) return words[0][0].toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export function ClientDetailView({
  allClients,
  selected,
  clientTicker,
  quarterly,
  topInstitutions,
  reachDepth,
  topHosts,
  recentMeetings,
  recentNote,
  touchpoints,
  accountTeam,
}: {
  allClients: ClientDetailSummaryRow[]
  selected: ClientDetailSummaryRow
  clientTicker: string | null
  quarterly: ClientDetailQuarterlyRow[]
  topInstitutions: ClientDetailTopInstitutionRow[]
  reachDepth: ClientDetailReachDepthRow[]
  topHosts: ClientDetailTopHostRow[]
  recentMeetings: ClientDetailRecentMeetingRow[]
  recentNote: ClientDetailRecentNoteRow | null
  touchpoints: ClientDetailTouchpointRow[]
  accountTeam: {
    sales_lead_primary_name: string | null
    secondary_manager_name: string | null
    associate_name: string | null
    logistics_coordinator_name: string | null
  }
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

  // ---------- Hero badge ----------
  // Prefer the client's ticker (exchange suffix stripped: "ADT-US" → "ADT").
  // Fall back to name initials for private/unlisted clients with no ticker.
  const monogram = React.useMemo(() => {
    const ticker = clientTicker?.trim()
    if (ticker) return ticker.split("-")[0]
    const words = selected.client_name.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return ""
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
    return (words[0][0] + words[1][0]).toUpperCase()
  }, [clientTicker, selected.client_name])

  // ---------- Hero status pill ----------
  // Best-effort read of the most-recent note's free-text status. Priority order
  // matters when one note mixes cues: most urgent signal wins. Matched buckets
  // get a clean canonical label; anything unmatched keeps the raw status text.
  const statusPill = React.useMemo<
    { label: string; variant: PillVariant } | undefined
  >(() => {
    const text = recentNote?.status_text?.trim()
    if (!text) return undefined
    const t = text.toLowerCase()
    if (/at[\s-]?risk|churn/.test(t)) return { label: "At Risk", variant: "atRisk" }
    if (/watch|flak/.test(t)) return { label: "Watch", variant: "watch" }
    if (/positive|strong|healthy|good/.test(t))
      return { label: "Positive", variant: "positive" }
    if (/\bnew\b/.test(t)) return { label: "New Client", variant: "new" }
    return { label: text, variant: "neutral" }
  }, [recentNote?.status_text])

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
    gradient: StatGradient
  }
  const tiles: Tile[] = [
    {
      label: "Meetings (LTM)",
      value: `${selected.ltm_meetings.toLocaleString()} / ${selected.lifetime_meetings.toLocaleString()}`,
      hint: <span style={{ color: deltaColor }}>{deltaText}</span>,
      gradient: STAT_GRADIENTS.meetings,
    },
    {
      label: "Institutions (LTM)",
      value: selected.ltm_unique_institutions.toLocaleString(),
      hint: `${selected.ltm_unique_investors.toLocaleString()} individual investors`,
      gradient: STAT_GRADIENTS.institutions,
    },
    {
      label: "Feedback Rec'd (LTM)",
      value: feedbackValue,
      valueColor: feedbackColor,
      hint: `${selected.ltm_feedback_collected.toLocaleString()} of ${selected.ltm_feedback_total_closed.toLocaleString()} closed`,
      gradient: STAT_GRADIENTS.feedback,
    },
    {
      label: "Annualized Retainer",
      value: formatCompactDollars(selected.annualized_retainer),
      valueColor: TEAL,
      hint:
        selected.annualized_retainer > 0
          ? `${formatCompactDollars(quarterlyDollars)}/quarter`
          : "No active contract",
      gradient: STAT_GRADIENTS.retainer,
    },
    {
      label: "$ per Meeting",
      value: formatCompactDollars(selected.dollars_per_meeting_ltm),
      hint: "LTM, retainer ÷ meetings",
      gradient: STAT_GRADIENTS.perMeeting,
    },
    {
      label: "Contract Renewal",
      value: renewalValue,
      valueColor: renewalColor,
      hint: renewalHint,
      gradient: STAT_GRADIENTS.renewal,
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

  // ---------- Touchpoints: collapse to the single most recent, expand to 25 ----------
  const TP_CAP = 25
  const [tpExpanded, setTpExpanded] = React.useState(false)
  const tpTotal = touchpoints.length
  const tpVisible = tpExpanded
    ? touchpoints.slice(0, TP_CAP)
    : touchpoints.slice(0, 1)

  // ---------- Note: deadline urgency (past or within 7 days) ----------
  const deadlineUrgent =
    recentNote?.days_to_deadline != null && recentNote.days_to_deadline <= 7

  // ---------- Account team strip ----------
  // Only render roles with an assigned (non-blank) name. Colors are drawn from
  // the shared navy→teal palette. The whole strip hides when nobody is assigned.
  const accountTeamMembers = (
    [
      { role: "Account Mgr", name: accountTeam.sales_lead_primary_name, color: "#1E2858" },
      { role: "Secondary", name: accountTeam.secondary_manager_name, color: "#3D5599" },
      { role: "Associate", name: accountTeam.associate_name, color: "#1C8C9C" },
      { role: "Logistics", name: accountTeam.logistics_coordinator_name, color: "#4FC6BC" },
    ] as Array<{ role: string; name: string | null; color: string }>
  ).filter((m): m is { role: string; name: string; color: string } =>
    Boolean(m.name && m.name.trim()),
  )

  // ---------- Render ----------
  return (
    <>
      {/* Section 1: Gradient hero header */}
      <div className="mb-4">
        <GradientHero
          title={selected.client_name}
          subtitle={subtitleParts.join(" · ")}
          monogram={monogram}
          status={statusPill}
          rightSlot={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous client"
                className="flex h-9 w-9 items-center justify-center rounded-md text-white transition-colors"
                style={{
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.26)",
                }}
              >
                <ChevronLeft className="size-4" />
              </button>
              <select
                value={selected.account_id}
                onChange={(e) => goTo(e.target.value)}
                className="h-9 min-w-[220px] rounded-md px-2 text-sm text-white"
                style={{
                  background: "rgba(255,255,255,0.12)",
                  border: "1px solid rgba(255,255,255,0.26)",
                }}
                aria-label="Select client"
              >
                {allClients.map((c) => (
                  <option
                    key={c.account_id}
                    value={c.account_id}
                    style={{ color: NAVY_DEEP }}
                  >
                    {c.client_name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={goNext}
                aria-label="Next client"
                className="flex h-9 w-9 items-center justify-center rounded-md text-white transition-colors"
                style={{
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.26)",
                }}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          }
        />
      </div>

      {/* Section 2: 6 KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <StatCard
            key={t.label}
            label={t.label}
            value={t.value}
            hint={t.hint}
            valueColor={t.valueColor}
            gradient={t.gradient}
          />
        ))}
      </div>

      {/* Account Team strip — slim secondary-surface bar of assigned people */}
      {accountTeamMembers.length > 0 && (
        <div
          className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 bg-secondary"
          style={{
            border: "0.5px solid var(--border)",
            borderRadius: 11,
            padding: "10px 14px",
          }}
        >
          <span
            className="shrink-0 text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: TICK_FILL }}
          >
            Account Team
          </span>
          {accountTeamMembers.map((m, i) => (
            <React.Fragment key={m.role}>
              {i > 0 && (
                <span className="text-muted-foreground" aria-hidden="true">
                  ·
                </span>
              )}
              <span className="flex items-center gap-2">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold leading-none text-white"
                  style={{ backgroundColor: m.color }}
                  aria-hidden="true"
                >
                  {initialsOf(m.name)}
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {m.role}
                  </span>
                  <span className="text-sm font-medium" style={{ color: NAVY_DEEP }}>
                    {m.name}
                  </span>
                </span>
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Client Touchpoints & Notes */}
      <div className="my-6 flex items-center gap-3">
        <span
          className="shrink-0 text-base font-medium"
          style={{ color: NAVY_DEEP }}
        >
          Client Touchpoints &amp; Notes
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      {/* Note + Touchpoints, side by side at lg+ (stacked below). min-w-0 lets
          the touchpoints table shrink instead of blowing out its column. */}
      <div className="mb-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        {/* Most Recent Client Note — only when a note exists */}
        {recentNote && (
          <div className="min-w-0 rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-sm font-medium" style={{ color: NAVY_DEEP }}>
                Most Recent Client Note
              </div>
            <div className="text-xs text-muted-foreground">
              {formatLongDate(recentNote.note_date)}
            </div>
          </div>
          {(recentNote.status_text ||
            recentNote.primary_risk_driver ||
            recentNote.action_step) && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {recentNote.status_text && (
                <span
                  className="rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ backgroundColor: GRAY_BG, color: NAVY_MID }}
                >
                  {recentNote.status_text}
                </span>
              )}
              {recentNote.primary_risk_driver && (
                <span
                  className="rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ backgroundColor: "#FAEEDA", color: "#854F0B" }}
                >
                  Primary risk: {recentNote.primary_risk_driver}
                </span>
              )}
              {recentNote.action_step && (
                <>
                  <span className="h-4 w-px bg-border" aria-hidden="true" />
                  <span className="whitespace-nowrap text-xs">
                    <span className="text-muted-foreground">Action </span>
                    <span style={{ color: NAVY_DEEP }}>
                      {recentNote.action_step}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-xs">
                    <span className="text-muted-foreground">Owner </span>
                    <span style={{ color: NAVY_DEEP }}>
                      {recentNote.action_owner ?? "—"}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-xs">
                    <span className="text-muted-foreground">Due </span>
                    <span
                      className={deadlineUrgent ? "font-medium" : ""}
                      style={{ color: deadlineUrgent ? RED : NAVY_DEEP }}
                    >
                      {formatShortDate(recentNote.action_deadline)}
                    </span>
                  </span>
                </>
              )}
            </div>
          )}
          {recentNote.notes_text && (
            <p className="whitespace-pre-line text-sm text-foreground">
              {recentNote.notes_text}
            </p>
          )}
        </div>
      )}

        {/* Recent Touchpoints */}
        <div className="min-w-0 rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium" style={{ color: NAVY_DEEP }}>
            Recent Touchpoints
          </div>
          {tpTotal > 1 && (
            <button
              type="button"
              onClick={() => setTpExpanded((v) => !v)}
              className="flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium hover:bg-accent"
              style={{ color: NAVY_DEEP }}
            >
              {tpExpanded ? (
                <>
                  Show less
                  <ChevronUp className="size-3.5" />
                </>
              ) : (
                <>
                  Show all {tpTotal.toLocaleString()}
                  <ChevronDown className="size-3.5" />
                </>
              )}
            </button>
          )}
        </div>
        {tpTotal === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No touchpoints on record.
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-2 py-2 text-left font-medium">Date</th>
                  <th className="px-2 py-2 text-left font-medium">Subject</th>
                  <th className="px-2 py-2 text-left font-medium">Type</th>
                  <th className="px-2 py-2 text-left font-medium">Dir.</th>
                  <th className="px-2 py-2 text-right font-medium">Min</th>
                </tr>
              </thead>
              <tbody>
                {tpVisible.map((t) => {
                  const isOut = t.direction_code === true
                  return (
                    <tr key={t.touchpoint_id} className="border-b last:border-b-0">
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                        {formatLongDate(t.scheduled_start)}
                      </td>
                      <td className="px-2 py-2">{t.subject ?? "—"}</td>
                      <td className="px-2 py-2">
                        {t.touchpoint_type_label ? (
                          <span
                            className="inline-block rounded px-2 py-0.5 text-xs font-medium"
                            style={{ backgroundColor: GRAY_BG, color: NAVY_DEEP }}
                          >
                            {t.touchpoint_type_label}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className="inline-block rounded px-2 py-0.5 text-xs font-medium"
                          style={
                            isOut
                              ? { backgroundColor: TEAL_LIGHTEST, color: NAVY_DEEP }
                              : { backgroundColor: GRAY_BG, color: NAVY_MID }
                          }
                        >
                          {isOut ? "Out" : "In"}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {t.actual_duration_minutes != null
                          ? t.actual_duration_minutes.toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
        </div>
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
                          <td className="px-2 py-2">
                            {row.institution_id ? (
                              <Link
                                href={`/institution-detail?institution_id=${row.institution_id}`}
                                className="hover:underline text-[#1E2858] font-medium"
                              >
                                {row.institution_name}
                              </Link>
                            ) : (
                              <span className="font-medium" style={{ color: NAVY_DEEP }}>
                                {row.institution_name}
                              </span>
                            )}
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
                  <Link
                    href={`/productivity-detail?display_name=${encodeURIComponent(h.host_name)}`}
                    className="hover:underline text-[#1E2858] font-medium"
                  >
                    {h.host_name}
                  </Link>
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
                    <td className="px-2 py-2">
                      {m.institution_id && m.institution_name ? (
                        <Link
                          href={`/institution-detail?institution_id=${m.institution_id}`}
                          className="hover:underline text-[#1E2858] font-medium"
                        >
                          {m.institution_name}
                        </Link>
                      ) : (
                        <span className="font-medium" style={{ color: NAVY_DEEP }}>
                          {m.institution_name ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {m.host_name ? (
                        <Link
                          href={`/productivity-detail?display_name=${encodeURIComponent(m.host_name)}`}
                          className="hover:underline text-[#1E2858] font-medium"
                        >
                          {m.host_name}
                        </Link>
                      ) : (
                        "—"
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

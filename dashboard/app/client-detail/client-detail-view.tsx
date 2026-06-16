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
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers,
  NotebookText,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react"
import { formatCurrency } from "@/lib/format"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { StatCard } from "@/components/stat-card"
import { EntityMasthead, MastheadSelector } from "@/components/page-masthead"
import { type PillVariant } from "@/lib/gradients"
import {
  CARD_CLASS,
  MONEY_GREEN,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "@/lib/design"
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

/** Tiny inline-SVG trend line for a KPI card (no axes, no chrome). */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null
  const w = 88
  const h = 20
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / span) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Thin ratio bar for the Feedback KPI (received ÷ total). */
function RatioBar({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct))
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: "#EEF0F4" }}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${w}%`, background: "linear-gradient(90deg, #1C9E72, #37B88C)" }}
      />
    </div>
  )
}

/** Section-card title with a small colored leading icon. */
function CardTitle({
  icon: Icon,
  color,
  className,
  children,
}: {
  icon: LucideIcon
  color: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`flex items-center gap-1.5 text-sm font-medium ${className ?? ""}`}
      style={{ color: NAVY_DEEP }}
    >
      <Icon className="size-[15px] shrink-0" style={{ color }} aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
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
  aiSummary,
  aiSummaryGeneratedAt,
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
  aiSummary: string | null
  aiSummaryGeneratedAt: string | null
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
    feedbackPct != null && feedbackPct < 60 ? RED : TEXT_PRIMARY

  const quarterlyDollars = selected.annualized_retainer / 4

  const days = selected.days_to_renewal
  const renewalValue = days == null ? "—" : days.toLocaleString()
  const renewalColor =
    days == null
      ? TEXT_PRIMARY
      : days < 30
        ? RED
        : days < 90
          ? AMBER
          : TEXT_PRIMARY
  const renewalHint =
    selected.latest_term_end == null
      ? "No active contract"
      : `Term ends ${formatLongDate(selected.latest_term_end)}`

  // Exact-on-hover for the abbreviated dollar values.
  const retainerExact =
    selected.annualized_retainer > 0
      ? formatCurrency(selected.annualized_retainer)
      : undefined
  const perMeetingExact =
    selected.dollars_per_meeting_ltm != null &&
    Number.isFinite(selected.dollars_per_meeting_ltm)
      ? formatCurrency(selected.dollars_per_meeting_ltm)
      : undefined

  type Tile = {
    label: string
    value: React.ReactNode
    hint: React.ReactNode
    valueColor?: string
    sparkline?: React.ReactNode
  }
  const tiles: Tile[] = [
    {
      label: "Meetings (LTM)",
      value: `${selected.ltm_meetings.toLocaleString()} / ${selected.lifetime_meetings.toLocaleString()}`,
      hint: <span style={{ color: deltaColor }}>{deltaText}</span>,
      sparkline: <Sparkline values={quarterly.map((q) => q.total)} color={NAVY_DEEP} />,
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
      sparkline: feedbackPct != null ? <RatioBar pct={feedbackPct} /> : undefined,
      hint: `${selected.ltm_feedback_collected.toLocaleString()} of ${selected.ltm_feedback_total_closed.toLocaleString()} closed`,
    },
    {
      label: "Annualized Retainer",
      value: <span title={retainerExact}>{formatCompactDollars(selected.annualized_retainer)}</span>,
      valueColor: MONEY_GREEN,
      hint:
        selected.annualized_retainer > 0
          ? `${formatCompactDollars(quarterlyDollars)}/quarter`
          : "No active contract",
    },
    {
      label: "$ per Meeting",
      value: <span title={perMeetingExact}>{formatCompactDollars(selected.dollars_per_meeting_ltm)}</span>,
      valueColor: MONEY_GREEN,
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
      { role: "Account Mgr", name: accountTeam.sales_lead_primary_name, color: "#1E2858", text: "#FFFFFF" },
      { role: "Secondary", name: accountTeam.secondary_manager_name, color: "#3D5599", text: "#FFFFFF" },
      { role: "Associate", name: accountTeam.associate_name, color: "#1C8C9C", text: "#FFFFFF" },
      { role: "Logistics", name: accountTeam.logistics_coordinator_name, color: "#4FC6BC", text: "#0A3B36" },
    ] as Array<{ role: string; name: string | null; color: string; text: string }>
  ).filter((m): m is { role: string; name: string; color: string; text: string } =>
    Boolean(m.name && m.name.trim()),
  )

  // ---------- Render ----------
  return (
    <>
      {/* Section 1: Floating masthead — badge, name, status, selector, team. */}
      <div className="mb-4">
        <EntityMasthead
          badge={monogram}
          name={selected.client_name}
          subtitle={subtitleParts.join(" · ")}
          status={statusPill}
          rightSlot={
            <MastheadSelector
              items={allClients.map((c) => ({
                value: c.account_id,
                label: c.client_name,
              }))}
              value={selected.account_id}
              onChange={goTo}
              onPrev={goPrev}
              onNext={goNext}
              ariaLabel="Select client"
            />
          }
        />
      </div>

      {/* Account Team + AI Summary — one combined floating card, directly below
          the masthead and above the KPIs. The team always shows when staffed; the
          AI summary (and the divider above it) appear only once one is generated.
          The card hides entirely when there's neither a team nor a summary. */}
      {(accountTeamMembers.length > 0 || (aiSummary && aiSummary.trim())) && (
        <div className={`mb-6 p-5 ${CARD_CLASS}`}>
          {/* Account Team — label + avatar + role/name groups (moved as-is). */}
          {accountTeamMembers.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span
                className="shrink-0 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: TEXT_MUTED }}
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
                  <span
                    className="flex items-center gap-2"
                    title={`${m.role} · ${m.name}`}
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold leading-none"
                      style={{ backgroundColor: m.color, color: m.text }}
                      aria-hidden="true"
                    >
                      {initialsOf(m.name)}
                    </span>
                    <span className="flex flex-col leading-tight">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {m.role}
                      </span>
                      <span className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>
                        {m.name}
                      </span>
                    </span>
                  </span>
                </React.Fragment>
              ))}
            </div>
          )}

          {/* AI Summary — only when generated. The 1px divider sits between team and
              summary; it's skipped when the team is absent so there's no leading rule. */}
          {aiSummary && aiSummary.trim() && (
            <>
              {accountTeamMembers.length > 0 && (
                <div
                  aria-hidden="true"
                  style={{
                    height: 1,
                    background: "#EEF0F4",
                    marginTop: 13,
                    marginBottom: 13,
                  }}
                />
              )}
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <CardTitle icon={Sparkles} color="#1C8C9C">
                  AI Summary
                </CardTitle>
                {aiSummaryGeneratedAt && (
                  <div className="shrink-0 text-xs text-muted-foreground">
                    Updated {formatLongDate(aiSummaryGeneratedAt)}
                  </div>
                )}
              </div>
              <p className="text-sm leading-relaxed" style={{ color: TEXT_PRIMARY }}>
                {aiSummary}
              </p>
            </>
          )}
        </div>
      )}

      {/* Section 2: 6 KPI cards — floating style */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
          <div className={`min-w-0 p-5 ${CARD_CLASS}`}>
            <div className="mb-3 flex items-baseline justify-between">
              <CardTitle icon={NotebookText} color="#0355A7">
                Most Recent Client Note
              </CardTitle>
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
                  style={{ backgroundColor: "#EEF2FB", color: "#2D4A8A" }}
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
        <div className={`min-w-0 p-5 ${CARD_CLASS}`}>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle icon={Clock} color="#1C8C9C">
            Recent Touchpoints
          </CardTitle>
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
                  const hasDescription =
                    t.description != null && t.description.trim() !== ""
                  return (
                    <Popover key={t.touchpoint_id}>
                      <PopoverTrigger
                        nativeButton={false}
                        openOnHover
                        delay={150}
                        closeDelay={150}
                        render={
                          <tr className="cursor-default border-b transition-colors last:border-b-0 hover:bg-accent/40 data-[popup-open]:bg-accent/40" />
                        }
                      >
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
                      </PopoverTrigger>
                      <PopoverContent
                        side="top"
                        align="start"
                        sideOffset={6}
                        className="w-auto max-w-md gap-0 p-0 text-left"
                      >
                        <div className="border-b px-3.5 py-2.5">
                          <div
                            className="text-sm font-semibold"
                            style={{ color: NAVY_DEEP }}
                          >
                            {t.subject ?? "Touchpoint"}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span>{formatLongDate(t.scheduled_start)}</span>
                            {t.touchpoint_type_label && (
                              <>
                                <span aria-hidden>·</span>
                                <span>{t.touchpoint_type_label}</span>
                              </>
                            )}
                            <span aria-hidden>·</span>
                            <span>{isOut ? "Outbound" : "Inbound"}</span>
                            {t.actual_duration_minutes != null && (
                              <>
                                <span aria-hidden>·</span>
                                <span>
                                  {t.actual_duration_minutes.toLocaleString()} min
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="max-h-[340px] overflow-y-auto px-3.5 py-3">
                          {hasDescription ? (
                            <p
                              className="whitespace-pre-wrap break-words text-sm leading-relaxed"
                              style={{ color: TEXT_PRIMARY }}
                            >
                              {t.description}
                            </p>
                          ) : (
                            <p className="text-sm italic text-muted-foreground">
                              No additional detail recorded.
                            </p>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
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
      <div className={`mb-3 p-5 ${CARD_CLASS}`}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <CardTitle icon={BarChart3} color="#0355A7">
              Meetings by Quarter
            </CardTitle>
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
      <div className={`mb-3 p-5 ${CARD_CLASS}`}>
        <div className="mb-3">
          <CardTitle icon={Building2} color="#1C8C9C">
            Top 20 Institutions Met
          </CardTitle>
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
        <div className={`p-5 ${CARD_CLASS}`}>
          <div className="mb-3">
            <CardTitle icon={Layers} color="#0355A7">
              Investor Reach Depth
            </CardTitle>
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
        <div className={`p-5 ${CARD_CLASS}`}>
          <div className="mb-3">
            <CardTitle icon={Users} color="#1C8C9C">
              Top Hosts (LTM)
            </CardTitle>
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

      {/* Section 8: Last 25 Meetings */}
      <div className={`p-5 ${CARD_CLASS}`}>
        <CardTitle icon={CalendarDays} color="#0355A7" className="mb-3">
          Last 25 Meetings
        </CardTitle>
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
                const meetingDate = safeParseDate(m.meeting_date)
                const isUpcoming =
                  meetingDate !== null && meetingDate.getTime() > Date.now()
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

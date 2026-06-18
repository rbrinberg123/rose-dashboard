"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight, Info, Users } from "lucide-react"
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ListTitleCard } from "@/components/page-masthead"
import { StatCard } from "@/components/stat-card"
import {
  MARKET_CAP_DONUT,
  MARKET_CAP_DONUT_FALLBACK,
  BAR_TRACK,
  BAR_FILLS,
} from "@/lib/gradients"
import {
  CARD_CLASS,
  MONEY_GREEN,
  NOTE_STATUS_PILL,
  NOTE_STATUS_PILL_FALLBACK,
  DAYS_LEFT_PILL,
} from "@/lib/design"
import { EXPIRY_KEY_BY_LABEL } from "@/lib/contract-expiry"
import { formatCurrency } from "@/lib/format"
import type { ClientStatisticsRow, ClientStatsBucketRow } from "@/lib/types"

function portfolioHref(
  param: "market_cap" | "region" | "sector" | "sales_lead" | "note_status" | "expiry",
  bucket: string,
): string {
  return `/portfolio?${param}=${encodeURIComponent(bucket)}`
}

const NAVY = "#1E2858"

// Status donut segment color = the saturated `fg` from the SHARED Portfolio status
// pill palette (lib/design.ts NOTE_STATUS_PILL), so the donut and the Portfolio
// Status pills are guaranteed identical (NB Stable & Strong share one green there).
// 'No Status' (no note on record) has no pill, so it uses this page's own no-data
// neutral — the same teal-gray as the 'Unknown'/'Unassigned' markers elsewhere here.
const STATUS_NO_DATA_FILL = "#C8DEDB"
function statusFill(bucket: string): string {
  if (bucket === "No Status") return STATUS_NO_DATA_FILL
  return (NOTE_STATUS_PILL[bucket] ?? NOTE_STATUS_PILL_FALLBACK).fg
}

// Days-left bar fill = the saturated `fg` from the SHARED Days-Left pill palette
// (lib/design.ts DAYS_LEFT_PILL): red < 30, amber 30-89, green >= 90 (one green for
// all longer buckets, exactly as the pills), gray for Expired / none. Keyed off the
// bucket label so it tracks the SQL view's buckets.
function daysLeftFill(bucket: string): string {
  if (bucket === "Expired / none") return DAYS_LEFT_PILL.gray.fg
  if (bucket === "< 30 days") return DAYS_LEFT_PILL.red.fg
  if (bucket === "30-89 days") return DAYS_LEFT_PILL.amber.fg
  return DAYS_LEFT_PILL.green.fg
}

// Clients-by-Manager reads best at 1/3 width as a short ranked list: show the top
// managers as bars and roll the long tail into a muted footer line (mirrors the
// Sector chart's SECTOR_TOP_N treatment on this same page).
const MANAGER_TOP_N = 6

// Rank-based fade for the manager bars: the manager with the most clients gets
// the deepest navy, fading to light teal down the list. Interpolated across the
// actual manager count so every bar stays distinct even when the list runs
// long (matches the rankColors treatment used on Institution Detail).
const RANK_FROM = [30, 40, 88] as const // #1E2858 navy
const RANK_TO = [196, 232, 232] as const // #C4E8E8 light teal

function rankColor(rank: number, total: number): string {
  const t = total <= 1 ? 0 : rank / (total - 1)
  const ch = (i: number) => Math.round(RANK_FROM[i] + (RANK_TO[i] - RANK_FROM[i]) * t)
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`
}

// Muted neutral fill for the non-clickable "Unassigned" bar (matches the
// 'Unknown' donut neutral on this page).
const UNASSIGNED_FILL = "#C8DEDB"

/** Donut slice color for a market-cap bucket (navy→teal, larger caps darker). */
function marketCapColor(bucket: string): string {
  return MARKET_CAP_DONUT[bucket] ?? MARKET_CAP_DONUT_FALLBACK
}

/**
 * "$19.8M" / "$188.7K" — abbreviated for display. The exact figure is shown in
 * a title tooltip on hover. Computed from the real number, not hardcoded.
 */
function compactUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return formatCurrency(value)
}

const SECTOR_TOP_N = 6

export function ClientStatisticsView({
  row,
  marketCap,
  region,
  sector,
  manager,
  status,
  daysLeft,
}: {
  row: ClientStatisticsRow
  marketCap: ClientStatsBucketRow[]
  region: ClientStatsBucketRow[]
  sector: ClientStatsBucketRow[]
  manager: ClientStatsBucketRow[]
  status: ClientStatsBucketRow[]
  daysLeft: ClientStatsBucketRow[]
}) {
  const router = useRouter()
  const kpis = [
    {
      label: "Active Accounts",
      value: row.active_account_count.toLocaleString(),
      exact: undefined as string | undefined,
      color: undefined as string | undefined,
      hint: "Active records in CRM",
    },
    {
      label: "Annualized Retainer Revenue",
      value: compactUsd(row.annualized_retainer_revenue),
      exact: formatCurrency(row.annualized_retainer_revenue),
      color: MONEY_GREEN,
      hint: "Quarterly retainer × 4, active contracts",
    },
    {
      label: "Avg Annualized Retainer / Account",
      value: compactUsd(row.avg_annualized_retainer),
      exact: formatCurrency(row.avg_annualized_retainer),
      color: MONEY_GREEN,
      hint: "Per active account",
    },
  ]

  const marketCapTotal = marketCap.reduce((s, r) => s + r.count, 0)
  const regionTotal = region.reduce((s, r) => s + r.count, 0)

  // Sector: count desc, Unknown last; show the top SECTOR_TOP_N as full rows
  // and roll the long tail into a single muted footer line below the rows.
  const sortedSector = [...sector].sort((a, b) => {
    const aUnknown = a.bucket === "Unknown"
    const bUnknown = b.bucket === "Unknown"
    if (aUnknown !== bUnknown) return aUnknown ? 1 : -1
    return b.count - a.count
  })
  const sectorTop = sortedSector.slice(0, SECTOR_TOP_N)
  const sectorRest = sortedSector.slice(SECTOR_TOP_N)
  const sectorRestCount = sectorRest.reduce((s, r) => s + r.count, 0)
  const sectorTotal = sortedSector.reduce((s, r) => s + r.count, 0)

  // Manager: count desc, 'Unassigned' always last. The view already sorts this
  // way, but re-sort defensively so the rank colors track display order. Bar
  // width is scaled to the largest manager (managerMax) for visual ranking;
  // the % shown is share of all active clients (sums to 100%).
  const sortedManager = [...manager].sort((a, b) => {
    const aUnassigned = a.bucket === "Unassigned"
    const bUnassigned = b.bucket === "Unassigned"
    if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1
    return b.count - a.count
  })
  const managerTotal = sortedManager.reduce((s, r) => s + r.count, 0)
  const managerMax = sortedManager.reduce((m, r) => Math.max(m, r.count), 0)
  // At 1/3 width, show only the top managers as bars; roll the rest into a footer.
  const managerTop = sortedManager.slice(0, MANAGER_TOP_N)
  const managerRest = sortedManager.slice(MANAGER_TOP_N)
  const managerRestCount = managerRest.reduce((s, r) => s + r.count, 0)

  // Status donut + days-left bars. Both views already sum to active clients (the
  // null buckets — 'No Status' / 'Expired / none' — are explicit rows), so the
  // totals shown reconcile to active_account_count without dropping anyone.
  const statusTotal = status.reduce((s, r) => s + r.count, 0)
  const daysLeftTotal = daysLeft.reduce((s, r) => s + r.count, 0)
  const daysLeftMax = daysLeft.reduce((m, r) => Math.max(m, r.count), 0)

  return (
    <>
      {/* Floating list-title card — title + subtitle only */}
      <div className="mb-4">
        <ListTitleCard
          title="Client Statistics"
          subtitle="Top-line numbers across the client book"
        />
      </div>

      {/* KPI cards below the band, as floating white cards */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((k) => (
          <StatCard
            key={k.label}
            floating
            label={k.label}
            value={<span title={k.exact}>{k.value}</span>}
            valueColor={k.color}
            valueSize={30}
            hint={k.hint}
          />
        ))}
      </div>

      <div className="my-5 flex items-center gap-3">
        <span
          className="shrink-0 text-base font-medium"
          style={{ color: NAVY }}
        >
          Distribution of Client Mix
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card size="sm" className={`relative !border-0 !ring-0 ${CARD_CLASS}`}>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium" style={{ color: NAVY }}>
              Clients by Market Cap
            </CardTitle>
            <CardDescription className="text-xs">
              Share of active accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={marketCap}
                    dataKey="count"
                    nameKey="bucket"
                    cx="50%"
                    cy="50%"
                    innerRadius={54}
                    outerRadius={70}
                    onClick={(_, index) => {
                      const bucket = marketCap[index]?.bucket
                      if (bucket && bucket !== "Unknown") {
                        router.push(portfolioHref("market_cap", bucket))
                      }
                    }}
                  >
                    {marketCap.map((m, i) => (
                      <Cell
                        key={i}
                        fill={marketCapColor(m.bucket)}
                        style={{ cursor: m.bucket === "Unknown" ? "default" : "pointer" }}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    formatter={(v) => Number(v).toLocaleString()}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div
                  className="text-2xl font-semibold leading-none tabular-nums"
                  style={{ color: NAVY }}
                >
                  {marketCapTotal.toLocaleString()}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">accounts</div>
              </div>
            </div>
            <ul className="mt-3 space-y-1">
              {marketCap.map((m) => {
                const pct =
                  marketCapTotal > 0
                    ? Math.round((m.count / marketCapTotal) * 100)
                    : 0
                const inner = (
                  <>
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: marketCapColor(m.bucket) }}
                      aria-hidden="true"
                    />
                    <span
                      className="flex-1 truncate"
                      style={{ color: NAVY }}
                    >
                      {m.bucket}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {m.count} · {pct}%
                    </span>
                  </>
                )
                return (
                  <li key={m.bucket}>
                    {m.bucket === "Unknown" ? (
                      <div className="flex items-center gap-2 rounded-sm px-1 py-0.5 text-xs">
                        {inner}
                      </div>
                    ) : (
                      <Link
                        href={portfolioHref("market_cap", m.bucket)}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-xs hover:bg-slate-100"
                      >
                        {inner}
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>

        <Card size="sm" className={`relative !border-0 !ring-0 ${CARD_CLASS}`}>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium" style={{ color: NAVY }}>
              Clients by Region
            </CardTitle>
            <CardDescription className="text-xs">
              Active accounts by region
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {region.map((r) => {
                const pct =
                  regionTotal > 0
                    ? Math.round((r.count / regionTotal) * 100)
                    : 0
                return (
                  <li key={r.bucket}>
                    <Link
                      href={portfolioHref("region", r.bucket)}
                      className="flex cursor-pointer flex-col gap-1.5 rounded-sm px-1 py-0.5 hover:bg-slate-100"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium" style={{ color: NAVY }}>
                          {r.bucket}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {r.count} ({pct}%)
                        </span>
                      </div>
                      <div
                        className="h-[7px] w-full overflow-hidden rounded-full"
                        style={{ backgroundColor: BAR_TRACK }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background: BAR_FILLS.region,
                          }}
                        />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>

        <Card size="sm" className={`relative !border-0 !ring-0 ${CARD_CLASS}`}>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium" style={{ color: NAVY }}>
              Clients by Sector
            </CardTitle>
            <CardDescription className="text-xs">
              Active accounts by sector
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {sectorTop.map((s) => {
                const pct =
                  sectorTotal > 0
                    ? Math.round((s.count / sectorTotal) * 100)
                    : 0
                const inner = (
                  <>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className="truncate font-medium"
                        style={{ color: NAVY }}
                      >
                        {s.bucket}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {s.count} ({pct}%)
                      </span>
                    </div>
                    <div
                      className="h-[7px] w-full overflow-hidden rounded-full"
                      style={{ backgroundColor: BAR_TRACK }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: BAR_FILLS.sector,
                        }}
                      />
                    </div>
                  </>
                )
                return (
                  <li key={s.bucket}>
                    {s.bucket === "Unknown" ? (
                      <div className="flex flex-col gap-1.5 rounded-sm px-1 py-0.5">
                        {inner}
                      </div>
                    ) : (
                      <Link
                        href={portfolioHref("sector", s.bucket)}
                        className="flex cursor-pointer flex-col gap-1.5 rounded-sm px-1 py-0.5 hover:bg-slate-100"
                      >
                        {inner}
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
            {sectorRest.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                + {sectorRest.length} more sectors ({sectorRestCount} accounts)
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="my-5 flex items-center gap-3">
        <span
          className="shrink-0 text-base font-medium"
          style={{ color: NAVY }}
        >
          Relationship &amp; Contract Health
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Chart 1 — Clients by Manager (top managers, ranked) */}
        <Card size="sm" className={`relative !border-0 !ring-0 ${CARD_CLASS}`}>
          <CardHeader className="pb-1">
            <CardTitle
              className="flex items-center gap-2 text-sm font-medium"
              style={{ color: NAVY }}
            >
              <Users className="size-4 shrink-0" aria-hidden="true" />
              Clients by Manager
            </CardTitle>
            <CardDescription className="text-xs">
              Active clients by Account Manager · click a row to view them in Portfolio
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {managerTop.map((m, i) => {
                const pct =
                  managerTotal > 0 ? Math.round((m.count / managerTotal) * 100) : 0
                const barWidth =
                  managerMax > 0 ? Math.round((m.count / managerMax) * 100) : 0
                const isUnassigned = m.bucket === "Unassigned"
                const fill = isUnassigned ? UNASSIGNED_FILL : rankColor(i, managerTop.length)
                const inner = (
                  <>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium" style={{ color: NAVY }}>
                        {m.bucket}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="tabular-nums text-muted-foreground">
                          {m.count} · {pct}%
                        </span>
                        {!isUnassigned && (
                          <ChevronRight
                            className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                    </div>
                    <div
                      className="h-[7px] w-full overflow-hidden rounded-full"
                      style={{ backgroundColor: BAR_TRACK }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${barWidth}%`, backgroundColor: fill }}
                      />
                    </div>
                  </>
                )
                return (
                  <li key={m.bucket}>
                    {isUnassigned ? (
                      <div className="flex flex-col gap-1.5 rounded-sm px-1 py-0.5">
                        {inner}
                      </div>
                    ) : (
                      <Link
                        href={portfolioHref("sales_lead", m.bucket)}
                        className="group flex cursor-pointer flex-col gap-1.5 rounded-sm px-1 py-0.5 hover:bg-slate-100"
                      >
                        {inner}
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
            {managerRest.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                + {managerRest.length} more managers ({managerRestCount} clients)
              </p>
            )}
          </CardContent>
        </Card>

        {/* Chart 2 — Clients by Status (donut) */}
        <Card size="sm" className={`relative !border-0 !ring-0 ${CARD_CLASS}`}>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium" style={{ color: NAVY }}>
              Clients by Status
            </CardTitle>
            <CardDescription className="text-xs">
              Latest client-note status flag
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={status}
                    dataKey="count"
                    nameKey="bucket"
                    cx="50%"
                    cy="50%"
                    innerRadius={54}
                    outerRadius={70}
                    onClick={(_, index) => {
                      const bucket = status[index]?.bucket
                      if (bucket === "No Status") {
                        router.push(portfolioHref("note_status", "__none__"))
                      } else if (bucket) {
                        router.push(portfolioHref("note_status", bucket))
                      }
                    }}
                  >
                    {status.map((s, i) => (
                      <Cell
                        key={i}
                        fill={statusFill(s.bucket)}
                        style={{ cursor: "pointer" }}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    formatter={(v) => Number(v).toLocaleString()}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div
                  className="text-2xl font-semibold leading-none tabular-nums"
                  style={{ color: NAVY }}
                >
                  {statusTotal.toLocaleString()}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">clients</div>
              </div>
            </div>
            <ul className="mt-3 space-y-1">
              {status.map((s) => {
                const pct =
                  statusTotal > 0 ? Math.round((s.count / statusTotal) * 100) : 0
                const href =
                  s.bucket === "No Status"
                    ? portfolioHref("note_status", "__none__")
                    : portfolioHref("note_status", s.bucket)
                return (
                  <li key={s.bucket}>
                    <Link
                      href={href}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-xs hover:bg-slate-100"
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-sm"
                        style={{ backgroundColor: statusFill(s.bucket) }}
                        aria-hidden="true"
                      />
                      <span className="flex-1 truncate" style={{ color: NAVY }}>
                        {s.bucket}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {s.count} · {pct}%
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>

        {/* Chart 3 — Clients by Days Left on Contract (grouped bars) */}
        <Card size="sm" className={`relative !border-0 !ring-0 ${CARD_CLASS}`}>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium" style={{ color: NAVY }}>
              Clients by Days Left on Contract
            </CardTitle>
            <CardDescription className="text-xs">
              Active clients by time to expiry · click a row to view them in Portfolio
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {daysLeft.map((d) => {
                const pct =
                  daysLeftTotal > 0 ? Math.round((d.count / daysLeftTotal) * 100) : 0
                const barWidth =
                  daysLeftMax > 0 ? Math.round((d.count / daysLeftMax) * 100) : 0
                const fill = daysLeftFill(d.bucket)
                const key = EXPIRY_KEY_BY_LABEL[d.bucket]
                const inner = (
                  <>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium" style={{ color: NAVY }}>
                        {d.bucket}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="tabular-nums text-muted-foreground">
                          {d.count} · {pct}%
                        </span>
                        <ChevronRight
                          className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                          aria-hidden="true"
                        />
                      </span>
                    </div>
                    <div
                      className="h-[7px] w-full overflow-hidden rounded-full"
                      style={{ backgroundColor: BAR_TRACK }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${barWidth}%`, backgroundColor: fill }}
                      />
                    </div>
                  </>
                )
                return (
                  <li key={d.bucket}>
                    <Link
                      href={portfolioHref("expiry", key)}
                      className="group flex cursor-pointer flex-col gap-1.5 rounded-sm px-1 py-0.5 hover:bg-slate-100"
                    >
                      {inner}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Page-footer methodology note — quiet muted footnote below all charts. */}
      <p
        className="mt-6 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap text-[11px] italic"
        style={{ color: "#9AA1AD" }}
      >
        <Info className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Figures are based on active clients in the CRM. Annualized retainer revenue may slightly overstate the true run-rate (not all in-contract clients are renewing).
        </span>
      </p>
    </>
  )
}

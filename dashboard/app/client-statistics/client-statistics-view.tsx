"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Info } from "lucide-react"
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
import { CARD_CLASS, MONEY_GREEN } from "@/lib/design"
import { formatCurrency } from "@/lib/format"
import type { ClientStatisticsRow, ClientStatsBucketRow } from "@/lib/types"

function portfolioHref(param: "market_cap" | "region" | "sector", bucket: string): string {
  return `/portfolio?${param}=${encodeURIComponent(bucket)}`
}

const NAVY = "#1E2858"

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
}: {
  row: ClientStatisticsRow
  marketCap: ClientStatsBucketRow[]
  region: ClientStatsBucketRow[]
  sector: ClientStatsBucketRow[]
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

      {/* Understated single-line methodology note — muted, italic, no wrap. */}
      <p
        className="mt-3 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap text-[11px] italic"
        style={{ color: "#9AA1AD" }}
      >
        <Info className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Figures are based on active clients in the CRM. Annualized retainer revenue may slightly overstate the true run-rate (not all in-contract clients are renewing).
        </span>
      </p>

      <div className="my-6 flex items-center gap-3">
        <span
          className="shrink-0 text-base font-medium"
          style={{ color: NAVY }}
        >
          Distribution of Client Mix
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className={`relative !border-0 !ring-0 ${CARD_CLASS}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium" style={{ color: NAVY }}>
              Clients by Market Cap
            </CardTitle>
            <CardDescription className="text-xs">
              Share of active accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={marketCap}
                    dataKey="count"
                    nameKey="bucket"
                    cx="50%"
                    cy="50%"
                    innerRadius={69}
                    outerRadius={88}
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
                  className="text-3xl font-semibold leading-none tabular-nums"
                  style={{ color: NAVY }}
                >
                  {marketCapTotal.toLocaleString()}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">accounts</div>
              </div>
            </div>
            <ul className="mt-4 space-y-1">
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
                      <div className="flex items-center gap-2 rounded-sm px-1 py-1 text-xs">
                        {inner}
                      </div>
                    ) : (
                      <Link
                        href={portfolioHref("market_cap", m.bucket)}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-xs hover:bg-slate-100"
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

        <Card className={`relative !border-0 !ring-0 ${CARD_CLASS}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium" style={{ color: NAVY }}>
              Clients by Region
            </CardTitle>
            <CardDescription className="text-xs">
              Active accounts by region
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {region.map((r) => {
                const pct =
                  regionTotal > 0
                    ? Math.round((r.count / regionTotal) * 100)
                    : 0
                return (
                  <li key={r.bucket}>
                    <Link
                      href={portfolioHref("region", r.bucket)}
                      className="flex cursor-pointer flex-col gap-1.5 rounded-sm px-1 py-1 hover:bg-slate-100"
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

        <Card className={`relative !border-0 !ring-0 ${CARD_CLASS}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium" style={{ color: NAVY }}>
              Clients by Sector
            </CardTitle>
            <CardDescription className="text-xs">
              Active accounts by sector
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
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
                      <div className="flex flex-col gap-1.5 rounded-sm px-1 py-1">
                        {inner}
                      </div>
                    ) : (
                      <Link
                        href={portfolioHref("sector", s.bucket)}
                        className="flex cursor-pointer flex-col gap-1.5 rounded-sm px-1 py-1 hover:bg-slate-100"
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
    </>
  )
}

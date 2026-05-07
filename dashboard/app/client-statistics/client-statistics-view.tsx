"use client"

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"
import type { ClientStatisticsRow, ClientStatsBucketRow } from "@/lib/types"

const PIE_COLORS = [
  "#2563eb", // blue-600
  "#16a34a", // green-600
  "#ca8a04", // yellow-600
  "#ea580c", // orange-600
  "#dc2626", // red-600
  "#94a3b8", // slate-400
]

const SECTOR_TOP_N = 8

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
  const kpis = [
    {
      label: "Active Accounts",
      value: row.active_account_count.toLocaleString(),
      hint: "Active records in CRM",
    },
    {
      label: "Annualized Retainer Revenue",
      value: formatCurrency(row.annualized_retainer_revenue),
      hint: "Quarterly retainer × 4, active contracts",
    },
    {
      label: "Avg Annualized Retainer / Account",
      value: formatCurrency(row.avg_annualized_retainer),
      hint: "Per active account",
    },
  ]

  const regionTotal = region.reduce((s, r) => s + r.count, 0)

  // Sector: count desc, Unknown last; collapse the long tail into "Other (N)"
  // so the card height stays stable regardless of how many sectors there are.
  const sortedSector = [...sector].sort((a, b) => {
    const aUnknown = a.bucket === "Unknown"
    const bUnknown = b.bucket === "Unknown"
    if (aUnknown !== bUnknown) return aUnknown ? 1 : -1
    return b.count - a.count
  })
  const sectorTop = sortedSector.slice(0, SECTOR_TOP_N)
  const sectorRest = sortedSector.slice(SECTOR_TOP_N)
  const sectorDisplay: ClientStatsBucketRow[] =
    sectorRest.length > 0
      ? [
          ...sectorTop,
          {
            bucket: `Other (${sectorRest.length})`,
            count: sectorRest.reduce((s, r) => s + r.count, 0),
          },
        ]
      : sectorTop
  const sectorTotal = sectorDisplay.reduce((s, r) => s + r.count, 0)

  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardDescription>{k.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{k.value}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">{k.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Clients by Market Cap</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={marketCap}
                    dataKey="count"
                    nameKey="bucket"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label={({ name, percent }) =>
                      `${name} ${Math.round(((percent ?? 0) as number) * 100)}%`
                    }
                  >
                    {marketCap.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
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
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Clients by Region</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={region}
                  layout="vertical"
                  margin={{ top: 8, right: 56, bottom: 8, left: 8 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="bucket"
                    width={70}
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    formatter={(v) => Number(v).toLocaleString()}
                  />
                  <Bar dataKey="count" fill="var(--primary)" radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="count"
                      position="right"
                      formatter={(value) => {
			const numValue = Number(value) || 0                        
			const pct = regionTotal > 0 ? Math.round((numValue / regionTotal) * 100) : 0
                        return `${numValue} (${pct}%)`
                      }}
                      style={{ fontSize: 12, fill: "var(--foreground)" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Clients by Sector</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sectorDisplay}
                  layout="vertical"
                  margin={{ top: 8, right: 56, bottom: 8, left: 8 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="bucket"
                    width={120}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    formatter={(v) => Number(v).toLocaleString()}
                  />
                  <Bar dataKey="count" fill="var(--primary)" radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="count"
                      position="right"
                      formatter={(value: number) => {
                        const pct = sectorTotal > 0 ? Math.round((value / sectorTotal) * 100) : 0
                        return `${value} (${pct}%)`
                      }}
                      style={{ fontSize: 12, fill: "var(--foreground)" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

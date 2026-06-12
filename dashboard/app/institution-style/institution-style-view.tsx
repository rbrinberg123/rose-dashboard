"use client"

import * as React from "react"
import Link from "next/link"
import { ListTitleCard } from "@/components/page-masthead"
import { CARD_CLASS } from "@/lib/design"
import type {
  ActiveClientOption,
  InstitutionStyleMeetingRow,
} from "@/lib/types"

// Brand palette
const NAVY_DEEP = "#1E2858"
// Match-% bar thresholds
const BAR_TEAL = "#1D9E75" // >= 50%
const BAR_BLUE = "#378ADD" // >= 25%
const BAR_GRAY = "#888780" // below 25%

const MARKET_CAP_BUCKETS = ["Mega", "Large", "Mid", "Small", "Micro", "Unknown"]
const REGION_BUCKETS = ["Americas", "EMEA", "APAC", "Unknown"]

const MIN_MEETING_OPTIONS = [1, 2, 3, 5, 10, 20, 40]

type WindowMode = "ltm" | "lifetime"

// The three style dimensions, in the fixed order used for breakdown columns.
const STYLE_DIMS = [
  { key: "market_cap", label: "Market cap", field: "market_cap_bucket" },
  { key: "sector", label: "Sector", field: "sector_bucket" },
  { key: "region", label: "Region", field: "region_bucket" },
] as const

type DimKey = (typeof STYLE_DIMS)[number]["key"]

type RankedInstitution = {
  institution_id: string | null
  institution_name: string
  total: number
  match: number
  matchPct: number
  // In the filtered view: distinct count of matching clients. In the no-filter
  // browse view: distinct count of all clients the institution met in window.
  distinctClients: number
  // Marginal % of window meetings with any selected client (OR group).
  // Undefined when no clients are selected.
  clientMarginal?: number
  // Marginal % per dimension, keyed by dim key (only filled for active dims).
  marginals: Partial<Record<DimKey, number>>
}

function barColor(pct: number): string {
  if (pct >= 50) return BAR_TEAL
  if (pct >= 25) return BAR_BLUE
  return BAR_GRAY
}

// Reads a breakdown column's % off a ranked row by its column key.
function breakdownPct(r: RankedInstitution, key: string): number {
  if (key === "client") return r.clientMarginal ?? 0
  return r.marginals[key as DimKey] ?? 0
}

const selectClass =
  "h-9 rounded-md border border-border bg-card px-2 text-sm"

export function InstitutionStyleView({
  meetings,
  clients,
}: {
  meetings: InstitutionStyleMeetingRow[]
  clients: ActiveClientOption[]
}) {
  const [selectedClients, setSelectedClients] = React.useState<Set<string>>(
    new Set(),
  )
  const [marketCap, setMarketCap] = React.useState<string>("Any")
  const [sector, setSector] = React.useState<string>("Any")
  const [region, setRegion] = React.useState<string>("Any")
  const [windowMode, setWindowMode] = React.useState<WindowMode>("ltm")
  const [minMeetings, setMinMeetings] = React.useState<number>(10)

  // Client picker UI state
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [clientSearch, setClientSearch] = React.useState("")

  // Sector buckets are dynamic — derive the dropdown options from the data,
  // sorted alphabetically with 'Unknown' last.
  const sectorBuckets = React.useMemo(() => {
    const s = new Set<string>()
    for (const m of meetings) s.add(m.sector_bucket)
    const arr = Array.from(s)
    arr.sort((a, b) => {
      if (a === "Unknown") return 1
      if (b === "Unknown") return -1
      return a.localeCompare(b)
    })
    return arr
  }, [meetings])

  const filteredClients = React.useMemo(() => {
    const term = clientSearch.trim().toLowerCase()
    if (!term) return clients
    return clients.filter((c) => c.name.toLowerCase().includes(term))
  }, [clients, clientSearch])

  // Which style dimensions are active (not 'Any'), in fixed order.
  const activeDims = React.useMemo(() => {
    const values: Record<DimKey, string> = {
      market_cap: marketCap,
      sector,
      region,
    }
    return STYLE_DIMS.filter((d) => values[d.key] !== "Any").map((d) => ({
      ...d,
      value: values[d.key],
    }))
  }, [marketCap, sector, region])

  const hasClientFilter = selectedClients.size > 0
  const anySelected = hasClientFilter || activeDims.length > 0

  // Breakdown columns shown in the filtered view, in order: Client % first
  // (when clients are selected), then each active style selector.
  const breakdownCols = React.useMemo(() => {
    const cols: { key: string; header: string }[] = []
    if (hasClientFilter) cols.push({ key: "client", header: "Client %" })
    for (const d of activeDims) cols.push({ key: d.key, header: d.value })
    return cols
  }, [hasClientFilter, activeDims])

  const ranked = React.useMemo<RankedInstitution[]>(() => {
    type Acc = {
      institution_id: string | null
      institution_name: string
      total: number
      match: number
      matchClients: Set<string>
      allClients: Set<string>
      clientMarg: number
      marg: Record<DimKey, number>
    }
    const map = new Map<string, Acc>()

    for (const m of meetings) {
      if (windowMode === "ltm" && !m.is_ltm) continue

      let acc = map.get(m.institution_name)
      if (!acc) {
        acc = {
          institution_id: m.institution_id,
          institution_name: m.institution_name,
          total: 0,
          match: 0,
          matchClients: new Set<string>(),
          allClients: new Set<string>(),
          clientMarg: 0,
          marg: { market_cap: 0, sector: 0, region: 0 },
        }
        map.set(m.institution_name, acc)
      }

      acc.total++
      acc.allClients.add(m.client_account_id)

      const clientOk =
        !hasClientFilter || selectedClients.has(m.client_account_id)
      const mcOk = marketCap === "Any" || m.market_cap_bucket === marketCap
      const secOk = sector === "Any" || m.sector_bucket === sector
      const regOk = region === "Any" || m.region_bucket === region

      if (clientOk && mcOk && secOk && regOk) {
        acc.match++
        acc.matchClients.add(m.client_account_id)
      }

      // Marginal share per active selector (that selector alone, ignoring the
      // other selectors). The client group counts a meeting if its client is
      // in the selected OR-set.
      if (hasClientFilter && selectedClients.has(m.client_account_id))
        acc.clientMarg++
      if (marketCap !== "Any" && m.market_cap_bucket === marketCap)
        acc.marg.market_cap++
      if (sector !== "Any" && m.sector_bucket === sector) acc.marg.sector++
      if (region !== "Any" && m.region_bucket === region) acc.marg.region++
    }

    const rows: RankedInstitution[] = []
    for (const acc of map.values()) {
      if (acc.total < minMeetings) continue
      const matchPct = (acc.match / acc.total) * 100
      const marginals: Partial<Record<DimKey, number>> = {}
      for (const d of activeDims) {
        marginals[d.key] = (acc.marg[d.key] / acc.total) * 100
      }
      rows.push({
        institution_id: acc.institution_id,
        institution_name: acc.institution_name,
        total: acc.total,
        match: acc.match,
        matchPct,
        distinctClients: anySelected
          ? acc.matchClients.size
          : acc.allClients.size,
        clientMarginal: hasClientFilter
          ? (acc.clientMarg / acc.total) * 100
          : undefined,
        marginals,
      })
    }

    if (anySelected) {
      // Filtered: rank by match %, then match count.
      rows.sort((a, b) => {
        if (b.matchPct !== a.matchPct) return b.matchPct - a.matchPct
        return b.match - a.match
      })
    } else {
      // No-filter browse: rank by total meeting volume, then name.
      rows.sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total
        return a.institution_name.localeCompare(b.institution_name)
      })
    }

    return rows
  }, [
    meetings,
    anySelected,
    windowMode,
    hasClientFilter,
    selectedClients,
    marketCap,
    sector,
    region,
    minMeetings,
    activeDims,
  ])

  // Build the human-readable criteria summary.
  const windowLabel = windowMode === "ltm" ? "Last 12 months" : "Lifetime"
  const criteriaParts: string[] = []
  if (hasClientFilter) {
    criteriaParts.push(
      selectedClients.size === 1
        ? "1 client"
        : `${selectedClients.size} clients`,
    )
  }
  if (marketCap !== "Any") criteriaParts.push(`Market cap: ${marketCap}`)
  if (sector !== "Any") criteriaParts.push(`Sector: ${sector}`)
  if (region !== "Any") criteriaParts.push(`Region: ${region}`)

  // Plain-language criteria for the Match % definition line, e.g.
  // "Large-cap + Technology + ADT / Datadog". Style values first (cap, then
  // sector, then region), then the selected-client OR-group joined with " / ".
  const windowPhrase = windowMode === "ltm" ? "last-12-month" : "lifetime"
  const activeGroupCount = activeDims.length + (hasClientFilter ? 1 : 0)
  const criteriaProseParts: string[] = []
  if (marketCap !== "Any") criteriaProseParts.push(`${marketCap}-cap`)
  if (sector !== "Any") criteriaProseParts.push(sector)
  if (region !== "Any") criteriaProseParts.push(region)
  if (hasClientFilter) {
    const names = clients
      .filter((c) => selectedClients.has(c.account_id))
      .map((c) => c.name)
    if (names.length) criteriaProseParts.push(names.join(" / "))
  }
  const criteriaProse = criteriaProseParts.join(" + ")

  const toggleClient = (id: string) => {
    setSelectedClients((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clientFieldLabel =
    selectedClients.size === 0
      ? "All clients"
      : `${selectedClients.size} client${selectedClients.size === 1 ? "" : "s"} selected`

  return (
    <>
      {/* Floating list-title card */}
      <div className="mb-4">
        <ListTitleCard
          title="Institution Style/Set Finder"
          subtitle="Rank institutions by the share of their meetings spent with clients of a chosen style or set."
        />
      </div>

      {/* Controls */}
      <div className={`mb-4 p-4 ${CARD_CLASS}`}>
        <div className="flex flex-wrap items-end gap-4">
          {/* Clients multi-select */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Clients
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen((o) => !o)}
                className="flex h-9 w-64 items-center justify-between rounded-md border border-border bg-card px-2 text-sm"
              >
                <span className={selectedClients.size === 0 ? "text-muted-foreground" : ""}>
                  {clientFieldLabel}
                </span>
                <span className="text-muted-foreground">▾</span>
              </button>
              {pickerOpen && (
                <>
                  {/* click-outside backdrop */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setPickerOpen(false)}
                  />
                  <div className="absolute left-0 top-10 z-20 w-72 rounded-md border border-border bg-card shadow-lg">
                    <div className="flex items-center gap-2 border-b p-2">
                      <input
                        type="text"
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        placeholder="Search clients..."
                        className="h-8 flex-1 rounded-md border border-border bg-white px-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#1E2858]"
                        aria-label="Search clients"
                      />
                      <button
                        type="button"
                        onClick={() => setSelectedClients(new Set())}
                        className="rounded-md border border-border bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="max-h-64 overflow-y-auto p-1">
                      {filteredClients.length === 0 ? (
                        <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                          No clients match.
                        </div>
                      ) : (
                        filteredClients.map((c) => (
                          <label
                            key={c.account_id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={selectedClients.has(c.account_id)}
                              onChange={() => toggleClient(c.account_id)}
                            />
                            <span className="truncate">{c.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Market cap */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Market cap
            </label>
            <select
              value={marketCap}
              onChange={(e) => setMarketCap(e.target.value)}
              className={selectClass}
              aria-label="Market cap"
            >
              <option value="Any">Any</option>
              {MARKET_CAP_BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {/* Sector */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Sector
            </label>
            <select
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className={selectClass}
              aria-label="Sector"
            >
              <option value="Any">Any</option>
              {sectorBuckets.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {/* Region */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Region
            </label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className={selectClass}
              aria-label="Region"
            >
              <option value="Any">Any</option>
              {REGION_BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {/* Window toggle */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Window
            </label>
            <div className="flex h-9 items-center rounded-md border border-border bg-card p-0.5">
              {(
                [
                  { key: "ltm", label: "Last 12 months" },
                  { key: "lifetime", label: "Lifetime" },
                ] as const
              ).map((opt) => {
                const active = windowMode === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setWindowMode(opt.key)}
                    className={
                      "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
                      (active
                        ? "bg-[#1E2858] text-white"
                        : "text-foreground hover:bg-slate-50")
                    }
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Min meetings */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Min meetings
            </label>
            <select
              value={minMeetings}
              onChange={(e) => setMinMeetings(Number(e.target.value))}
              className={selectClass}
              aria-label="Minimum meetings"
            >
              {MIN_MEETING_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary line */}
      <div className="mb-3 text-sm text-muted-foreground">
        {anySelected ? (
          <>
            {ranked.length.toLocaleString()} institution
            {ranked.length === 1 ? "" : "s"} · {windowLabel} · ≥{minMeetings}{" "}
            meetings
            {criteriaParts.length > 0 ? ` · ${criteriaParts.join(" · ")}` : ""}
          </>
        ) : (
          <>
            All institutions by meeting volume · {windowLabel} · min{" "}
            {minMeetings} · {ranked.length.toLocaleString()} institution
            {ranked.length === 1 ? "" : "s"}
            <span className="ml-1">
              — add a client or style filter to rank by match %.
            </span>
          </>
        )}
      </div>

      {/* Match % definition */}
      <div className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
        {anySelected ? (
          <>
            Match % = share of an institution&apos;s {windowPhrase} meetings that
            were with {criteriaProse} clients.
            {activeGroupCount > 1 ? (
              <>
                {" "}
                Multiple filters are combined together (a meeting must match all
                of them; selected clients count as a match if any one is the
                client).
              </>
            ) : null}
          </>
        ) : (
          <>
            Showing all institutions ranked by total meeting volume. Select a
            client, market cap, sector, or region to rank by match.
          </>
        )}
      </div>

      {/* Results */}
      <div className={`overflow-hidden ${CARD_CLASS}`}>
        {ranked.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No institutions meet the minimum-meetings threshold
            {anySelected ? " for these criteria" : ""}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-12 px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">
                    Institution
                  </th>
                  {anySelected && (
                    <th className="px-3 py-2 text-left font-medium">Match %</th>
                  )}
                  {anySelected &&
                    breakdownCols.map((c) => (
                      <th
                        key={c.key}
                        className="px-3 py-2 text-right font-medium"
                      >
                        {c.header}
                      </th>
                    ))}
                  <th className="px-3 py-2 text-right font-medium"># Clients</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => {
                  const rank = i + 1
                  const pct = Math.round(r.matchPct)
                  const detailHref = r.institution_id
                    ? `/institution-detail?institution_id=${r.institution_id}`
                    : `/institution-detail`
                  return (
                    <tr
                      key={`${r.institution_name}-${rank}`}
                      className="border-b last:border-0"
                    >
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">
                        {rank}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={detailHref}
                          className="font-medium hover:underline"
                          style={{ color: NAVY_DEEP }}
                        >
                          {r.institution_name}
                        </Link>
                      </td>
                      {anySelected && (
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.min(100, r.matchPct)}%`,
                                  backgroundColor: barColor(r.matchPct),
                                }}
                              />
                            </div>
                            <span className="tabular-nums">{pct}%</span>
                          </div>
                        </td>
                      )}
                      {anySelected &&
                        breakdownCols.map((c) => (
                          <td
                            key={c.key}
                            className="px-3 py-2 text-right tabular-nums text-muted-foreground"
                          >
                            {Math.round(breakdownPct(r, c.key))}%
                          </td>
                        ))}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.distinctClients.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.total.toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { format, parseISO } from "date-fns"
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { ListTitleCard } from "@/components/page-masthead"
import { CARD_CLASS } from "@/lib/design"
import { cn } from "@/lib/utils"
import type { ClientPortfolioRow } from "@/lib/types"

const ALL = "__all__"

const MARKET_CAP_OPTIONS = ["Mega", "Large", "Mid", "Small", "Micro"] as const
const REGION_OPTIONS = ["Americas", "EMEA", "APAC"] as const

const STALE_BG = "#FEEBC8"
const STALE_FG = "#B7791F"
const COLD_BG = "#FED7D7"
const COLD_FG = "#C53030"
const NAVY = "#1E2858"
const GREEN = "#2D7A2D"
const RED = "#C53030"

// Account-team roles, in display order. Account mgr = the sales lead. Colors are
// drawn from the shared navy→teal palette; Logistics is light so it uses dark text.
const ACCOUNT_TEAM_ROLES = [
  { role: "Account mgr", key: "sales_lead_primary_name", bg: "#1E2858", fg: "#FFFFFF" },
  { role: "Secondary", key: "secondary_manager_name", bg: "#3D5599", fg: "#FFFFFF" },
  { role: "Associate", key: "associate_name", bg: "#1C8C9C", fg: "#FFFFFF" },
  { role: "Logistics", key: "logistics_coordinator_name", bg: "#4FC6BC", fg: "#0A3B36" },
] as const

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ""
  if (words.length === 1) return words[0][0].toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

function AccountTeamAvatars({ row }: { row: ClientPortfolioRow }) {
  // Only render roles with an assigned (non-blank) name; show a dash if none.
  const members = ACCOUNT_TEAM_ROLES.map((r) => ({ ...r, name: row[r.key] })).filter(
    (m): m is (typeof m) & { name: string } => Boolean(m.name && m.name.trim()),
  )
  if (members.length === 0) return <>—</>
  return (
    <div className="flex items-center">
      {members.map((m, i) => (
        <span
          key={m.key}
          title={`${m.role}: ${m.name}`}
          aria-label={`${m.role}: ${m.name}`}
          className="flex shrink-0 items-center justify-center rounded-full"
          style={{
            width: 24,
            height: 24,
            fontSize: "9px",
            fontWeight: 600,
            lineHeight: 1,
            backgroundColor: m.bg,
            color: m.fg,
            // Thin border in the row background so overlapping avatars read cleanly.
            border: "2px solid var(--card)",
            marginLeft: i === 0 ? 0 : -8,
            // Earlier roles sit on top of later ones.
            zIndex: members.length - i,
          }}
        >
          {initialsOf(m.name)}
        </span>
      ))}
    </div>
  )
}

type SortKey =
  | "name"
  | "ticker_symbol"
  | "market_cap_label"
  | "region_label"
  | "sector_label"
  | "annualized_retainer"
  | "meetings_last_365d"
  | "unique_institutions_last_365d"
  | "meetings_last_90d"
  | "last_meeting_date"
  | "last_event_date"
  | "last_note_date"

type SortDir = "asc" | "desc"

function safeParseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = typeof value === "string" ? parseISO(value) : value
  if (!d || Number.isNaN(d.getTime())) return null
  return d
}

function formatShortDate(value: string | null | undefined): string {
  const d = safeParseDate(value)
  return d ? format(d, "MM/dd/yy") : "—"
}

function formatCompactDollars(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${Math.round(value).toLocaleString()}`
}

function daysSince(value: string | null | undefined): number | null {
  const d = safeParseDate(value)
  if (!d) return null
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function ActivityPill({ kind }: { kind: "stale" | "cold" }) {
  const isStale = kind === "stale"
  return (
    <span
      style={{
        backgroundColor: isStale ? STALE_BG : COLD_BG,
        color: isStale ? STALE_FG : COLD_FG,
        padding: "1px 6px",
        borderRadius: "10px",
        fontSize: "9px",
        fontWeight: 500,
      }}
    >
      {isStale ? "Stale" : "Cold"}
    </span>
  )
}

function DateCell({ value }: { value: string | null | undefined }) {
  if (!value) return <>—</>
  const days = daysSince(value)
  let pill: React.ReactNode = null
  if (days != null) {
    if (days >= 90) pill = <ActivityPill kind="cold" />
    else if (days >= 30) pill = <ActivityPill kind="stale" />
  }
  return (
    <div className="whitespace-nowrap">
      <div>{formatShortDate(value)}</div>
      {pill && <div style={{ marginTop: 3 }}>{pill}</div>}
    </div>
  )
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  align = "left",
}: {
  label: string
  sortKey: SortKey
  currentKey: SortKey
  currentDir: SortDir
  onSort: (k: SortKey) => void
  align?: "left" | "right" | "center"
}) {
  const isActive = currentKey === sortKey
  const Icon = isActive ? (currentDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "inline-flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground",
        align === "right" && "justify-end",
        align === "center" && "justify-center",
      )}
    >
      {align === "right" ? (
        <>
          <Icon className={cn("size-3 shrink-0", isActive ? "text-foreground" : "text-muted-foreground/60")} />
          <span>{label}</span>
        </>
      ) : (
        <>
          <span>{label}</span>
          <Icon className={cn("size-3 shrink-0", isActive ? "text-foreground" : "text-muted-foreground/60")} />
        </>
      )}
    </button>
  )
}

function compareValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  dir: SortDir,
): number {
  const aNull = a == null || a === ""
  const bNull = b == null || b === ""
  if (aNull && bNull) return 0
  if (aNull) return 1 // nulls always last
  if (bNull) return -1
  if (typeof a === "number" && typeof b === "number") {
    return dir === "asc" ? a - b : b - a
  }
  const av = String(a).toLowerCase()
  const bv = String(b).toLowerCase()
  if (av < bv) return dir === "asc" ? -1 : 1
  if (av > bv) return dir === "asc" ? 1 : -1
  return 0
}

export function PortfolioTable({ rows }: { rows: ClientPortfolioRow[] }) {
  const searchParams = useSearchParams()
  // URL params are read once on mount only; filter changes are local-only and
  // are not pushed back to the URL.
  const [sortKey, setSortKey] = React.useState<SortKey>("name")
  const [sortDir, setSortDir] = React.useState<SortDir>("asc")
  const [search, setSearch] = React.useState("")
  const [marketCap, setMarketCap] = React.useState<string>(
    () => searchParams.get("market_cap") ?? ALL,
  )
  const [region, setRegion] = React.useState<string>(
    () => searchParams.get("region") ?? ALL,
  )
  const [sector, setSector] = React.useState<string>(
    () => searchParams.get("sector") ?? ALL,
  )
  const [salesLead, setSalesLead] = React.useState<string>(
    () => searchParams.get("sales_lead") ?? ALL,
  )
  const [staleMeetings, setStaleMeetings] = React.useState(false)
  const [coldMeetings, setColdMeetings] = React.useState(false)
  const [blankMeetings, setBlankMeetings] = React.useState(false)
  const [staleEvents, setStaleEvents] = React.useState(false)
  const [coldEvents, setColdEvents] = React.useState(false)
  const [blankEvents, setBlankEvents] = React.useState(false)
  const [staleNotes, setStaleNotes] = React.useState(false)
  const [coldNotes, setColdNotes] = React.useState(false)
  const [blankNotes, setBlankNotes] = React.useState(false)

  const sectors = React.useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.sector_label) set.add(r.sector_label)
    return [...set].sort()
  }, [rows])

  const salesLeads = React.useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.sales_lead_primary_name) set.add(r.sales_lead_primary_name)
    return [...set].sort()
  }, [rows])

  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const matchCategory = (
      value: string | null | undefined,
      stale: boolean,
      cold: boolean,
      blank: boolean,
    ): boolean => {
      if (!stale && !cold && !blank) return true
      const v = daysSince(value)
      if (stale && v != null && v >= 30 && v < 90) return true
      if (cold && v != null && v >= 90) return true
      if (blank && value == null) return true
      return false
    }
    return rows.filter((r) => {
      if (marketCap !== ALL && (r.market_cap_label ?? "") !== marketCap) return false
      if (region !== ALL && (r.region_label ?? "") !== region) return false
      if (sector !== ALL && (r.sector_label ?? "") !== sector) return false
      if (salesLead !== ALL && (r.sales_lead_primary_name ?? "") !== salesLead) return false
      if (!matchCategory(r.last_meeting_date, staleMeetings, coldMeetings, blankMeetings)) return false
      if (!matchCategory(r.last_event_date, staleEvents, coldEvents, blankEvents)) return false
      if (!matchCategory(r.last_note_date, staleNotes, coldNotes, blankNotes)) return false
      if (q) {
        const name = (r.name ?? "").toLowerCase()
        const ticker = (r.ticker_symbol ?? "").toLowerCase()
        if (!name.includes(q) && !ticker.includes(q)) return false
      }
      return true
    })
  }, [
    rows,
    search,
    marketCap,
    region,
    sector,
    salesLead,
    staleMeetings,
    coldMeetings,
    blankMeetings,
    staleEvents,
    coldEvents,
    blankEvents,
    staleNotes,
    coldNotes,
    blankNotes,
  ])

  const sortedRows = React.useMemo(() => {
    const arr = [...filteredRows]
    arr.sort((a, b) => compareValues(a[sortKey] as never, b[sortKey] as never, sortDir))
    return arr
  }, [filteredRows, sortKey, sortDir])

  function handleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(k)
      setSortDir("asc")
    }
  }

  function handleReset() {
    setMarketCap(ALL)
    setRegion(ALL)
    setSector(ALL)
    setSalesLead(ALL)
    setSearch("")
    setStaleMeetings(false)
    setColdMeetings(false)
    setBlankMeetings(false)
    setStaleEvents(false)
    setColdEvents(false)
    setBlankEvents(false)
    setStaleNotes(false)
    setColdNotes(false)
    setBlankNotes(false)
  }

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          title="Client Portfolio"
          subtitle={`${rows.length.toLocaleString()} clients — health at a glance`}
        />
      </div>
      <div className="space-y-3">
      {/* Activity flag legend */}
      <div
        className="flex flex-wrap items-center gap-2 text-muted-foreground"
        style={{ fontSize: "11px" }}
      >
        <span>Activity flags:</span>
        <span
          style={{
            backgroundColor: STALE_BG,
            color: STALE_FG,
            padding: "1px 6px",
            borderRadius: "10px",
            fontSize: "9px",
            fontWeight: 500,
          }}
        >
          Stale
        </span>
        <span>30-90 days since</span>
        <span
          style={{
            backgroundColor: COLD_BG,
            color: COLD_FG,
            padding: "1px 6px",
            borderRadius: "10px",
            fontSize: "9px",
            fontWeight: 500,
          }}
        >
          Cold
        </span>
        <span>90+ days since</span>
      </div>

      {/* Account Team color key — mirrors the avatar colors in the team column */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground"
        style={{ fontSize: "11px" }}
      >
        <span>Account Team:</span>
        {ACCOUNT_TEAM_ROLES.map((m) => (
          <span key={m.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                backgroundColor: m.bg,
                display: "inline-block",
              }}
            />
            {m.role}
          </span>
        ))}
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={marketCap}
          onChange={(e) => setMarketCap(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value={ALL}>All market caps</option>
          {MARKET_CAP_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value={ALL}>All regions</option>
          {REGION_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value={ALL}>All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={salesLead}
          onChange={(e) => setSalesLead(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value={ALL}>Account Manager (all)</option>
          {salesLeads.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={handleReset}
          className="h-9 cursor-pointer text-muted-foreground"
          style={{
            padding: "6px 14px",
            border: "0.5px solid #ccc",
            backgroundColor: "white",
          }}
        >
          Reset
        </button>

        <div className="relative ml-auto w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name..."
            className="pl-8"
          />
        </div>
      </div>

      {/* Activity flag toggles */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground" style={{ fontSize: "11px" }}>
          Activity flags:
        </span>
        {(
          [
            [
              { label: "Stale meetings", active: staleMeetings, toggle: () => setStaleMeetings((v) => !v) },
              { label: "Cold meetings", active: coldMeetings, toggle: () => setColdMeetings((v) => !v) },
              { label: "Blank meetings", active: blankMeetings, toggle: () => setBlankMeetings((v) => !v) },
            ],
            [
              { label: "Stale events", active: staleEvents, toggle: () => setStaleEvents((v) => !v) },
              { label: "Cold events", active: coldEvents, toggle: () => setColdEvents((v) => !v) },
              { label: "Blank events", active: blankEvents, toggle: () => setBlankEvents((v) => !v) },
            ],
            [
              { label: "Stale notes", active: staleNotes, toggle: () => setStaleNotes((v) => !v) },
              { label: "Cold notes", active: coldNotes, toggle: () => setColdNotes((v) => !v) },
              { label: "Blank notes", active: blankNotes, toggle: () => setBlankNotes((v) => !v) },
            ],
          ] as const
        ).map((group, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 && (
              <span
                className="border-l h-5 mx-1"
                style={{ borderColor: "var(--color-border-tertiary)" }}
              />
            )}
            {group.map(({ label, active, toggle }) => (
              <button
                key={label}
                type="button"
                onClick={toggle}
                style={{
                  padding: "4px 10px",
                  borderRadius: "14px",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontWeight: active ? 500 : undefined,
                  ...(active
                    ? { border: "0.5px solid #C53030", backgroundColor: "#FED7D7", color: "#C53030" }
                    : {
                        borderWidth: "0.5px",
                        borderStyle: "solid",
                        borderColor: "var(--color-border-secondary)",
                        backgroundColor: "white",
                        color: "var(--color-text-primary)",
                      }),
                }}
              >
                {active ? `✓ ${label}` : label}
              </button>
            ))}
          </React.Fragment>
        ))}
      </div>

      <div
        className={`${CARD_CLASS} [&_thead_tr:first-child_th:first-child]:rounded-tl-[14px] [&_thead_tr:first-child_th:last-child]:rounded-tr-[14px] [&_tbody_tr:last-child_td:first-child]:rounded-bl-[14px] [&_tbody_tr:last-child_td:last-child]:rounded-br-[14px]`}
      >
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="px-3">
                <SortHeader label="Client" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="px-3">
                <span className="text-xs font-medium text-muted-foreground">Account Team</span>
              </TableHead>
              <TableHead className="px-3">
                <SortHeader label="Mkt Cap" sortKey="market_cap_label" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="px-3">
                <SortHeader label="Region" sortKey="region_label" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="px-3">
                <SortHeader label="Sector" sortKey="sector_label" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="px-3">
                <SortHeader
                  label="Annualized Ret."
                  sortKey="annualized_retainer"
                  currentKey={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  align="right"
                />
              </TableHead>
              <TableHead className="px-3">
                <SortHeader
                  label="L12M Mtgs"
                  sortKey="meetings_last_365d"
                  currentKey={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  align="center"
                />
              </TableHead>
              <TableHead className="px-3">
                <SortHeader
                  label="L12M Inst"
                  sortKey="unique_institutions_last_365d"
                  currentKey={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  align="center"
                />
              </TableHead>
              <TableHead className="px-3">
                <SortHeader
                  label="L3M Mtgs"
                  sortKey="meetings_last_90d"
                  currentKey={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  align="center"
                />
              </TableHead>
              <TableHead className="px-3">
                <SortHeader
                  label="Last Meeting"
                  sortKey="last_meeting_date"
                  currentKey={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="px-3">
                <SortHeader
                  label="Last Event"
                  sortKey="last_event_date"
                  currentKey={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="px-3">
                <SortHeader
                  label="Last Note"
                  sortKey="last_note_date"
                  currentKey={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="h-32 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? "No clients on record yet." : "No clients match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((r) => {
                const meetings365 = r.meetings_last_365d ?? 0
                const meetings90 = r.meetings_last_90d ?? 0
                let velocity: { glyph: string; color: string } | null = null
                if (meetings365 > 0) {
                  const projected = meetings90 * 4
                  if (projected > meetings365) velocity = { glyph: "▲", color: GREEN }
                  else if (projected < meetings365) velocity = { glyph: "▼", color: RED }
                }

                return (
                  <TableRow key={r.account_id}>
                    {/* Client */}
                    <TableCell className="px-3 align-top">
                      <div>
                        <Link
                          href={`/client-detail?account_id=${r.account_id}`}
                          className="font-medium hover:underline"
                          style={{ color: NAVY }}
                        >
                          {r.name}
                        </Link>
                      </div>
                      <div
                        className="text-muted-foreground"
                        style={{ fontFamily: "monospace", fontSize: "10px", marginTop: 2 }}
                      >
                        {r.ticker_symbol ?? "—"}
                      </div>
                    </TableCell>

                    {/* Account Team */}
                    <TableCell className="px-3 align-top">
                      <AccountTeamAvatars row={r} />
                    </TableCell>

                    {/* Mkt Cap */}
                    <TableCell className="px-3 align-top">{r.market_cap_label ?? "—"}</TableCell>

                    {/* Region */}
                    <TableCell className="px-3 align-top">
                      <div>{r.hq_country_name ?? "—"}</div>
                      <div
                        className="text-muted-foreground"
                        style={{ fontSize: "10px", marginTop: 2 }}
                      >
                        {r.region_label ?? "—"}
                      </div>
                    </TableCell>

                    {/* Sector */}
                    <TableCell
                      className="px-3 align-top"
                      style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={r.sector_label ?? ""}
                    >
                      {r.sector_label ?? "—"}
                    </TableCell>

                    {/* Annualized Retainer */}
                    <TableCell className="px-3 align-top text-right tabular-nums">
                      {formatCompactDollars(r.annualized_retainer)}
                    </TableCell>

                    {/* Mtgs L12M */}
                    <TableCell className="px-3 align-top text-center tabular-nums">{meetings365}</TableCell>

                    {/* Inst L12M */}
                    <TableCell className="px-3 align-top text-center tabular-nums text-muted-foreground">
                      {r.unique_institutions_last_365d ?? 0}
                    </TableCell>

                    {/* Mtgs L3M with velocity */}
                    <TableCell className="px-3 align-top text-center tabular-nums">
                      <span className="inline-flex items-center justify-center gap-1">
                        {velocity && <span style={{ color: velocity.color }}>{velocity.glyph}</span>}
                        <span>{meetings90}</span>
                      </span>
                    </TableCell>

                    {/* Last Meeting */}
                    <TableCell className="px-3 align-top">
                      <DateCell value={r.last_meeting_date} />
                    </TableCell>

                    {/* Last Event */}
                    <TableCell className="px-3 align-top">
                      <DateCell value={r.last_event_date} />
                    </TableCell>

                    {/* Last Note */}
                    <TableCell className="px-3 align-top">
                      <DateCell value={r.last_note_date} />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
      </div>
    </>
  )
}

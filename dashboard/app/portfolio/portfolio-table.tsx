"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { format, parseISO } from "date-fns"
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Lock, FileText, Printer } from "lucide-react"

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
import {
  CARD_CLASS,
  NOTE_STATUS_PILL as NOTE_STATUS_STYLES,
  NOTE_STATUS_PILL_FALLBACK as NOTE_STATUS_FALLBACK,
} from "@/lib/design"
import { cn } from "@/lib/utils"
// The grouped-header treatment now lives in one shared module so Portfolio and
// the To-Do List cannot drift apart. These were all defined locally here first;
// the definitions moved out unchanged.
import {
  BODY_SECTION_START_STYLE,
  GradientSweepRow,
  GroupBandRow,
  SUBHEADER_BG,
  SectionDivider,
  type GroupBand,
} from "@/components/table-group-header"
import { DaysLeftPill, AutoRenewFlag, ContractDash } from "@/components/contract-fields"
import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import { EXPIRY_BUCKETS, EXPIRY_BUCKET_BY_KEY } from "@/lib/contract-expiry"
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

// Two-tier header, matching the Planning V2 header so the two big tables read as
// one system: the top row carries UNFILLED section bands — navy small-caps over
// the white card — told apart by a thin gradient rule underneath rather than by
// a background colour. The bands used to be filled medium-grey caps; the fill
// made the group heading the heaviest thing in the header, which is not where
// the eye should go.
//
// Toggleable column sections, in table order. Core (Client + Account Team) is
// always shown and not in this list — it's the locked identity group. `cols` is
// the column count, used for the band colSpan and the empty-state colSpan.
const TOGGLE_SECTIONS = [
  { id: "classification", label: "Classification", cols: 3 },
  { id: "contract", label: "Contract", cols: 6 },
  { id: "meetings", label: "Meetings", cols: 5 },
  { id: "activity", label: "Activity", cols: 2 },
] as const

type SectionId = (typeof TOGGLE_SECTIONS)[number]["id"]
const VALID_SECTION_IDS = new Set<string>(TOGGLE_SECTIONS.map((s) => s.id))
// Default view: Contract + Meetings + Activity on; Classification off.
const DEFAULT_SECTIONS: SectionId[] = ["contract", "meetings", "activity"]

// Frozen Core columns: when the table overflows horizontally, Client, Status and
// Account Team stay pinned on the left. Header cells sit above body cells; the
// sticky thead (z-20) stays above both so vertical scroll tucks rows under the
// header.
//
// All three are FIXED-width. NOTHING in the data grid stretches: leftover width
// on a wide monitor pools in an empty trailing SPACER column at the far right
// (see the spacer cells below), so every column keeps its tight width and there
// is still no white gap.
//
// Client is a hard cap, not a preference: long names truncate with an ellipsis
// and the full name is on hover (the cell wraps its link in a truncate div with
// a title). NB a max-width would NOT work here — under table-layout:auto
// browsers IGNORE max-width on table cells, so the ceiling must be a real width.
const CLIENT_COL_W = 200
const STATUS_COL_W = 92
const TEAM_COL_W = 84

/**
 * Tight minimum for every data column, in table order — the smallest that still
 * shows the value without wrapping, with headers abbreviated where the LABEL
 * (not the data) was setting the width. Their sum is the table's no-squish
 * floor: below it the wrapper scrolls rather than cramming.
 *
 * These feed ONLY the floor calculation — no per-column CSS width is applied to
 * the data columns, so they size to their content naturally. That makes erring
 * LOW safe (the table just ends up wider than the floor and the spacer takes
 * less) and erring HIGH the only real mistake, since it would force width the
 * content does not need. Values are measured from rendered content at the 6px
 * cell padding, rounded up a couple of px.
 */
const SECTION_MIN_W = {
  // Client + Status + Team, all fixed above.
  core: CLIENT_COL_W + STATUS_COL_W + TEAM_COL_W,
  // Mkt Cap, Region, Sector
  classification: 64 + 90 + 80,
  // Term End, Days, Renew, Term
  contract: 68 + 45 + 48 + 46,
  // Retainer, Doc — only rendered with the Financials grant
  contractFinancials: 57 + 33,
  // L12M, Inst, L3M, Next 3M, Last — these two groups carry 10px cell padding
  // instead of the 6px base (they read as cramped at 6px), so each column here
  // is its measured tight width + 8.
  meetings: 50 + 43 + 44 + 67 + 76,
  // Event, Note — same 10px padding as Meetings.
  activity: 76 + 76,
} as const

/**
 * Sticky style for a frozen column. `left` is the cumulative offset of the
 * columns before it — Client flexes, so Status/Team offsets are measured at
 * runtime rather than assumed (see clientColWidth below).
 */
function frozenStyle(left: number, z: number, width?: number): React.CSSProperties {
  return {
    position: "sticky",
    left,
    zIndex: z,
    ...(width == null ? {} : { width, minWidth: width, maxWidth: width }),
    backgroundColor: "var(--card)",
  }
}

/**
 * STRETCH-TO-FIT: the table is width:100% with no greedy column and no
 * percentage width anywhere, so table-layout:auto spreads any leftover width
 * PROPORTIONALLY across the auto-sized data columns — every column grows a
 * little, none balloons, and there is no right-hand gap. The three frozen Core
 * columns (Client / Status / Team) stay pinned at their fixed widths and take
 * no part in it, which is what keeps the ~200px client cap and its ellipsis.
 *
 * min-width (SECTION_MIN_W) is still the floor: below it the wrapper scrolls
 * rather than cramming.
 */

// Account-team roles, in display order. Account mgr = the sales lead. Colors are
// drawn from the shared navy→teal palette; Logistics is light so it uses dark text.
const ACCOUNT_TEAM_ROLES = [
  { role: "Account mgr", key: "sales_lead_primary_name", bg: "#1E2858", fg: "#FFFFFF" },
  { role: "Secondary", key: "secondary_manager_name", bg: "#3D5599", fg: "#FFFFFF" },
  { role: "Associate", key: "associate_name", bg: "#1C8C9C", fg: "#FFFFFF" },
  { role: "Logistics", key: "logistics_coordinator_name", bg: "#4FC6BC", fg: "#0A3B36" },
] as const

// Maps a Portfolio row's four account-team roles into the shared avatar cluster.
// Rendering (initials, 24px overlapping circles, colors) lives in the shared
// component so Portfolio and Profiles stay identical.
function AccountTeamAvatars({ row }: { row: ClientPortfolioRow }) {
  const members = ACCOUNT_TEAM_ROLES.map((r) => ({
    role: r.role,
    name: row[r.key],
    bg: r.bg,
    fg: r.fg,
  }))
  return <TeamAvatars members={members} />
}

// Note-status flag colors now live in lib/design.ts (NOTE_STATUS_PILL), imported
// above as NOTE_STATUS_STYLES so the Portfolio pills and the Client Statistics
// "Clients by Status" donut share one palette. At Risk = urgent red, Lost = muted
// gray, Stable/Strong = healthy green, New Client = navy tint; unknown values fall
// back to gray so a new status surfaces rather than vanishing.

// Sort + filter order, most-urgent first. Drives both the severity sort and the
// filter dropdown so "At Risk" always surfaces at the top / front.
const NOTE_STATUS_ORDER = ["At Risk", "Lost", "New Client", "Stable", "Strong"] as const
const NOTE_STATUS_RANK: Record<string, number> = Object.fromEntries(
  NOTE_STATUS_ORDER.map((s, i) => [s, i]),
)
// Filter sentinel for "client has no note on record".
const NONE = "__none__"

function NoteStatusPill({
  status,
  date,
}: {
  status: string | null | undefined
  date: string | null | undefined
}) {
  if (!status) return <span className="text-muted-foreground">—</span>
  const style = NOTE_STATUS_STYLES[status] ?? NOTE_STATUS_FALLBACK
  const title = date ? `${status} — as of ${formatShortDate(date)}` : status
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: style.bg, color: style.fg }}
    >
      {status}
    </span>
  )
}

type SortKey =
  | "name"
  | "note_status"
  | "ticker_symbol"
  | "market_cap_label"
  | "region_label"
  | "sector_label"
  | "initial_term_end"
  | "days_to_expiry"
  | "auto_renew"
  | "contract_status_label"
  | "annualized_retainer"
  | "meetings_last_365d"
  | "unique_institutions_last_365d"
  | "meetings_last_90d"
  | "meetings_next_3m"
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
  if (abs >= 1_000_000) return `$${Math.round(value / 1_000_000)}M`
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`
  return `$${Math.round(value).toLocaleString()}`
}

// Display-only shortening for the Contract "Term" column. The underlying
// contract_status_label values are "Initial Term" / "Renewal Term" (plus
// "Terminated" / "Contract Expired"); since the column is now headed "Term",
// strip a redundant trailing " Term" so they read "Initial" / "Renewal". Values
// that don't end in " Term" (Terminated, Contract Expired) pass through as-is,
// and null shows the em-dash. The full value is kept in the cell's title tooltip.
function shortenContractTerm(value: string | null | undefined): string {
  if (!value) return "—"
  return value.replace(/ Term$/, "")
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

export function PortfolioTable({
  rows,
  showFinancials,
}: {
  rows: ClientPortfolioRow[]
  /**
   * Does this viewer hold the Financials permission? Decided server-side
   * (canSeeFinancials) — when false the rows arrive with annualized_retainer /
   * quarterly_retainer / contract_url already DELETED, and this flag drops the
   * Retainer and Doc columns so the Contract band has no empty placeholders.
   * The flag alone is never the protection; the omitted payload is.
   */
  showFinancials: boolean
}) {
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
  const [noteStatus, setNoteStatus] = React.useState<string>(
    () => searchParams.get("note_status") ?? ALL,
  )
  const [expiry, setExpiry] = React.useState<string>(
    () => searchParams.get("expiry") ?? ALL,
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

  // Visible column sections. Read once from ?sections= on mount; an explicit but
  // empty value (?sections=) means "only Core". Absent means default view.
  const [activeSections, setActiveSections] = React.useState<Set<SectionId>>(() => {
    const raw = searchParams.get("sections")
    if (raw == null) return new Set(DEFAULT_SECTIONS)
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => VALID_SECTION_IDS.has(s)) as SectionId[]
    return new Set(ids)
  })

  // Mirror the active sections into the URL (canonical order) without a server
  // roundtrip, so the view survives refresh and is shareable. replaceState keeps
  // toggling out of the back-button history.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ordered = TOGGLE_SECTIONS.filter((s) => activeSections.has(s.id)).map(
      (s) => s.id,
    )
    params.set("sections", ordered.join(","))
    window.history.replaceState(null, "", `?${params.toString()}`)
  }, [activeSections])

  function toggleSection(id: SectionId) {
    setActiveSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const show = {
    classification: activeSections.has("classification"),
    contract: activeSections.has("contract"),
    meetings: activeSections.has("meetings"),
    activity: activeSections.has("activity"),
  }
  // Cumulative sticky LEFT offsets for the frozen columns. Client and Status are
  // both fixed width, so these are plain constants (no runtime measurement).
  const statusLeft = CLIENT_COL_W
  const teamLeft = CLIENT_COL_W + STATUS_COL_W

  // The table's floor: the sum of every visible column's comfortable minimum.
  // Wider than this and the table stretches to fill (no right-hand gap);
  // narrower and the wrapper scrolls horizontally instead of squeezing.
  const tableMinWidth =
    SECTION_MIN_W.core +
    (show.classification ? SECTION_MIN_W.classification : 0) +
    (show.contract
      ? SECTION_MIN_W.contract + (showFinancials ? SECTION_MIN_W.contractFinancials : 0)
      : 0) +
    (show.meetings ? SECTION_MIN_W.meetings : 0) +
    (show.activity ? SECTION_MIN_W.activity : 0)

  // The group bands actually on screen, left to right. Drives both the header
  // cells and their position in the gradient sweep, so the ramp stays continuous
  // whichever sections are toggled on. colSpan must equal each band's visible
  // column count or the band stops sitting over its own columns.
  const visibleBands: GroupBand[] = [
    { key: "core", label: "Client", colSpan: 3, sticky: true },
    ...(show.classification
      ? [{ key: "classification", label: "Classification", colSpan: 3 }]
      : []),
    ...(show.contract
      ? [{ key: "contract", label: "Contract", colSpan: showFinancials ? 6 : 4 }]
      : []),
    ...(show.meetings ? [{ key: "meetings", label: "Meetings", colSpan: 5 }] : []),
    ...(show.activity ? [{ key: "activity", label: "Activity", colSpan: 2 }] : []),
  ]

  const visibleColCount =
    3 +
    TOGGLE_SECTIONS.reduce(
      (n, s) => n + (activeSections.has(s.id) ? s.cols : 0),
      0,
    ) -
    // Contract loses its Retainer + Doc columns without the Financials grant.
    (show.contract && !showFinancials ? 2 : 0)

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
      if (noteStatus !== ALL) {
        if (noteStatus === NONE) {
          if (r.note_status) return false
        } else if ((r.note_status ?? "") !== noteStatus) return false
      }
      if (expiry !== ALL) {
        const bucket = EXPIRY_BUCKET_BY_KEY[expiry]
        if (bucket && !bucket.match(r.days_to_expiry ?? null)) return false
      }
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
    noteStatus,
    expiry,
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
    arr.sort((a, b) => {
      // Status sorts by severity (At Risk → … → Strong), not alphabetically, so
      // ascending surfaces the most urgent clients first. Nulls (no note) always
      // last, matching compareValues' null handling.
      if (sortKey === "note_status") {
        const an = !a.note_status
        const bn = !b.note_status
        if (an && bn) return 0
        if (an) return 1
        if (bn) return -1
        const ar = NOTE_STATUS_RANK[a.note_status!] ?? NOTE_STATUS_ORDER.length
        const br = NOTE_STATUS_RANK[b.note_status!] ?? NOTE_STATUS_ORDER.length
        return sortDir === "asc" ? ar - br : br - ar
      }
      return compareValues(a[sortKey] as never, b[sortKey] as never, sortDir)
    })
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
    setNoteStatus(ALL)
    setExpiry(ALL)
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

  // Print-only report metadata. Built from the *current* filter/sort state so the
  // exported PDF's header describes exactly what's on screen. Only non-default
  // filters are listed; the resulting row count always shows. This block is hidden
  // on screen (.print-only) and revealed only under @media print (see globals.css).
  const genDate = format(new Date(), "MMMM d, yyyy")
  const activeFilterParts: string[] = []
  if (marketCap !== ALL) activeFilterParts.push(`Market Cap = ${marketCap}`)
  if (region !== ALL) activeFilterParts.push(`Region = ${region}`)
  if (sector !== ALL) activeFilterParts.push(`Sector = ${sector}`)
  if (salesLead !== ALL) activeFilterParts.push(`Sales Lead = ${salesLead}`)
  if (noteStatus !== ALL)
    activeFilterParts.push(`Status = ${noteStatus === NONE ? "No note" : noteStatus}`)
  if (expiry !== ALL)
    activeFilterParts.push(`Expiry = ${EXPIRY_BUCKET_BY_KEY[expiry]?.label ?? expiry}`)
  for (const [on, label] of [
    [staleMeetings, "Stale meetings"],
    [coldMeetings, "Cold meetings"],
    [blankMeetings, "Blank meetings"],
    [staleEvents, "Stale events"],
    [coldEvents, "Cold events"],
    [blankEvents, "Blank events"],
    [staleNotes, "Stale notes"],
    [coldNotes, "Cold notes"],
    [blankNotes, "Blank notes"],
  ] as const) {
    if (on) activeFilterParts.push(label)
  }
  const searchText = search.trim()
  if (searchText) activeFilterParts.push(`"${searchText}"`)
  const rowCountLabel = `${sortedRows.length} ${sortedRows.length === 1 ? "client" : "clients"}`
  const filterSummary = activeFilterParts.length
    ? `Filters: ${activeFilterParts.join(" · ")} · ${rowCountLabel}`
    : rowCountLabel

  return (
    <div className="portfolio-print-root">
      {/* Print-only branded report header — hidden on screen, shown on paper. */}
      <div className="print-only" aria-hidden="true">
        <div style={{ borderBottom: "2px solid #1E2858", paddingBottom: 8, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "#1E2858",
                  fontWeight: 700,
                }}
              >
                Rose &amp; Co
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginTop: 2 }}>
                Client Portfolio
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#4B5563" }} suppressHydrationWarning>
              {genDate}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#374151", marginTop: 6 }}>{filterSummary}</div>
        </div>
      </div>

      <div className="mb-4 no-print">
        <ListTitleCard
          title="Client Portfolio"
          subtitle={`${rows.length.toLocaleString()} clients — health at a glance`}
        />
      </div>
      <div className="space-y-3">
      {/* Combined legend strip: Activity flags · Account Team · Status laid out
          on one horizontal row (was three stacked rows) to reclaim vertical
          space, with faint vertical hairlines separating the three labeled
          groups. flex-wrap lets whole groups drop to a second line on narrow
          widths, and each group wraps internally so nothing overflows. */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground no-print"
        style={{ fontSize: "11px" }}
      >
        {/* Activity flags */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">Activity flags:</span>
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

        {/* Faint vertical divider between groups */}
        <span aria-hidden="true" className="h-5 w-px shrink-0" style={{ backgroundColor: "#D1D7E0" }} />

        {/* Account Team color key — mirrors the avatar colors in the team column */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-foreground">Account Team:</span>
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

        {/* Faint vertical divider between groups */}
        <span aria-hidden="true" className="h-5 w-px shrink-0" style={{ backgroundColor: "#D1D7E0" }} />

        {/* Note-status color key — mirrors the Status pills (latest client note) */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">Status (latest note):</span>
          {NOTE_STATUS_ORDER.map((s) => {
            const style = NOTE_STATUS_STYLES[s]
            return (
              <span
                key={s}
                style={{
                  backgroundColor: style.bg,
                  color: style.fg,
                  padding: "1px 6px",
                  borderRadius: "10px",
                  fontSize: "9px",
                  fontWeight: 500,
                }}
              >
                {s}
              </span>
            )
          })}
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 no-print">
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

        <select
          value={noteStatus}
          onChange={(e) => setNoteStatus(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value={ALL}>All statuses</option>
          {NOTE_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value={NONE}>No note</option>
        </select>

        <select
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value={ALL}>Days left (all)</option>
          {EXPIRY_BUCKETS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
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

        {/* Export the current filtered/sorted view to PDF via the browser's
            print dialog. data-print="hide" keeps the button itself out of the
            printed output; the @media print rules reshape the page for paper.

            Icon-only, square to the 36px control height the toolbar's other
            controls share. The label survives in BOTH `title` (the hover
            tooltip) and `aria-label` (the accessible name) — `title` alone is
            not an accessible-name substitute for screen-reader and voice-control
            users, and with no text node left in the button there is nothing else
            to name it. */}
        <button
          type="button"
          onClick={() => window.print()}
          data-print="hide"
          title="Export PDF"
          aria-label="Export PDF"
          className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center text-muted-foreground"
          style={{
            border: "0.5px solid #ccc",
            backgroundColor: "white",
          }}
        >
          <Printer className="size-4" aria-hidden="true" />
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

      {/* Sections toggle (left) + activity-flag pills (right) share one row,
          pinned to opposite edges via justify-between. order-* drives the visual
          order so Sections sits left even though the pills come first in markup. */}
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
      {/* Activity flag toggles — pinned right */}
      <div className="order-2 flex flex-wrap items-center gap-2">
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

      {/* Section visibility toggles — segmented control matching the app's
          SegmentedFilter look (light tray, navy-filled active pills), but
          multi-select: any number of sections can be active at once, each pill
          toggling independently. Core is a locked, always-on pill. Persists to
          ?sections= in the URL. Pinned left within the shared row. */}
      <div className="order-1 flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sections</span>
        <div
          className="flex h-9 items-center rounded-md bg-card p-0.5"
          style={{ border: "0.5px solid var(--border)" }}
        >
          <button
            type="button"
            disabled
            title="Always shown"
            className="inline-flex cursor-default items-center gap-1 rounded bg-[#1E2858] px-1.5 py-1 text-xs font-medium text-white opacity-70"
          >
            <Lock className="size-3" aria-hidden="true" />
            Client
          </button>
          {TOGGLE_SECTIONS.map((s) => {
            const active = activeSections.has(s.id)
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleSection(s.id)}
                aria-pressed={active}
                className={
                  "rounded px-1.5 py-1 text-xs font-medium transition-colors " +
                  (active ? "bg-[#1E2858] text-white" : "text-foreground hover:bg-slate-50")
                }
              >
                {s.label}
              </button>
            )
          })}
        </div>
      </div>
      </div>

      {/* The shared <Table> renders its own [data-slot=table-container] wrapper
          with overflow-x:auto. Because overflow-x:auto forces overflow-y to
          compute to auto as well, that wrapper is ALREADY a scroll container in
          both axes — which means `sticky top-0` on the thead sticks to the
          WRAPPER, not the viewport, and with an unbounded wrapper height it
          never engages at all (the header just scrolls away with the page).
          Bounding the height is what makes the sticky header actually work; the
          rows then scroll inside the card and the header + frozen Client column
          hold on both axes at once. */}
      {/* overflow-hidden is what actually keeps the card's corners: it clips the
          scrolling table to the card's 14px radius, so rows pass BEHIND the
          curve instead of over it.

          It replaces four rounded-*-[14px] rules that used to round individual
          CELLS — the first/last header cell and the first/last cell of the LAST
          body row. That only ever looked right when the table was scrolled to
          the very bottom: the rounded row is the last row in the DOM, not the
          row that happens to be at the bottom of the viewport, so mid-scroll the
          real bottom row had square corners poking past the curve. Clipping the
          container is indifferent to which row is showing. */}
      <div
        className={`${CARD_CLASS} overflow-hidden [&_[data-slot=table-container]]:max-h-[calc(100vh-15rem)] [&_[data-slot=table-container]]:overflow-y-auto`}
      >
        {/* width:100% so the table always fills the card — no right-hand white
            gap — with min-width as the floor: below it the wrapper scrolls
            horizontally rather than cramming the columns. The old dead gap
            between Term and Retainer is gone because the columns themselves are
            now tight (6px padding, abbreviated headers): the leftover is shared
            PROPORTIONALLY across all of them rather than dumped between two, so
            the row stays balanced at any width. */}
        <Table className="w-full" style={{ minWidth: tableMinWidth }}>
          {/* [&_tr]:border-b-0 cancels the rule TableHeader applies to every row
              inside it. That rule is a DESCENDANT selector, so it outranks a
              plain border-b-0 on the rows themselves — it has to be overridden
              here, on the same element, to win.
              The header draws no FULL-WIDTH horizontal rules: the only two lines
              it carries are per-section and inset (the label underline and the
              gradient bar), both broken by the white gutters. The body keeps its
              own row separators, which come from TableRow and are untouched. */}
          {/* [&_th]:bg-card makes the header opaque AT CELL LEVEL, which is what
              stops rows showing through it. A background on the <thead> or on
              the <tr> is not enough on its own: the two STICKY cells (the Client
              band label and the first gradient segment, both position:sticky
              left:0) are lifted into their own paint layer, so on horizontal
              scroll the other columns slid underneath them with nothing opaque
              in between. The sub-header's frozen cells already set this inline
              via frozenStyle; this covers every remaining header cell — the band
              row, the gradient row, and the unfrozen sub-column cells — in one
              place. Inline backgrounds still win where they are set, and they
              set the same var(--card). */}
          <TableHeader className="sticky top-0 z-20 bg-card [&_tr]:border-b-0 [&_th]:bg-card">
            {/* Top tier: section bands. Only active sections render; each band's
                colSpan equals its visible column count so it sits exactly over its
                columns. Core (Client) is always shown and frozen left.
                Built from a list rather than inline JSX so the gradient sweep can
                be indexed against the VISIBLE bands — toggling Classification off
                must not leave a gap in the ramp. */}
            {/* border-b-0 on all three header rows: TableRow applies `border-b`
                by default, which is right for data rows (they need separating)
                but drew a full-width rule under the group labels AND under the
                sub-column labels. The label underline below replaces the first
                of those with a per-section, inset version. */}
            <GroupBandRow bands={visibleBands} />
            <TableRow className="border-b-0" style={{ backgroundColor: SUBHEADER_BG }}>
              {/* Core — frozen left */}
              <TableHead
                className="h-8 px-1.5"
                style={{ ...frozenStyle(0, 30, CLIENT_COL_W), backgroundColor: SUBHEADER_BG }}
              >
                <SortHeader label="Client" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="h-8 px-1.5" style={{ ...frozenStyle(statusLeft, 30, STATUS_COL_W), backgroundColor: SUBHEADER_BG }}>
                <SortHeader label="Status" sortKey="note_status" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead
                className="h-8 px-1.5"
                style={{ ...frozenStyle(teamLeft, 30, TEAM_COL_W), backgroundColor: SUBHEADER_BG }}
              >
                <span className="text-xs font-medium text-muted-foreground">Team</span>
              </TableHead>
              {show.classification && (
                <>
                  {/* Section start — carries the gutter divider's middle
                      segment. See SectionDivider. */}
                  <TableHead className="relative h-8 px-1.5">
                    <SectionDivider />
                    <SortHeader label="Mkt Cap" sortKey="market_cap_label" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </TableHead>
                  <TableHead className="h-8 px-1.5">
                    <SortHeader label="Region" sortKey="region_label" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </TableHead>
                  <TableHead className="h-8 px-1.5">
                    <SortHeader label="Sector" sortKey="sector_label" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </TableHead>
                </>
              )}
              {show.contract && (
                <>
                  {/* Section start — see SectionDivider. */}
                  <TableHead className="relative h-8 px-1.5">
                    <SectionDivider />
                    <SortHeader label="Term End" sortKey="initial_term_end" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </TableHead>
                  <TableHead className="h-8 px-1.5">
                    <SortHeader
                      label="Days"
                      sortKey="days_to_expiry"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="right"
                    />
                  </TableHead>
                  <TableHead className="h-8 px-1.5">
                    <SortHeader
                      label="Renew"
                      sortKey="auto_renew"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="center"
                    />
                  </TableHead>
                  <TableHead className="h-8 px-1.5">
                    <SortHeader label="Term" sortKey="contract_status_label" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </TableHead>
                  {showFinancials && (
                    <>
                      <TableHead className="h-8 px-1.5">
                        <SortHeader
                          label="Retainer"
                          sortKey="annualized_retainer"
                          currentKey={sortKey}
                          currentDir={sortDir}
                          onSort={handleSort}
                          align="right"
                        />
                      </TableHead>
                      <TableHead className="h-8 px-1.5 text-center">
                        <span className="text-xs font-medium text-muted-foreground">Doc</span>
                      </TableHead>
                    </>
                  )}
                </>
              )}
              {show.meetings && (
                <>
                  {/* Section start — see SectionDivider. */}
                  <TableHead className="relative h-8 px-2.5">
                    <SectionDivider />
                    <SortHeader
                      label="L12M"
                      sortKey="meetings_last_365d"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="right"
                    />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader
                      label="Inst"
                      sortKey="unique_institutions_last_365d"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="right"
                    />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader
                      label="L3M"
                      sortKey="meetings_last_90d"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="right"
                    />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader
                      label="Next 3M"
                      sortKey="meetings_next_3m"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="right"
                    />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader
                      label="Last"
                      sortKey="last_meeting_date"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                  </TableHead>
                </>
              )}
              {show.activity && (
                <>
                  {/* Section start — see SectionDivider. */}
                  <TableHead className="relative h-8 px-2.5">
                    <SectionDivider />
                    <SortHeader
                      label="Event"
                      sortKey="last_event_date"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader
                      label="Note"
                      sortKey="last_note_date"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                  </TableHead>
                </>
              )}
            </TableRow>

            {/* Header/body boundary: the blue→teal ramp, broken into one bar per
                group. The gradient still runs continuously ACROSS the segments —
                each picks up the ramp where the last left off — so the row reads
                as one sweep with the sections called out, rather than four
                unrelated bars.

                The bar sits on an inset inner div using the SAME px-1.5 (cell) +
                mx-1 (inner) inset as the group-label underline above it, so the
                white gutters land in exactly the same places and the top labels
                and bottom bars share one section rhythm.

                h-auto + an explicit height collapses this row onto the bar.
                TableHead ships `h-10` and `align-middle`, which was centring a
                4.5px bar in a 40px row and leaving ~18px of dead space above it
                (and below). lineHeight 0 stops the cell's inline box re-inflating
                the row.

                No border of any kind on these cells, transparent or otherwise.
                The section dividers above are out-of-flow elements, not cell
                borders, so no cell in the header has a border box to match — put
                one here and this row's content would start 1px right of the
                labels' and the two rows' segments would stop lining up. The
                Client segment is sticky-left like the cells above it, so it
                holds position when the frozen columns slide over the rest on
                horizontal scroll. */}
            <GradientSweepRow bands={visibleBands} />
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColCount} className="h-32 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? "No clients on record yet." : "No clients match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((r) => {
                const meetings365 = r.meetings_last_365d ?? 0
                const meetings90 = r.meetings_last_90d ?? 0
                // Mirrors the Contract tab: a client with no active contract shows
                // dashes for Term End / Auto-Renew / Status, and the gray badge for
                // Days Left.
                const inactive = !r.has_active_contract
                let velocity: { glyph: string; color: string } | null = null
                if (meetings365 > 0) {
                  const projected = meetings90 * 4
                  if (projected > meetings365) velocity = { glyph: "▲", color: GREEN }
                  else if (projected < meetings365) velocity = { glyph: "▼", color: RED }
                }

                return (
                  <TableRow key={r.account_id}>
                    {/* Client — frozen left */}
                    <TableCell
                      className="px-1.5 py-1 align-top"
                      style={{ ...frozenStyle(0, 10, CLIENT_COL_W), overflow: "hidden" }}
                    >
                      <div className="truncate" title={r.name}>
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

                    {/* Status — frozen left */}
                    <TableCell className="px-1.5 py-1 align-top" style={frozenStyle(statusLeft, 10, STATUS_COL_W)}>
                      <NoteStatusPill status={r.note_status} date={r.note_status_date} />
                    </TableCell>

                    {/* Account Team — frozen left */}
                    <TableCell className="px-1.5 py-1 align-top" style={frozenStyle(teamLeft, 10, TEAM_COL_W)}>
                      <AccountTeamAvatars row={r} />
                    </TableCell>

                    {show.classification && (
                      <>
                        {/* Mkt Cap */}
                        <TableCell className="px-1.5 py-1 align-top" style={BODY_SECTION_START_STYLE}>{r.market_cap_label ?? "—"}</TableCell>

                        {/* Region */}
                        <TableCell className="px-1.5 py-1 align-top" style={{ maxWidth: 132 }}>
                          <div className="truncate" title={r.hq_country_name ?? ""}>
                            {r.hq_country_name ?? "—"}
                          </div>
                          <div
                            className="text-muted-foreground truncate"
                            style={{ fontSize: "10px", marginTop: 2 }}
                          >
                            {r.region_label ?? "—"}
                          </div>
                        </TableCell>

                        {/* Sector */}
                        <TableCell
                          className="px-1.5 py-1 align-top"
                          style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={r.sector_label ?? ""}
                        >
                          {r.sector_label ?? "—"}
                        </TableCell>
                      </>
                    )}

                    {show.contract && (
                      <>
                        {/* Term End */}
                        <TableCell
                          className="px-1.5 py-1 align-top whitespace-nowrap"
                          style={BODY_SECTION_START_STYLE}
                        >
                          {inactive ? <ContractDash /> : formatShortDate(r.initial_term_end)}
                        </TableCell>

                        {/* Days Left */}
                        <TableCell className="px-1.5 py-1 align-top text-right">
                          <DaysLeftPill
                            days={inactive ? null : r.days_to_expiry}
                            hasContract={!!r.has_active_contract}
                            totalContractCount={r.total_contract_count ?? 0}
                          />
                        </TableCell>

                        {/* Auto-Renew */}
                        <TableCell className="px-1.5 py-1 align-top text-center text-base">
                          <AutoRenewFlag value={inactive ? null : r.auto_renew} />
                        </TableCell>

                        {/* Status */}
                        <TableCell
                          className="px-1.5 py-1 align-top"
                          style={{ maxWidth: 124, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={r.contract_status_label ?? ""}
                        >
                          {inactive ? <ContractDash /> : shortenContractTerm(r.contract_status_label)}
                        </TableCell>

                        {/* Annualized Retainer + contract doc — FINANCIALS-GATED.
                            Not rendered at all without the grant, and the values
                            aren't in `r` either (stripped server-side). */}
                        {showFinancials && (
                          <>
                            <TableCell className="px-1.5 py-1 align-top text-right tabular-nums">
                              {formatCompactDollars(r.annualized_retainer)}
                            </TableCell>

                            {/* Contract doc — SharePoint link, same treatment as Contract Management */}
                            <TableCell className="px-1.5 py-1 align-top text-center">
                              {r.contract_url?.trim() ? (
                                <a
                                  href={r.contract_url.trim()}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Open contract"
                                  aria-label="Open contract"
                                  className="text-muted-foreground transition-colors hover:text-[#1E2858]"
                                >
                                  <FileText className="size-3.5" aria-hidden="true" />
                                </a>
                              ) : null}
                            </TableCell>
                          </>
                        )}
                      </>
                    )}

                    {show.meetings && (
                      <>
                        {/* Mtgs L12M */}
                        <TableCell className="px-2.5 py-1 align-top text-right tabular-nums" style={BODY_SECTION_START_STYLE}>{meetings365}</TableCell>

                        {/* Inst L12M */}
                        <TableCell className="px-2.5 py-1 align-top text-right tabular-nums text-muted-foreground">
                          {r.unique_institutions_last_365d ?? 0}
                        </TableCell>

                        {/* Mtgs L3M with velocity */}
                        <TableCell className="px-2.5 py-1 align-top text-right tabular-nums">
                          <span className="inline-flex items-center justify-end gap-1">
                            {velocity && <span style={{ color: velocity.color }}>{velocity.glyph}</span>}
                            <span>{meetings90}</span>
                          </span>
                        </TableCell>

                        {/* Mtgs Next 3M — forward-looking confirmed count */}
                        <TableCell className="px-2.5 py-1 align-top text-right tabular-nums">
                          {r.meetings_next_3m ?? 0}
                        </TableCell>

                        {/* Last Meeting */}
                        <TableCell className="px-2.5 py-1 align-top">
                          <DateCell value={r.last_meeting_date} />
                        </TableCell>
                      </>
                    )}

                    {show.activity && (
                      <>
                        {/* Last Event */}
                        <TableCell className="px-2.5 py-1 align-top" style={BODY_SECTION_START_STYLE}>
                          <DateCell value={r.last_event_date} />
                        </TableCell>

                        {/* Last Note */}
                        <TableCell className="px-2.5 py-1 align-top">
                          <DateCell value={r.last_note_date} />
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
      </div>
    </div>
  )
}

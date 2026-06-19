"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { format, parseISO } from "date-fns"
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Lock } from "lucide-react"

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
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { DaysLeftPill, AutoRenewFlag, ContractDash } from "@/components/contract-fields"
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

// Two-tier header: the top row shows section bands spanning their columns. The
// bands read as distinct labeled blocks — centered, uppercase, semibold dark
// text on a medium-gray fill with rounded top caps, each separated from the
// next by a thin card-colored gap so the caps read as their own blocks.
//
// Corner blend: the band row itself is painted bg-card (white, see the
// <TableRow> below), so each band's rounded top corners reveal that white — the
// real background behind the header on the white card — and no mismatched sliver
// peeks around the caps.
const BAND_BG = "#DDE1E8"
// Faint, soft vertical rule marking group boundaries in the column-label row and
// the body rows below the bands. (The dark bands themselves are separated by a
// card-colored gap instead — see GROUP_BAND_SEP_STYLE.)
const GROUP_DIVIDER = "#EEF0F4"
const GROUP_BAND_CLASS =
  "rounded-t-md h-8 px-3 text-center text-[11px] font-semibold uppercase tracking-wider text-[#1A2233]"
const GROUP_BAND_STYLE: React.CSSProperties = {
  backgroundColor: BAND_BG,
}
const GROUP_BAND_SEP_STYLE: React.CSSProperties = {
  ...GROUP_BAND_STYLE,
  // 3px card-colored gap between adjacent dark caps so each reads as its own
  // block. Card-white is the true background behind the header, so the gap (and
  // the rounded corners beside it) blend cleanly with no leftover tint.
  borderLeft: "3px solid var(--card)",
}
// Left border for the first column-label cell of each group, aligning with the
// band separator above it to continue the divider down through the second tier.
const GROUP_START_STYLE: React.CSSProperties = {
  borderLeft: `1px solid ${GROUP_DIVIDER}`,
}
// Subtle gray for the second header tier (the column-labels row) so it reads as a
// distinct header strip between the navy bands above and the white data rows
// below. Also applied to that row's sticky Client/Status/Team cells (overriding
// their white frozen background) so they don't flash a white seam when scrolling.
const SUBHEADER_BG = "#F7F8FA"

// Toggleable column sections, in table order. Core (Client + Account Team) is
// always shown and not in this list — it's the locked identity group. `cols` is
// the column count, used for the band colSpan and the empty-state colSpan.
const TOGGLE_SECTIONS = [
  { id: "classification", label: "Classification", cols: 3 },
  { id: "contract", label: "Contract", cols: 5 },
  { id: "meetings", label: "Meetings", cols: 5 },
  { id: "activity", label: "Activity", cols: 2 },
] as const

type SectionId = (typeof TOGGLE_SECTIONS)[number]["id"]
const VALID_SECTION_IDS = new Set<string>(TOGGLE_SECTIONS.map((s) => s.id))
// Default view: Contract + Meetings + Activity on; Classification off.
const DEFAULT_SECTIONS: SectionId[] = ["contract", "meetings", "activity"]

// Frozen Core columns: when the table overflows horizontally, Client, Status and
// Account Team stay pinned on the left. Fixed widths give each subsequent column
// a stable left offset (computed cumulatively below). Header cells sit above body
// cells; the sticky thead (z-20) stays above both so vertical scroll still tucks
// rows under the header.
const CLIENT_COL_W = 200
const STATUS_COL_W = 116
const TEAM_COL_W = 132
// Cumulative left offsets for the three frozen columns.
const STATUS_LEFT = CLIENT_COL_W
const TEAM_LEFT = CLIENT_COL_W + STATUS_COL_W
function frozenStyle(left: number, width: number, z: number): React.CSSProperties {
  return {
    position: "sticky",
    left,
    zIndex: z,
    width,
    minWidth: width,
    maxWidth: width,
    backgroundColor: "var(--card)",
  }
}

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
  const visibleColCount =
    3 +
    TOGGLE_SECTIONS.reduce(
      (n, s) => n + (activeSections.has(s.id) ? s.cols : 0),
      0,
    )

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

  return (
    <>
      <div className="mb-4">
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
        className="flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground"
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
      <div className="flex flex-wrap items-center justify-between gap-2">
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
            className="inline-flex cursor-default items-center gap-1 rounded bg-[#1E2858] px-2.5 py-1 text-xs font-medium text-white opacity-70"
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
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
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

      <div
        className={`${CARD_CLASS} [&_thead_tr:first-child_th:first-child]:rounded-tl-[14px] [&_thead_tr:first-child_th:last-child]:rounded-tr-[14px] [&_tbody_tr:last-child_td:first-child]:rounded-bl-[14px] [&_tbody_tr:last-child_td:last-child]:rounded-br-[14px]`}
      >
        {/* w-auto overrides the shared Table's w-full: width:100% is what makes
            the table stretch to fill the card and (under table-layout:auto) spread
            the leftover width as slack *between* columns — the dead gap between
            Term and Retainer. Sizing to content gives every column a uniform
            padding-only gap; the wrapping div's overflow-x-auto + sticky columns
            handle horizontal scroll when sections make the table wide. */}
        <Table className="w-auto">
          <TableHeader className="sticky top-0 z-20 bg-card">
            {/* Top tier: section bands. Only active sections render; each band's
                colSpan equals its visible column count so it sits exactly over its
                columns. Core (Client, 2 cols) is always shown and frozen left. */}
            <TableRow className="bg-card">
              <TableHead
                colSpan={3}
                className={GROUP_BAND_CLASS}
                style={{ ...GROUP_BAND_STYLE, position: "sticky", left: 0, zIndex: 30 }}
              >
                Client
              </TableHead>
              {show.classification && (
                <TableHead colSpan={3} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                  Classification
                </TableHead>
              )}
              {show.contract && (
                <TableHead colSpan={5} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                  Contract
                </TableHead>
              )}
              {show.meetings && (
                <TableHead colSpan={5} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                  Meetings
                </TableHead>
              )}
              {show.activity && (
                <TableHead colSpan={2} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                  Activity
                </TableHead>
              )}
            </TableRow>
            <TableRow style={{ backgroundColor: SUBHEADER_BG }}>
              {/* Core — frozen left */}
              <TableHead className="h-8 px-2.5" style={{ ...frozenStyle(0, CLIENT_COL_W, 30), backgroundColor: SUBHEADER_BG }}>
                <SortHeader label="Client" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="h-8 px-2.5" style={{ ...frozenStyle(STATUS_LEFT, STATUS_COL_W, 30), backgroundColor: SUBHEADER_BG }}>
                <SortHeader label="Status" sortKey="note_status" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="h-8 px-2.5" style={{ ...frozenStyle(TEAM_LEFT, TEAM_COL_W, 30), backgroundColor: SUBHEADER_BG }}>
                <span className="text-xs font-medium text-muted-foreground">Account Team</span>
              </TableHead>
              {show.classification && (
                <>
                  <TableHead className="h-8 px-2.5" style={GROUP_START_STYLE}>
                    <SortHeader label="Mkt Cap" sortKey="market_cap_label" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader label="Region" sortKey="region_label" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader label="Sector" sortKey="sector_label" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </TableHead>
                </>
              )}
              {show.contract && (
                <>
                  <TableHead className="h-8 px-2.5" style={GROUP_START_STYLE}>
                    <SortHeader label="Term End" sortKey="initial_term_end" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader
                      label="Days Left"
                      sortKey="days_to_expiry"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="center"
                    />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader
                      label="Auto-Renew"
                      sortKey="auto_renew"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="center"
                    />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader label="Term" sortKey="contract_status_label" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader
                      label="Retainer"
                      sortKey="annualized_retainer"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="right"
                    />
                  </TableHead>
                </>
              )}
              {show.meetings && (
                <>
                  <TableHead className="h-8 px-2.5" style={GROUP_START_STYLE}>
                    <SortHeader
                      label="L12M"
                      sortKey="meetings_last_365d"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="center"
                    />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader
                      label="L12M Inst"
                      sortKey="unique_institutions_last_365d"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="center"
                    />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader
                      label="L3M"
                      sortKey="meetings_last_90d"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="center"
                    />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader
                      label="Next 3M"
                      sortKey="meetings_next_3m"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="center"
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
                  <TableHead className="h-8 px-2.5" style={GROUP_START_STYLE}>
                    <SortHeader
                      label="Last Event"
                      sortKey="last_event_date"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead className="h-8 px-2.5">
                    <SortHeader
                      label="Last Note"
                      sortKey="last_note_date"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                  </TableHead>
                </>
              )}
            </TableRow>
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
                      className="px-2.5 py-1 align-top"
                      style={frozenStyle(0, CLIENT_COL_W, 10)}
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
                    <TableCell className="px-2.5 py-1 align-top" style={frozenStyle(STATUS_LEFT, STATUS_COL_W, 10)}>
                      <NoteStatusPill status={r.note_status} date={r.note_status_date} />
                    </TableCell>

                    {/* Account Team — frozen left */}
                    <TableCell className="px-2.5 py-1 align-top" style={frozenStyle(TEAM_LEFT, TEAM_COL_W, 10)}>
                      <AccountTeamAvatars row={r} />
                    </TableCell>

                    {show.classification && (
                      <>
                        {/* Mkt Cap */}
                        <TableCell className="px-2.5 py-1 align-top" style={GROUP_START_STYLE}>{r.market_cap_label ?? "—"}</TableCell>

                        {/* Region */}
                        <TableCell className="px-2.5 py-1 align-top" style={{ maxWidth: 132 }}>
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
                          className="px-2.5 py-1 align-top"
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
                        <TableCell className="px-2.5 py-1 align-top whitespace-nowrap" style={GROUP_START_STYLE}>
                          {inactive ? <ContractDash /> : formatDate(r.initial_term_end)}
                        </TableCell>

                        {/* Days Left */}
                        <TableCell className="px-2.5 py-1 align-top text-center">
                          <DaysLeftPill
                            days={inactive ? null : r.days_to_expiry}
                            hasContract={!!r.has_active_contract}
                            totalContractCount={r.total_contract_count ?? 0}
                          />
                        </TableCell>

                        {/* Auto-Renew */}
                        <TableCell className="px-2.5 py-1 align-top text-center text-base">
                          <AutoRenewFlag value={inactive ? null : r.auto_renew} />
                        </TableCell>

                        {/* Status */}
                        <TableCell
                          className="px-2.5 py-1 align-top"
                          style={{ maxWidth: 124, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={r.contract_status_label ?? ""}
                        >
                          {inactive ? <ContractDash /> : shortenContractTerm(r.contract_status_label)}
                        </TableCell>

                        {/* Annualized Retainer */}
                        <TableCell className="px-2.5 py-1 align-top text-right tabular-nums">
                          {formatCompactDollars(r.annualized_retainer)}
                        </TableCell>
                      </>
                    )}

                    {show.meetings && (
                      <>
                        {/* Mtgs L12M */}
                        <TableCell className="px-2.5 py-1 align-top text-center tabular-nums" style={GROUP_START_STYLE}>{meetings365}</TableCell>

                        {/* Inst L12M */}
                        <TableCell className="px-2.5 py-1 align-top text-center tabular-nums text-muted-foreground">
                          {r.unique_institutions_last_365d ?? 0}
                        </TableCell>

                        {/* Mtgs L3M with velocity */}
                        <TableCell className="px-2.5 py-1 align-top text-center tabular-nums">
                          <span className="inline-flex items-center justify-center gap-1">
                            {velocity && <span style={{ color: velocity.color }}>{velocity.glyph}</span>}
                            <span>{meetings90}</span>
                          </span>
                        </TableCell>

                        {/* Mtgs Next 3M — forward-looking confirmed count */}
                        <TableCell className="px-2.5 py-1 align-top text-center tabular-nums">
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
                        <TableCell className="px-2.5 py-1 align-top" style={GROUP_START_STYLE}>
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
    </>
  )
}

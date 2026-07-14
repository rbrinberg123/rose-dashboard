"use client"

import * as React from "react"
import Link from "next/link"
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
import { StatCard } from "@/components/stat-card"
import { CARD_CLASS, DAYS_LEFT_PILL } from "@/lib/design"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ClientMarketingStatusRow } from "@/lib/types"

const NAVY = "#1E2858"
const ALL = "__all__"

// Two-tier header group bands, mirroring the Portfolio table's look: a dark cap
// over each group of columns, separated by a thin card-colored gap.
const BAND_BG = "#DDE1E8"
const GROUP_BAND_CLASS =
  "rounded-t-md h-8 px-3 text-center text-[11px] font-semibold uppercase tracking-wider text-[#1A2233]"
const GROUP_BAND_STYLE: React.CSSProperties = { backgroundColor: BAND_BG }
const GROUP_BAND_SEP_STYLE: React.CSSProperties = {
  ...GROUP_BAND_STYLE,
  borderLeft: "3px solid var(--card)",
}
// Left rule continuing each group's boundary down through the column-label row
// and the body cells.
const GROUP_DIVIDER = "#EEF0F4"
const GROUP_START_STYLE: React.CSSProperties = {
  borderLeft: `1px solid ${GROUP_DIVIDER}`,
}
const SUBHEADER_BG = "#F7F8FA"

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------
type SortKey =
  | "name"
  | "current_event_name"
  | "next_event_date"
  | "last_event_date"
  | "feedback_collection"
  | "reports_in_creation"
  | "reports_in_review"
  | "report_sent_date"

type SortDir = "asc" | "desc"

// nulls / blanks always sort last; numbers numerically; strings (incl. ISO
// 'YYYY-MM-DD' dates, which are lexicographically chronological) case-folded.
function compareValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  dir: SortDir,
): number {
  const aNull = a == null || a === ""
  const bNull = b == null || b === ""
  if (aNull && bNull) return 0
  if (aNull) return 1
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
      <span>{label}</span>
      <Icon
        className={cn(
          "size-3 shrink-0",
          isActive ? "text-foreground" : "text-muted-foreground/60",
        )}
      />
    </button>
  )
}

// Plain count: 0 reads muted so real work stands out. Used for Report in Review
// (which stays an uncolored count — only the first two lifecycle columns get
// urgency pills).
function CountCell({ n }: { n: number }) {
  return (
    <span className={cn("tabular-nums", n === 0 && "text-muted-foreground")}>{n}</span>
  )
}

// Count as an urgency pill, reusing the shared DAYS_LEFT_PILL palette so it reads
// the same as the Portfolio Days-Left / Profiles day pills. 0 → muted plain
// number (no fill) so the ~2/3 of clients with nothing outstanding recede and the
// real backlogs pop; 1..amberMax → amber; above → red.
function CountPill({ n, amberMax }: { n: number; amberMax: number }) {
  if (n === 0) return <span className="tabular-nums text-muted-foreground">0</span>
  const style = n <= amberMax ? DAYS_LEFT_PILL.amber : DAYS_LEFT_PILL.red
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
      style={{ backgroundColor: style.bg, color: style.fg }}
    >
      {n}
    </span>
  )
}

// "Jun 30" from a 'YYYY-MM-DD' date string, parsed as a UTC calendar date so it
// never drifts a day across zones (the view emits plain date columns).
const SHORT_DAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
})
function fmtShortDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return SHORT_DAY_FMT.format(new Date(Date.UTC(y, m - 1, d)))
}

// Whole-day countdown from today's calendar date to a 'YYYY-MM-DD' due date.
// Negative = overdue. Both sides are UTC midnights of their calendar day, so the
// diff is a clean day count with no partial-day / zone drift.
function daysUntilDate(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  const due = Date.UTC(y, m - 1, d)
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((due - today) / 86_400_000)
}

// Compact urgency chip for a due date: overdue = red, ≤3 days out = amber,
// further = green. Same DAYS_LEFT_PILL palette as the Portfolio / Profiles day
// pills; task-tight, overdue-aware thresholds since report due dates can lapse.
function DueCountdown({ dateStr }: { dateStr: string }) {
  const days = daysUntilDate(dateStr)
  const style =
    days < 0 ? DAYS_LEFT_PILL.red : days <= 3 ? DAYS_LEFT_PILL.amber : DAYS_LEFT_PILL.green
  const label =
    days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "today" : `${days}d`
  return (
    <span
      className="inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium tabular-nums"
      style={{ backgroundColor: style.bg, color: style.fg }}
    >
      {label}
    </span>
  )
}

export function MarketingStatusTable({
  rows,
}: {
  rows: ClientMarketingStatusRow[]
}) {
  const [sortKey, setSortKey] = React.useState<SortKey>("name")
  const [sortDir, setSortDir] = React.useState<SortDir>("asc")
  const [search, setSearch] = React.useState("")
  const [salesLead, setSalesLead] = React.useState<string>(ALL)

  // Distinct Account Managers present in the data, alphabetical — the AM filter's
  // options (same field v_client_portfolio exposes).
  const salesLeads = React.useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.sales_lead_primary_name) set.add(r.sales_lead_primary_name)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [rows])

  function handleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(k)
      setSortDir("asc")
    }
  }

  // Firm-wide summary — static across the search filter, computed over all rows.
  const summary = React.useMemo(() => {
    let liveEvent = 0
    let awaitingCollection = 0
    let inCreation = 0
    let inReview = 0
    for (const r of rows) {
      if (r.current_event_name) liveEvent++
      if (r.feedback_collection > 0) awaitingCollection++
      inCreation += r.reports_in_creation
      inReview += r.reports_in_review
    }
    return { liveEvent, awaitingCollection, inCreation, inReview }
  }, [rows])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (salesLead !== ALL && (r.sales_lead_primary_name ?? "") !== salesLead) return false
      if (q) {
        const name = (r.name ?? "").toLowerCase()
        const ticker = (r.ticker_symbol ?? "").toLowerCase()
        const ev = (r.current_event_name ?? "").toLowerCase()
        if (!name.includes(q) && !ticker.includes(q) && !ev.includes(q)) return false
      }
      return true
    })
  }, [rows, search, salesLead])

  const sorted = React.useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) =>
      compareValues(a[sortKey] as never, b[sortKey] as never, sortDir),
    )
    return arr
  }, [filtered, sortKey, sortDir])

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          title="Client Marketing Status"
          subtitle={`${rows.length.toLocaleString()} active clients — event timeline + feedback-report lifecycle`}
        />
      </div>

      {/* Summary strip — firm-wide, static across the search filter. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard floating label="Clients with a live event" value={summary.liveEvent} />
        <StatCard
          floating
          label="Awaiting feedback collection"
          value={summary.awaitingCollection}
          valueColor="#854F0B"
        />
        <StatCard floating label="Reports in creation" value={summary.inCreation} valueColor="#2D4A8A" />
        <StatCard floating label="Reports in review" value={summary.inReview} valueColor="#0E7C56" />
      </div>

      {/* Filter row */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={salesLead}
          onChange={(e) => setSalesLead(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Account Manager"
        >
          <option value={ALL}>Account Manager (all)</option>
          {salesLeads.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div className="relative ml-auto w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client, ticker, event…"
            className="pl-8"
          />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {filtered.length.toLocaleString()} of {rows.length.toLocaleString()}
        </span>
      </div>

      <div
        className={`overflow-x-auto ${CARD_CLASS} [&_thead_tr:first-child_th:first-child]:rounded-tl-[14px] [&_thead_tr:first-child_th:last-child]:rounded-tr-[14px]`}
      >
        <Table>
          <TableHeader className="sticky top-0 z-20 bg-card">
            {/* Top tier: group bands. */}
            <TableRow className="bg-card">
              <TableHead className={GROUP_BAND_CLASS} style={GROUP_BAND_STYLE}>
                Client
              </TableHead>
              <TableHead colSpan={3} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                Ongoing Events
              </TableHead>
              <TableHead colSpan={4} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                Feedback Report Pipeline
              </TableHead>
            </TableRow>

            {/* Second tier: sortable column labels. */}
            <TableRow style={{ backgroundColor: SUBHEADER_BG }}>
              <TableHead className="h-8 px-2.5">
                <SortHeader label="Client" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="h-8 px-2.5" style={GROUP_START_STYLE}>
                <SortHeader label="Current Event" sortKey="current_event_name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="h-8 px-2.5">
                <SortHeader label="Next Event" sortKey="next_event_date" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="h-8 px-2.5">
                <SortHeader label="Last Event" sortKey="last_event_date" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="h-8 px-2.5" style={GROUP_START_STYLE}>
                <SortHeader label="Feedback Collection" sortKey="feedback_collection" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="center" />
              </TableHead>
              <TableHead className="h-8 px-2.5">
                <SortHeader label="Report in Creation" sortKey="reports_in_creation" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="center" />
              </TableHead>
              <TableHead className="h-8 px-2.5">
                <SortHeader label="Report in Review" sortKey="reports_in_review" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="center" />
              </TableHead>
              <TableHead className="h-8 px-2.5">
                <SortHeader label="Report Sent" sortKey="report_sent_date" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "No active clients on record."
                    : "No clients match the current search."}
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((r) => (
                <TableRow key={r.account_id}>
                  {/* Client */}
                  <TableCell className="px-2.5 py-1.5 align-top">
                    <div className="max-w-[220px] truncate" title={r.name}>
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

                  {/* Current Event — deep-links to Planning's By Event view,
                      pre-selected. Next / Last events stay non-clickable. */}
                  <TableCell
                    className="max-w-[240px] truncate px-2.5 py-1.5 align-top"
                    style={GROUP_START_STYLE}
                    title={r.current_event_name ?? undefined}
                  >
                    {r.current_event_name ? (
                      r.current_event_id ? (
                        <Link
                          href={`/planning-v2?event=${r.current_event_id}`}
                          className="cursor-pointer font-medium hover:underline"
                          style={{ color: NAVY }}
                          title={`Open "${r.current_event_name}" in Planning · By Event`}
                        >
                          {r.current_event_name}
                        </Link>
                      ) : (
                        <span className="font-medium text-foreground">{r.current_event_name}</span>
                      )
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* Next Event */}
                  <TableCell className="whitespace-nowrap px-2.5 py-1.5 align-top tabular-nums">
                    {formatDate(r.next_event_date)}
                  </TableCell>

                  {/* Last Event */}
                  <TableCell className="whitespace-nowrap px-2.5 py-1.5 align-top tabular-nums text-muted-foreground">
                    {formatDate(r.last_event_date)}
                  </TableCell>

                  {/* Feedback Collection — urgency pill (0 muted / 1–3 amber / ≥4 red).
                      When >0, the pill deep-links to this client's open feedbacks on
                      the Feedback Collection page (By client, expanded). */}
                  <TableCell className="px-2.5 py-1.5 align-top text-center" style={GROUP_START_STYLE}>
                    {r.feedback_collection === 0 ? (
                      <CountPill n={0} amberMax={3} />
                    ) : (
                      <Link
                        href={`/feedback?client=${r.account_id}`}
                        title={`View ${r.name}'s open feedbacks`}
                        className="inline-block cursor-pointer rounded-full transition hover:opacity-80 hover:ring-2 hover:ring-black/5"
                      >
                        <CountPill n={r.feedback_collection} amberMax={3} />
                      </Link>
                    )}
                  </TableCell>

                  {/* Report in Creation — count pill (0 muted / 1–2 amber / ≥3 red),
                      with the soonest due date + an urgency countdown chip below. */}
                  <TableCell className="px-2.5 py-1.5 align-top text-center">
                    {r.reports_in_creation === 0 ? (
                      <span className="tabular-nums text-muted-foreground">0</span>
                    ) : (
                      <div className="flex flex-col items-center gap-0.5">
                        <CountPill n={r.reports_in_creation} amberMax={2} />
                        {r.reports_in_creation_due && (
                          <div className="flex items-center gap-1 whitespace-nowrap tabular-nums">
                            <span className="text-[10px] text-muted-foreground">
                              {fmtShortDay(r.reports_in_creation_due)}
                            </span>
                            <DueCountdown dateStr={r.reports_in_creation_due} />
                          </div>
                        )}
                      </div>
                    )}
                  </TableCell>

                  {/* Report in Review — plain count, centered */}
                  <TableCell className="px-2.5 py-1.5 align-top text-center">
                    <CountCell n={r.reports_in_review} />
                  </TableCell>

                  {/* Report Sent */}
                  <TableCell className="whitespace-nowrap px-2.5 py-1.5 align-top tabular-nums">
                    {formatDate(r.report_sent_date)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Check, Download, Printer } from "lucide-react"
import { format } from "date-fns"
import { toast } from "sonner"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ListTitleCard } from "@/components/page-masthead"
import { BRAND_BLUE, CARD_CLASS, STATUS_PILL_LIGHT } from "@/lib/design"
import { cn } from "@/lib/utils"
import {
  baseTicker,
  formatDay,
  formatDaySpan,
  stripTickerPrefix,
} from "@/lib/client-todo-format"
import { exportClientTodoList, ymd } from "@/lib/client-todo-excel"
import {
  EventMeetingsPane,
  type EventMeetingsPaneEvent,
} from "@/components/event-meetings-pane"
import type {
  ClientTodoTableRow,
  ClientTodoReportDetail,
  ClientTodoCollectionDetail,
  ClientTodoTouchDetail,
  MarketingEventMeeting,
} from "@/lib/types"
import { saveClientTodoNote } from "./actions"

const NAVY = "#1E2858"
const ALL = "__all__" // client-manager filter sentinel for "All"

// ---------------------------------------------------------------------------
// Aging thresholds (calendar days since the date). Chosen from the live spread
// so the colours flag genuine outliers rather than the whole book:
//   - touchpoints run at a median of ~6 weeks, so 60/90 marks the slow tail;
//   - data uploads are a much slower cadence (median ~4-5 months), so the same
//     thresholds would paint everything red — 120/180 is the equivalent tail.
// Documented in content/docs/10-to-do-list.md.
// ---------------------------------------------------------------------------
const TOUCH_AMBER_DAYS = 60
const TOUCH_RED_DAYS = 90
const UPLOAD_AMBER_DAYS = 120
const UPLOAD_RED_DAYS = 180

// Two-tier header bands — same treatment as Portfolio / Onboarding.
const BAND_BG = "#DDE1E8"
const GROUP_BAND_CLASS =
  "rounded-t-md h-8 px-3 text-center text-[11px] font-semibold uppercase tracking-wider text-[#1A2233]"
const GROUP_BAND_STYLE: React.CSSProperties = { backgroundColor: BAND_BG }
const GROUP_BAND_SEP_STYLE: React.CSSProperties = {
  ...GROUP_BAND_STYLE,
  borderLeft: "3px solid var(--card)",
}
const GROUP_DIVIDER = "#EEF0F4"
const GROUP_START_STYLE: React.CSSProperties = { borderLeft: `1px solid ${GROUP_DIVIDER}` }
const SUBHEADER_BG = "#F7F8FA"

// Every body cell. This table is a dense worklist — a whole client book is meant
// to be scannable without scrolling — so padding and line-height are squeezed to
// the point where the pills still read cleanly. Change it here, not per cell.
const CELL = "px-2 py-0.5 align-middle text-[11px] leading-[1.4]"
// The five Next-Event cells act as ONE click target that opens the meetings
// pane, so they highlight together — on hover and while their pane is open.
const EVENT_CELL_HOVER = "#EEF2FB"
const EVENT_CELL_SELECTED = "#E3EAF8"
// Pills inside those cells shed their vertical padding to match.
const PILL = "inline-flex items-center rounded-full px-1.5 py-0 text-[11px] font-medium"

// Event stage → pill colour. Same mapping (and the same four semantic buckets)
// as the Client Detail "Marketing Events & Dates" block, so a stage reads the
// same wherever it appears.
const EVENT_STAGE_PILL: Record<string, { bg: string; text: string }> = {
  "Pre-Launch": STATUS_PILL_LIGHT.new,
  "Live Outreach": STATUS_PILL_LIGHT.positive,
  "Meetings Ongoing": STATUS_PILL_LIGHT.positive,
  "Schedule Closed": STATUS_PILL_LIGHT.watch,
  "Preparing Feedback": STATUS_PILL_LIGHT.neutral,
  Complete: STATUS_PILL_LIGHT.neutral,
}

type SortKey =
  | "ticker_symbol"
  | "client_name"
  | "meetings_ytd"
  | "meetings_l12m"
  | "last_touch_date"
  | "last_data_upload_date"
  | "next_event_name"
  | "next_event_state_label"
  | "next_event_start"
  | "next_event_confirmed_meetings"
  | "next_event_open_slots"
  | "open_items"
  | "note"
type SortDir = "asc" | "desc"

// nulls / blanks last; numbers numerically; strings case-folded.
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

/** The value a row sorts by for a given column. */
function sortValue(r: ClientTodoTableRow, key: SortKey): string | number | null {
  if (key === "open_items") return r.open_reports + r.open_collections
  return r[key]
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  align = "left",
  title,
}: {
  label: string
  sortKey: SortKey
  currentKey: SortKey
  currentDir: SortDir
  onSort: (k: SortKey) => void
  align?: "left" | "right" | "center"
  title?: string
}) {
  const isActive = currentKey === sortKey
  const Icon = isActive ? (currentDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      title={title}
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

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/**
 * A date that ages: plain when fresh, amber past the first threshold, red past
 * the second, and red "Never" when the client has no such date at all.
 */
function AgingDateCell({
  ymd,
  days,
  amberAt,
  redAt,
  label,
}: {
  ymd: string | null
  days: number | null
  amberAt: number
  redAt: number
  label: string
}) {
  if (!ymd) {
    const s = STATUS_PILL_LIGHT.atRisk
    return (
      <span
        className={PILL}
        style={{ backgroundColor: s.bg, color: s.text }}
        title={`No ${label} on record`}
      >
        Never
      </span>
    )
  }
  const age = days ?? 0
  const tone = age >= redAt ? STATUS_PILL_LIGHT.atRisk : age >= amberAt ? STATUS_PILL_LIGHT.watch : null
  const text = formatDay(ymd)
  const hint = `${label}: ${text} · ${age.toLocaleString()} days ago`
  if (!tone) {
    return (
      <span className="text-[11px] tabular-nums text-foreground" title={hint}>
        {text}
      </span>
    )
  }
  return (
    <span
      className={cn(PILL, "tabular-nums")}
      style={{ backgroundColor: tone.bg, color: tone.text }}
      title={hint}
    >
      {text}
    </span>
  )
}

/**
 * Last Touch: the aging date, plus the touchpoint behind it on hover/focus.
 * Same group-hover panel treatment as the Feedback cell and the Capacity chart.
 * Focusable so it also opens on click / keyboard, not hover alone.
 */
function LastTouchCell({
  row,
  detail,
}: {
  row: ClientTodoTableRow
  detail: ClientTodoTouchDetail | undefined
}) {
  const date = (
    <AgingDateCell
      ymd={row.last_touch_date}
      days={row.last_touch_days}
      amberAt={TOUCH_AMBER_DAYS}
      redAt={TOUCH_RED_DAYS}
      label="Last touch"
    />
  )
  if (!detail) return date

  const when = detail.scheduled_start
    ? new Date(detail.scheduled_start).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : formatDay(row.last_touch_date)

  return (
    <div className="group relative inline-flex">
      <span tabIndex={0} className="cursor-help outline-none">
        {date}
      </span>
      <div
        className={cn(
          "pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-[280px] rounded-md border bg-white p-2.5 text-left text-[12px] shadow-md",
          "group-hover:block group-focus-within:block",
        )}
        style={{ borderColor: "#E6E9EF" }}
        role="tooltip"
      >
        <div className="mb-1 font-medium" style={{ color: NAVY }}>
          {detail.touchpoint_type_label ?? "Touchpoint"}
        </div>
        {detail.subject ? (
          <div className="mb-1 text-foreground">{detail.subject}</div>
        ) : null}
        <div className="tabular-nums text-muted-foreground">{when}</div>
        {detail.owner_name ? (
          <div className="mt-1 text-muted-foreground">Owner · {detail.owner_name}</div>
        ) : null}
      </div>
    </div>
  )
}

/** Open slots: amber pill when any remain, plain 0, dash when capacity is unset. */
function OpenSlotsCell({ open, total }: { open: number | null; total: number | null }) {
  if (open == null) {
    return (
      <span className="text-muted-foreground" title="No slot capacity set on this event">
        —
      </span>
    )
  }
  const hint = `${open} of ${total ?? "?"} slots open`
  if (open === 0) {
    return (
      <span className="text-[11px] tabular-nums text-muted-foreground" title={hint}>
        0
      </span>
    )
  }
  const s = STATUS_PILL_LIGHT.watch
  return (
    <span
      className={cn(PILL, "tabular-nums")}
      style={{ backgroundColor: s.bg, color: s.text }}
      title={hint}
    >
      {open}
    </span>
  )
}

const CATEGORY_LABEL: Record<string, string> = {
  in_progress: "In progress",
  pending_review: "Pending review",
}

/**
 * The two feedback figures as mini-pills, with a hover panel listing what's
 * behind each. "✓ Clear" when both are zero.
 */
function FeedbackCell({
  reports,
  collections,
  reportDetails,
  collectionDetails,
}: {
  reports: number
  collections: number
  reportDetails: ClientTodoReportDetail[]
  collectionDetails: ClientTodoCollectionDetail[]
}) {
  if (reports === 0 && collections === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Check className="size-3.5" style={{ color: "#2D7A2D" }} strokeWidth={3} />
        Clear
      </span>
    )
  }
  const reportPill = STATUS_PILL_LIGHT.new
  const collectPill = STATUS_PILL_LIGHT.watch
  return (
    <div className="group relative inline-flex items-center gap-1">
      {reports > 0 && (
        <span
          className={cn(PILL, "tabular-nums")}
          style={{ backgroundColor: reportPill.bg, color: reportPill.text }}
        >
          {reports} rep
        </span>
      )}
      {collections > 0 && (
        <span
          className={cn(PILL, "tabular-nums")}
          style={{ backgroundColor: collectPill.bg, color: collectPill.text }}
        >
          {collections} col
        </span>
      )}

      {/* Hover detail — same treatment as the Capacity chart's tooltip. */}
      <div
        className="pointer-events-none absolute right-0 top-full z-30 mt-1 hidden w-[300px] rounded-md border bg-white p-2.5 text-left text-[12px] shadow-md group-hover:block"
        style={{ borderColor: "#E6E9EF" }}
        role="tooltip"
      >
        {reports > 0 && (
          <div className="mb-2">
            <div className="mb-1 font-medium" style={{ color: NAVY }}>
              Open reports ({reports})
            </div>
            {reportDetails.length === 0 ? (
              <div className="text-muted-foreground">—</div>
            ) : (
              reportDetails.map((d, i) => (
                <div key={i} className="truncate text-muted-foreground">
                  {d.event_name ?? "(Unnamed event)"}
                  {d.category ? ` · ${CATEGORY_LABEL[d.category] ?? d.category}` : ""}
                </div>
              ))
            )}
          </div>
        )}
        {collections > 0 && (
          <div>
            <div className="mb-1 font-medium" style={{ color: NAVY }}>
              Open collections ({collections})
            </div>
            {collectionDetails.length === 0 ? (
              <div className="text-muted-foreground">—</div>
            ) : (
              collectionDetails.map((d, i) => (
                <div key={i} className="truncate text-muted-foreground">
                  {formatDay(d.meeting_date ? d.meeting_date.slice(0, 10) : null)} ·{" "}
                  {d.institution_name ?? "—"}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Inline note, saved on BLUR. Last write wins, so the field shows what the
 * server last accepted; a failed save is toasted and the text is left in place
 * so nothing typed is lost.
 */
function NoteCell({ row }: { row: ClientTodoTableRow }) {
  const [value, setValue] = React.useState(row.note ?? "")
  const [saving, setSaving] = React.useState(false)
  // What the server currently holds, so we only write on an actual change.
  const savedRef = React.useRef(row.note ?? "")

  // A revalidate (someone else's save, or our own) brings a fresh row down —
  // adopt it unless the user is mid-edit on a different value.
  React.useEffect(() => {
    const incoming = row.note ?? ""
    if (incoming !== savedRef.current) {
      savedRef.current = incoming
      setValue(incoming)
    }
  }, [row.note])

  async function handleBlur() {
    if (value.trim() === savedRef.current.trim()) return
    setSaving(true)
    const res = await saveClientTodoNote({
      client_account_id: row.account_id,
      note: value,
    })
    setSaving(false)
    if (res.ok) {
      savedRef.current = value.trim()
    } else {
      toast.error(`Could not save note for ${row.client_name}`, {
        description: res.error,
      })
    }
  }

  return (
    <>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        rows={1}
        placeholder="Add a note…"
        aria-label={`Note for ${row.client_name}`}
        title={
          row.note_updated_at
            ? `Last saved ${new Date(row.note_updated_at).toLocaleString()}`
            : undefined
        }
        // Screen-only: a textarea prints as an empty one-line box (its value
        // isn't laid out for paper, and the scroll position clips it), so the
        // Export PDF path hides the control and prints the static twin below.
        data-print="hide"
        className={cn(
          // Single dense line at rest; it grows on focus so a longer note stays
          // comfortable to type without costing every other row height.
          "w-full min-w-[200px] resize-y rounded border border-transparent bg-transparent px-1.5 py-0.5",
          "text-[11px] leading-[1.35] focus:h-16",
          "hover:border-input focus:border-input focus:bg-white focus:outline-none focus:ring-1 focus:ring-ring",
          saving && "opacity-60",
        )}
      />
      {/* Print-only static rendering of the same text — reads `value`, not
          `row.note`, so an edit that hasn't been blurred yet still exports. */}
      <div className="print-only todo-print-note" aria-hidden="true">
        {value}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

export function TodoTable({
  rows,
  reportsByClient,
  collectionsByClient,
  lastTouchByClient,
  meetingsByEvent,
}: {
  rows: ClientTodoTableRow[]
  reportsByClient: Record<string, ClientTodoReportDetail[]>
  collectionsByClient: Record<string, ClientTodoCollectionDetail[]>
  lastTouchByClient: Record<string, ClientTodoTouchDetail>
  meetingsByEvent: Record<string, MarketingEventMeeting[]>
}) {
  // Default sort: client A–Z.
  const [sortKey, setSortKey] = React.useState<SortKey>("client_name")
  const [sortDir, setSortDir] = React.useState<SortDir>("asc")
  const [search, setSearch] = React.useState("")
  const [manager, setManager] = React.useState<string>(ALL)
  // Which row's event cluster is open in the shared pane (null = closed), and
  // which is under the cursor — the latter drives the whole-cluster hover tint,
  // which CSS alone can't do across sibling <td>s.
  const [openEvent, setOpenEvent] = React.useState<EventMeetingsPaneEvent | null>(null)
  const [hoverEventRow, setHoverEventRow] = React.useState<string | null>(null)

  // Filter options come from the rows the viewer already has, so the list can
  // never name a client manager outside their client scope.
  const managers = React.useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.client_manager_name) set.add(r.client_manager_name)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [rows])

  function handleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(k)
      // Names and dates read best ascending; the counts are most useful
      // highest-first.
      const ascFirst: SortKey[] = [
        "client_name",
        "ticker_symbol",
        "next_event_name",
        "next_event_state_label",
        "next_event_start",
        "last_touch_date",
        "last_data_upload_date",
        "note",
      ]
      setSortDir(ascFirst.includes(k) ? "asc" : "desc")
    }
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (manager !== ALL && (r.client_manager_name ?? "") !== manager) return false
      if (!q) return true
      return (
        (r.client_name ?? "").toLowerCase().includes(q) ||
        (r.ticker_symbol ?? "").toLowerCase().includes(q) ||
        (r.next_event_name ?? "").toLowerCase().includes(q)
      )
    })
  }, [rows, search, manager])

  const sorted = React.useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const primary = compareValues(sortValue(a, sortKey), sortValue(b, sortKey), sortDir)
      // Stable tie-break: always fall back to client name A→Z.
      return primary !== 0 ? primary : compareValues(a.client_name, b.client_name, "asc")
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const openItemsCount = React.useMemo(
    () => rows.filter((r) => r.open_reports + r.open_collections > 0).length,
    [rows],
  )

  // ---- Excel export -------------------------------------------------------
  // Exports `sorted` — the CURRENT VIEW (search + Client Manager filter, in the
  // active sort order), not the full table. Those rows came from the
  // client-scoped loader, so the export inherits that scoping. ExcelJS loads
  // lazily inside the handler, so the first click may take a beat; `exporting`
  // disables the button meanwhile. Same pattern as Upcoming Meetings.
  const [exporting, setExporting] = React.useState(false)
  const onExport = React.useCallback(async () => {
    setExporting(true)
    try {
      await exportClientTodoList(sorted)
    } finally {
      setExporting(false)
    }
  }, [sorted])

  // ---- PDF export ---------------------------------------------------------
  // Same mechanism as the Client Portfolio's Export PDF (app/portfolio/
  // portfolio-table.tsx): no PDF library anywhere in the app — it's window.print()
  // over the @media print stylesheet in app/globals.css, which hides the app
  // chrome and reshapes `.todo-print-root` for landscape paper. Because it prints
  // the *rendered* table, the export is the current view (search + Client Manager,
  // in the active sort order) with its pills and colours intact, and it inherits
  // the loader's client scoping for free — nothing is re-fetched.
  //
  // The browser's "Save as PDF" seeds its filename from document.title, so swap
  // the title for the export name across the print call and restore it after.
  const onExportPdf = React.useCallback(() => {
    const previousTitle = document.title
    document.title = `client-todo-list_${ymd(new Date())}`
    window.addEventListener("afterprint", () => {
      document.title = previousTitle
    }, { once: true })
    window.print()
  }, [])

  // Print-only report metadata, built from the *current* filter/sort state so the
  // exported PDF's header describes exactly what's on screen. Only non-default
  // filters are listed; the row count always shows. Mirrors Portfolio's header.
  const genDate = format(new Date(), "MMMM d, yyyy")
  const activeFilterParts: string[] = []
  if (manager !== ALL) activeFilterParts.push(`Client Manager = ${manager}`)
  const searchText = search.trim()
  if (searchText) activeFilterParts.push(`"${searchText}"`)
  const rowCountLabel = `${sorted.length} ${sorted.length === 1 ? "client" : "clients"}`
  const filterSummary = activeFilterParts.length
    ? `Filters: ${activeFilterParts.join(" · ")} · ${rowCountLabel}`
    : rowCountLabel

  const headerProps = {
    currentKey: sortKey,
    currentDir: sortDir,
    onSort: handleSort,
  }

  return (
    <div className="todo-print-root">
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
                Client To-Do List
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
          title="To-Do List"
          subtitle={`${rows.length.toLocaleString()} active clients · ${openItemsCount.toLocaleString()} with open feedback items`}
        />
      </div>

      {/* Screen-only: the filter/search/export controls are chrome, not report
          content. On paper the print header above states the same filters. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 no-print">
        <select
          value={manager}
          onChange={(e) => setManager(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Client Manager"
        >
          <option value={ALL}>Client Manager (all)</option>
          {managers.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        {/* Right-hand cluster — kept in its own flex box so the count, search
            and Export stay together and Export is always the last (top-right)
            control rather than being pushed around by wrapping. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {filtered.length.toLocaleString()} of {rows.length.toLocaleString()}
          </span>

          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search client, ticker, event…"
              className="pl-8"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onExport}
            disabled={exporting || sorted.length === 0}
            className="shrink-0 whitespace-nowrap"
            title="Download the rows shown below as an Excel file"
          >
            <Download />
            {exporting ? "Exporting…" : "Export to Excel"}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onExportPdf}
            disabled={sorted.length === 0}
            className="shrink-0 whitespace-nowrap"
            title="Print the rows shown below to a landscape PDF"
          >
            <Printer />
            Export PDF
          </Button>
        </div>
      </div>

      <div
        className={`overflow-x-auto ${CARD_CLASS} [&_thead_tr:first-child_th:first-child]:rounded-tl-[14px] [&_thead_tr:first-child_th:last-child]:rounded-tr-[14px]`}
      >
        <Table className="min-w-[1180px]">
          <TableHeader className="sticky top-0 z-20 bg-card">
            {/* Top tier: group bands. */}
            <TableRow className="bg-card">
              <TableHead colSpan={1} className={GROUP_BAND_CLASS} style={GROUP_BAND_STYLE}>
                Client
              </TableHead>
              <TableHead colSpan={2} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                Meetings
              </TableHead>
              <TableHead colSpan={2} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                Touchpoints
              </TableHead>
              <TableHead colSpan={5} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                Current & Upcoming Event
              </TableHead>
              <TableHead colSpan={1} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                Feedback
              </TableHead>
              <TableHead colSpan={1} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                Notes
              </TableHead>
            </TableRow>

            {/* Second tier: sortable column labels. */}
            <TableRow style={{ backgroundColor: SUBHEADER_BG }}>
              <TableHead className="h-7 px-2">
                <SortHeader
                  label="Ticker"
                  sortKey="ticker_symbol"
                  title="Client ticker — links to Client Detail; hover for the full client name"
                  {...headerProps}
                />
              </TableHead>

              <TableHead className="h-7 px-2" style={GROUP_START_STYLE}>
                <SortHeader
                  label="YTD"
                  sortKey="meetings_ytd"
                  align="center"
                  title="Confirmed meetings since Jan 1 of this year"
                  {...headerProps}
                />
              </TableHead>
              <TableHead className="h-7 px-2">
                <SortHeader
                  label="L12M"
                  sortKey="meetings_l12m"
                  align="center"
                  title="Confirmed meetings in the trailing 12 months"
                  {...headerProps}
                />
              </TableHead>

              <TableHead className="h-7 px-2" style={GROUP_START_STYLE}>
                <SortHeader
                  label="Last Touch"
                  sortKey="last_touch_date"
                  title="Most recent CRM touchpoint activity"
                  {...headerProps}
                />
              </TableHead>
              <TableHead className="h-7 px-2">
                <SortHeader
                  label="Last Upload"
                  sortKey="last_data_upload_date"
                  title="Most recent completed Outreach → Data Upload task"
                  {...headerProps}
                />
              </TableHead>

              <TableHead className="h-7 px-2" style={GROUP_START_STYLE}>
                <SortHeader
                  label="Current & Upcoming Event"
                  sortKey="next_event_name"
                  {...headerProps}
                />
              </TableHead>
              <TableHead className="h-7 px-2">
                <SortHeader label="Status" sortKey="next_event_state_label" {...headerProps} />
              </TableHead>
              <TableHead className="h-7 px-2">
                <SortHeader
                  label="Date"
                  sortKey="next_event_start"
                  title="The event's meeting window"
                  {...headerProps}
                />
              </TableHead>
              <TableHead className="h-7 px-2">
                <SortHeader
                  label="Mtgs"
                  sortKey="next_event_confirmed_meetings"
                  align="center"
                  title="Confirmed meetings on this event"
                  {...headerProps}
                />
              </TableHead>
              <TableHead className="h-7 px-2">
                <SortHeader
                  label="Open Slots"
                  sortKey="next_event_open_slots"
                  align="center"
                  title="Event slots minus confirmed meetings"
                  {...headerProps}
                />
              </TableHead>

              <TableHead className="h-7 px-2" style={GROUP_START_STYLE}>
                <SortHeader
                  label="Open Items"
                  sortKey="open_items"
                  align="center"
                  title="Open feedback reports + collections — hover a row for detail"
                  {...headerProps}
                />
              </TableHead>

              <TableHead className="h-7 px-2" style={GROUP_START_STYLE}>
                <SortHeader label="Notes" sortKey="note" {...headerProps} />
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="h-32 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "No active clients."
                    : "No clients match the current search."}
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((r) => {
                const stage = r.next_event_state_label?.trim()
                // The five Next-Event cells behave as one button: same click,
                // same hover, same selected tint. Only rows that actually have
                // an event are clickable.
                const hasEvent = Boolean(r.next_event_id)
                const eventSelected = openEvent?.eventId === r.next_event_id
                const eventHovered = hoverEventRow === r.account_id
                const eventCell = (extra?: string): string =>
                  cn(CELL, extra, hasEvent && "cursor-pointer")
                const eventCellStyle = (base?: React.CSSProperties): React.CSSProperties => ({
                  ...base,
                  ...(hasEvent && eventSelected
                    ? { backgroundColor: EVENT_CELL_SELECTED }
                    : hasEvent && eventHovered
                      ? { backgroundColor: EVENT_CELL_HOVER }
                      : null),
                })
                const eventCellProps = hasEvent
                  ? {
                      onClick: () =>
                        setOpenEvent({
                          eventId: r.next_event_id!,
                          eventName: r.next_event_name ?? "Event",
                          dateSpan: formatDaySpan(r.next_event_start, r.next_event_end),
                        }),
                      onMouseEnter: () => setHoverEventRow(r.account_id),
                      onMouseLeave: () =>
                        setHoverEventRow((cur) => (cur === r.account_id ? null : cur)),
                    }
                  : {}
                const stagePill =
                  (stage && EVENT_STAGE_PILL[stage]) || STATUS_PILL_LIGHT.neutral
                return (
                  <TableRow key={r.account_id}>
                    {/* Ticker — the row's identity now that Client is gone:
                        links to Client Detail, full client name on hover. */}
                    <TableCell className={CELL}>
                      <Link
                        href={`/client-detail?account_id=${r.account_id}`}
                        title={r.client_name}
                        // Inherits the table's own font family and size (no
                        // monospace face) — just bold, in the brand link blue.
                        className="font-semibold hover:underline"
                        style={{ color: BRAND_BLUE }}
                      >
                        {r.ticker_symbol ? baseTicker(r.ticker_symbol) : r.client_name}
                      </Link>
                    </TableCell>

                    {/* Meetings */}
                    <TableCell
                      className={cn(CELL, "text-center tabular-nums")}
                      style={GROUP_START_STYLE}
                    >
                      {r.meetings_ytd}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-center tabular-nums")}>
                      {r.meetings_l12m}
                    </TableCell>

                    {/* Touchpoints */}
                    <TableCell className={CELL} style={GROUP_START_STYLE}>
                      <LastTouchCell row={r} detail={lastTouchByClient[r.account_id]} />
                    </TableCell>
                    <TableCell className={CELL}>
                      <AgingDateCell
                        ymd={r.last_data_upload_date}
                        days={r.last_data_upload_days}
                        amberAt={UPLOAD_AMBER_DAYS}
                        redAt={UPLOAD_RED_DAYS}
                        label="Last data upload"
                      />
                    </TableCell>

                    {/* Next event — the whole five-cell cluster is ONE click
                        target opening the shared confirmed-meetings pane. The
                        name truncates, full text on hover. */}
                    <TableCell
                      className={eventCell()}
                      style={eventCellStyle(GROUP_START_STYLE)}
                      {...eventCellProps}
                      {...(hasEvent
                        ? {
                            role: "button" as const,
                            tabIndex: 0,
                            "aria-label": `Show confirmed meetings for ${r.next_event_name ?? "this event"}`,
                            onKeyDown: (e: React.KeyboardEvent) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                eventCellProps.onClick?.()
                              }
                            },
                          }
                        : {})}
                    >
                      {r.next_event_name ? (
                        <div
                          className="max-w-[150px] truncate text-[11px]"
                          title={r.next_event_name}
                        >
                          {stripTickerPrefix(r.next_event_name, r.ticker_symbol)}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">None</span>
                      )}
                    </TableCell>
                    <TableCell className={eventCell()} style={eventCellStyle()} {...eventCellProps}>
                      {stage ? (
                        <span
                          className={PILL}
                          style={{ backgroundColor: stagePill.bg, color: stagePill.text }}
                        >
                          {stage}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={eventCell("whitespace-nowrap text-[11px] tabular-nums")}
                      style={eventCellStyle()}
                      {...eventCellProps}
                    >
                      {r.next_event_id
                        ? formatDaySpan(r.next_event_start, r.next_event_end)
                        : "—"}
                    </TableCell>
                    <TableCell
                      className={eventCell("text-center tabular-nums")}
                      style={eventCellStyle()}
                      {...eventCellProps}
                    >
                      {r.next_event_id ? r.next_event_confirmed_meetings : "—"}
                    </TableCell>
                    <TableCell
                      className={eventCell("text-center")}
                      style={eventCellStyle()}
                      {...eventCellProps}
                    >
                      {r.next_event_id ? (
                        <OpenSlotsCell
                          open={r.next_event_open_slots}
                          total={r.next_event_total_slots}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    {/* Feedback */}
                    <TableCell
                      className={cn(CELL, "text-center")}
                      style={GROUP_START_STYLE}
                    >
                      <FeedbackCell
                        reports={r.open_reports}
                        collections={r.open_collections}
                        reportDetails={reportsByClient[r.account_id] ?? []}
                        collectionDetails={collectionsByClient[r.account_id] ?? []}
                      />
                    </TableCell>

                    {/* Notes */}
                    <TableCell
                      className={cn(CELL, "align-top", "todo-print-note-cell")}
                      style={GROUP_START_STYLE}
                    >
                      <NoteCell row={r} />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* The shared right-side pane — the same component Client Detail's
          Marketing Events block opens, fed by the same event→confirmed-meetings
          query. Clicking another row's cluster just swaps `openEvent`, so the
          pane re-renders with that event's meetings. */}
      {/* no-print: if the pane happens to be open when someone exports, it's a
          screen affordance, not part of the report. */}
      <div className="no-print">
        <EventMeetingsPane
          event={openEvent}
          meetings={openEvent ? meetingsByEvent[openEvent.eventId] ?? [] : []}
          onClose={() => setOpenEvent(null)}
        />
      </div>
    </div>
  )
}

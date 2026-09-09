"use client"

import * as React from "react"
import Link from "next/link"
import { Download, PanelRightOpen, Search, X } from "lucide-react"

import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import { ListTitleCard } from "@/components/page-masthead"
import { SortHeader } from "@/components/sort-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  GroupBandRow,
  GradientSweepRow,
  SUBHEADER_BG,
  SectionDivider,
  BODY_SECTION_START_STYLE,
  type GroupBand,
} from "@/components/table-group-header"
import { BRAND_BLUE, CANVAS, CARD_CLASS } from "@/lib/design"
import { exportAdminMeetings } from "@/lib/admin-meetings-excel"
import type { MeetingRecord } from "@/lib/meeting-record"
import { loadMeetingRecord } from "./actions"
import { MeetingRecordPane } from "./meeting-record-pane"
import type { AdminMeetingRow } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * The all-CRM Meetings table. Every meeting, no scoping — see the security note
 * in app/meetings/page.tsx; this component only renders what it is handed.
 *
 * 10k+ rows, so the body is WINDOWED: only the slice of rows near the scroll
 * position is in the DOM, with two spacer rows standing in for everything above
 * and below. Sorting and filtering run over the full array (cheap — plain JS on
 * ~10k objects); it is only the rendering that is bounded.
 */

// Row geometry. ROW_H must match the rendered row height exactly or the spacers
// drift out of step with the scroll position and the window shows the wrong
// slice. It is enforced on every row via an inline height, not left to content.
// 30px is the dense floor: a 24px avatar circle plus the cells' py-0.5 is 28.
const ROW_H = 30
const OVERSCAN = 12

/**
 * THE SCROLL CONTAINER IS THE SHARED <Table>'S OWN WRAPPER, NOT A DIV OF OURS.
 *
 * components/ui/table.tsx renders `<div data-slot="table-container"
 * class="relative w-full overflow-x-auto">` around the <table>. `overflow-x:
 * auto` makes that div a scroll container on BOTH axes as far as sticky
 * positioning is concerned, so a `sticky top-0` <thead> anchors to IT — not to
 * any scroller we wrap around it. Give it no bounded height and it never scrolls
 * vertically, the sticky never engages, and the header scrolls away with the
 * body. That was the bug.
 *
 * So the height and overflow-y go ON that container (via these arbitrary
 * variants, the same way Portfolio and the To-Do list do it), and the scroll
 * listener + ResizeObserver attach to it too. Do not reintroduce an outer
 * scrolling div: it would re-break the header.
 */
const SCROLLER_CLASSES =
  "[&_[data-slot=table-container]]:h-[calc(100vh-16rem)] " +
  "[&_[data-slot=table-container]]:min-h-[300px] " +
  "[&_[data-slot=table-container]]:overflow-y-auto"

// Only used for the first paint, before the ResizeObserver reports the real height.
const VIEWPORT_H_FALLBACK = 560

// Eastern (the firm's operating day), in the compact MM/dd/yy shape the other
// tables use — see DATE_FMT in app/feedback-manager/feedback-manager-view.tsx.
// Two formatters rather than one dateStyle/timeStyle call, because a combined
// en-US format joins them with a comma ("11/18/26, 11:30 AM") and the column is
// narrow enough that the comma is worth losing.
const EASTERN_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "numeric",
  day: "numeric",
  year: "2-digit",
})
const EASTERN_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
})

/** "11/18/26 11:30 AM" — Eastern. Display only; sorting uses the raw timestamp. */
function formatEastern(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return `${EASTERN_DATE.format(d)} ${EASTERN_TIME.format(d)}`
}

// Eastern calendar day as YYYY-MM-DD. en-CA yields exactly that shape, and
// YYYY-MM-DD strings compare lexicographically, so plain string comparison is
// also correct date comparison — the same helper shape as EASTERN_YMD in
// app/client-detail/client-detail-view.tsx.
const EASTERN_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})
function easternDay(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : EASTERN_YMD.format(d)
}

/**
 * True when the meeting has nobody hosting it.
 *
 * NOTE this reads the resolved host NAME, not host_id — the view exposes
 * `host_names` (the flattened host plus any second host from _raw) and not the
 * id. In practice the name is the Dynamics formatted value of the same lookup,
 * so the two agree; a meeting carrying a host_id whose name failed to resolve
 * would read as unassigned here. Expose host_id on v_admin_meetings_all if that
 * ever needs to be exact.
 */
function hasNoHost(r: AdminMeetingRow): boolean {
  return !(r.host_names ?? "").trim()
}

/**
 * The "Pending" meeting status.
 *
 * UNCONFIRMED LABEL: only 'Confirmed' and 'Cancelled' appear anywhere in this
 * repo, so the exact stored spelling of the pending state could not be verified
 * from code. Matched case-insensitively on the "pending" prefix, so a stored
 * "Pending", "pending" or "Pending Confirmation" all qualify. The dropdown shows
 * each preset's row count, so a mismatch surfaces immediately as "Pending
 * status (0)" rather than silently returning nothing. If the real label shares
 * no prefix with "pending", change this one predicate.
 */
function isPendingStatus(label: string | null): boolean {
  return (label ?? "").trim().toLowerCase().startsWith("pending")
}

/** The View dropdown's preset filters. `all` is the default — the page's point. */
type PresetKey = "all" | "today" | "pending" | "upcoming" | "upcoming_no_host"

const PRESETS: {
  key: PresetKey
  label: string
  /** `todayEt` is the Eastern calendar day, passed in so it is computed once. */
  match: (r: AdminMeetingRow, todayEt: string) => boolean
}[] = [
  { key: "all", label: "All meetings", match: () => true },
  {
    key: "today",
    label: "Happening today",
    match: (r, todayEt) => easternDay(r.meeting_date) === todayEt,
  },
  {
    key: "pending",
    label: "Pending status",
    match: (r) => isPendingStatus(r.meeting_status_label),
  },
  {
    key: "upcoming",
    label: "Upcoming (today or later)",
    match: (r, todayEt) => {
      const d = easternDay(r.meeting_date)
      return d !== null && d >= todayEt
    },
  },
  {
    key: "upcoming_no_host",
    label: "Upcoming, no host assigned",
    match: (r, todayEt) => {
      const d = easternDay(r.meeting_date)
      return d !== null && d >= todayEt && hasNoHost(r)
    },
  },
]

/**
 * Per-column colours for the staff avatar circles, taken from the same navy→teal
 * ramp as ACCOUNT_TEAM_ROLES in app/portfolio/portfolio-table.tsx — so a circle
 * here is visually the same object as a circle on Portfolio, Profiles or
 * Onboarding. One hue per column rather than per person, which is what makes the
 * four columns readable at a glance once the names are gone. Light teal takes
 * dark text, exactly as it does on Portfolio.
 */
const STAFF_ROLES = {
  host: { role: "Host", bg: "#1E2858", fg: "#FFFFFF" },
  feedback: { role: "Feedback", bg: "#3D5599", fg: "#FFFFFF" },
  booker: { role: "Booked by", bg: "#1C8C9C", fg: "#FFFFFF" },
  onBehalf: { role: "On behalf of", bg: "#4FC6BC", fg: "#0A3B36" },
} as const

/**
 * Render one staff cell as the shared initials-circle cluster.
 *
 * A cell may hold more than one person — Host especially, where the view
 * concatenates hosts with ", " — so the string is split and each person becomes
 * their own circle. AccountTeamAvatars then owns everything else: the 24px
 * overlapping circles, the initials (including the global KMu/KMi
 * disambiguation via lookupInitials), and the per-circle "Role: Full Name"
 * tooltip. Nothing about that logic is duplicated here.
 *
 * Returns undefined for a blank cell so the Cell falls through to its em dash.
 */
function staffAvatars(
  spec: { role: string; bg: string; fg: string },
  value: string | null,
): React.ReactNode | undefined {
  if (!value) return undefined
  const names = value
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
  if (names.length === 0) return undefined
  return <TeamAvatars members={names.map((name) => ({ ...spec, name }))} />
}

type SortKey =
  | "meeting_type_label"
  | "meeting_status_label"
  | "meeting_date"
  | "client_account_name"
  | "event_name"
  | "institution_name"
  | "investor_name"
  | "host_names"
  | "feedback_name"
  | "booker_name"
  | "on_behalf_of"
  | "calendar_label"
  | "feedback_bda_label"
  | "fb_received"

type SortState = { key: SortKey; dir: "asc" | "desc" }

/** The 14 CRM columns, in the order the Dynamics "Investor Meetings (All)" view shows them. */
const COLUMNS: {
  key: SortKey
  label: string
  width: string
  title?: string
}[] = [
  { key: "meeting_type_label", label: "Meeting Type", width: "110px" },
  { key: "meeting_status_label", label: "Meeting Status", width: "125px" },
  {
    key: "meeting_date",
    label: "Date",
    width: "130px",
    title: "Meeting date and time, Eastern",
  },
  {
    key: "client_account_name",
    label: "Client",
    width: "200px",
    title: "Links to the client's detail page",
  },
  { key: "event_name", label: "Event", width: "220px" },
  { key: "institution_name", label: "Institution", width: "200px" },
  // Investor stays a FULL name on purpose: it is the primary external
  // identifier for the row, not internal staff.
  { key: "investor_name", label: "Investor", width: "180px" },
  // The four staff columns render initial-circle avatars (full name on hover),
  // which is what lets them be this narrow. Their floor is the HEADER text, not
  // the circles: two overlapping 24px circles need only 40px.
  {
    key: "host_names",
    label: "Host",
    width: "76px",
    title: "All hosts on the meeting — initials, full name on hover",
  },
  {
    key: "feedback_name",
    label: "Feedback",
    width: "88px",
    title: "Feedback assignee (bcs_feedback) — initials, full name on hover",
  },
  {
    key: "booker_name",
    label: "Booked By",
    width: "88px",
    title: "Initials — full name on hover",
  },
  {
    key: "on_behalf_of",
    label: "On Behalf Of",
    width: "96px",
    title: "Initials — full name on hover",
  },
  { key: "calendar_label", label: "Calendar", width: "150px" },
  { key: "feedback_bda_label", label: "FB in BDA", width: "110px" },
  { key: "fb_received", label: "FB Rec'd", width: "110px" },
]

/**
 * Did this click land on something that handles its own activation?
 *
 * The row opens the record drawer, but the Client link must navigate and the
 * open-record button must open the drawer once, not twice. Rather than hanging
 * stopPropagation off each control — which every future control would have to
 * remember to do — the row asks whether the click landed inside an interactive
 * element and stands down if so. Anything added later (a link, a button, a
 * checkbox, a select) is covered without touching this row handler.
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("a, button, input, select, textarea, label, [role=button], [role=link]") !== null
  )
}

/** Column index at which each header band starts — places the vertical dividers. */
const BAND_STARTS = new Set([3, 7, 11])

// Header bands, grouping the 14 columns into the four things they actually
// describe. The last band absorbs the trailing open-record column, so the
// gradient sweep always spans the full table width.
const BANDS: GroupBand[] = [
  { key: "what", label: "Meeting", colSpan: 3 },
  { key: "who", label: "Client & Counterparty", colSpan: 4 },
  { key: "people", label: "People", colSpan: 4 },
  { key: "workflow", label: "Workflow", colSpan: 4 },
]

/**
 * The text columns the keyword box searches. Dates are excluded on purpose: a
 * term like "Sep" would match a twelfth of the table and tell you nothing.
 */
const SEARCH_KEYS: SortKey[] = [
  "meeting_type_label",
  "meeting_status_label",
  "client_account_name",
  "event_name",
  "institution_name",
  "investor_name",
  "host_names",
  "feedback_name",
  "booker_name",
  "on_behalf_of",
  "calendar_label",
  "feedback_bda_label",
  "fb_received",
]

export function MeetingsView({
  rows,
  crmBase,
}: {
  rows: AdminMeetingRow[]
  crmBase: string | null
}) {
  const [query, setQuery] = React.useState("")
  const [preset, setPreset] = React.useState<PresetKey>("all")
  // Default sort matches the CRM view: newest meeting first.
  const [sort, setSort] = React.useState<SortState>({
    key: "meeting_date",
    dir: "desc",
  })
  const [scrollTop, setScrollTop] = React.useState(0)
  const [exporting, setExporting] = React.useState(false)

  // The open meeting record. The list is never unmounted while the drawer is up,
  // so its scroll position and virtualization window survive open/swap/close.
  // `openId` is what the drawer keys on: clicking a second row swaps the
  // contents rather than stacking a second drawer.
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<MeetingRecord | null>(null)
  const [recordError, setRecordError] = React.useState<string | null>(null)

  /** Open a record — or swap to another. Clearing happens HERE, in the event
   *  handler, not in the effect below: doing it in the effect would be deriving
   *  state from state, which cascades renders (and React's lint rule flags it).
   *  Clearing on open is also what makes a swap show the loading state rather
   *  than the previous meeting's values under the new one's header. */
  const openRecord = React.useCallback((id: string) => {
    setRecord(null)
    setRecordError(null)
    setOpenId(id)
  }, [])

  const closeRecord = React.useCallback(() => {
    setRecord(null)
    setRecordError(null)
    setOpenId(null)
  }, [])

  // The effect owns only the async fetch — every setState here is in a callback.
  // `cancelled` drops a slow response for a record the user already navigated
  // away from, so an old fetch can never overwrite a newer one.
  React.useEffect(() => {
    if (!openId) return
    let cancelled = false
    loadMeetingRecord(openId).then((res) => {
      if (cancelled) return
      if (res.ok) setRecord(res.data ?? null)
      else setRecordError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [openId])

  /** The list row the drawer was opened from — supplies the event name, which
   *  lives on the event, not on public.meetings. */
  const openRow = React.useMemo(
    () => (openId ? (rows.find((r) => r.meeting_id === openId) ?? null) : null),
    [rows, openId],
  )
  // Wraps the shared <Table>; the real scroll element is the table-container
  // inside it (see SCROLLER_CLASSES), which is what we listen to and measure.
  const cardRef = React.useRef<HTMLDivElement>(null)
  const scrollerRef = React.useRef<HTMLElement | null>(null)

  const [viewportH, setViewportH] = React.useState(VIEWPORT_H_FALLBACK)
  React.useEffect(() => {
    const el = cardRef.current?.querySelector<HTMLElement>("[data-slot=table-container]")
    if (!el) return
    scrollerRef.current = el

    // Scroll drives the virtualization window; height feeds its size. Both come
    // off the same element the sticky header anchors to, so they cannot disagree.
    const onScroll = () => setScrollTop(el.scrollTop)
    el.addEventListener("scroll", onScroll, { passive: true })

    const sync = () => setViewportH(el.clientHeight)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)

    return () => {
      el.removeEventListener("scroll", onScroll)
      ro.disconnect()
      scrollerRef.current = null
    }
  }, [])

  // Eastern "today", fixed for the life of the mount. The page is force-dynamic
  // and nobody leaves an admin dump open across midnight; recomputing per render
  // would just make the memos below churn.
  const todayEt = React.useMemo(() => EASTERN_YMD.format(new Date()), [])

  // Row count per preset, over the FULL set (not the keyword-filtered one) so the
  // dropdown labels hold still while someone types. Also the diagnostic for the
  // unconfirmed Pending label — a 0 there means the predicate needs correcting.
  const presetCounts = React.useMemo(() => {
    const out = {} as Record<PresetKey, number>
    for (const p of PRESETS) out[p.key] = rows.filter((r) => p.match(r, todayEt)).length
    return out
  }, [rows, todayEt])

  // Precompute one lower-cased haystack per row so a keystroke does not re-read
  // and re-case 13 fields across 10k rows.
  const haystacks = React.useMemo(
    () =>
      rows.map((r) =>
        SEARCH_KEYS.map((k) => r[k] ?? "")
          .join(" ")
          .toLowerCase(),
      ),
    [rows],
  )

  // Preset AND keyword. Both are applied in one pass over the original array so
  // the haystack index stays aligned with the row index.
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    // Every whitespace-separated term must appear somewhere in the row, so
    // "cancelled fidelity" narrows the set instead of widening it.
    const terms = q ? q.split(/\s+/) : []
    const match = PRESETS.find((p) => p.key === preset)?.match
    if (!terms.length && (!match || preset === "all")) return rows
    return rows.filter(
      (r, i) =>
        (preset === "all" || !match || match(r, todayEt)) &&
        terms.every((t) => haystacks[i].includes(t)),
    )
  }, [rows, haystacks, query, preset, todayEt])

  const sorted = React.useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1
    const out = [...filtered]
    out.sort((a, b) => {
      const va = a[sort.key]
      const vb = b[sort.key]
      // Nulls always sort last, in either direction — an empty cell is never
      // "the most recent" or "first alphabetically", it is just missing.
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const c =
        sort.key === "meeting_date"
          ? new Date(va).getTime() - new Date(vb).getTime()
          : String(va).localeCompare(String(vb))
      return c * dir
    })
    return out
  }, [filtered, sort])

  /** Jump back to the top whenever the row set or its order changes — otherwise
   *  the scroll position points into a slice that no longer means anything. */
  const resetScroll = React.useCallback(() => {
    setScrollTop(0)
    scrollerRef.current?.scrollTo({ top: 0 })
  }, [])

  const toggleSort = React.useCallback(
    (key: SortKey) => {
      resetScroll()
      setSort((s) =>
        s.key === key
          ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
          : // Dates open newest-first; text opens A–Z. Same as every other table here.
            { key, dir: key === "meeting_date" ? "desc" : "asc" },
      )
    },
    [resetScroll],
  )

  // The visible window: which slice of `sorted` is actually mounted.
  const total = sorted.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
  const visible = sorted.slice(first, last)
  const padTop = first * ROW_H
  const padBottom = Math.max(0, (total - last) * ROW_H)

  // +1 for the trailing open-record column, which is always rendered.
  const colCount = COLUMNS.length + 1

  async function onExport() {
    setExporting(true)
    try {
      await exportAdminMeetings(sorted)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          eyebrow="Admin · Hidden pages"
          title="Meetings"
          subtitle="Every meeting in the CRM — all statuses, all dates, active and deactivated. No row scoping is applied, so this page is super-user only."
        />
      </div>

      {/* Toolbar, left to right: View preset → count → keyword → Export.
          Sticky so it survives any page-level scroll on a short viewport. The
          negative margins let its opaque canvas background span the full width
          of PageShell's p-6, so rows can't show through beside it. */}
      <div
        className="sticky top-0 z-30 -mx-6 mb-3 flex flex-wrap items-center gap-3 px-6 py-2"
        style={{ background: CANVAS }}
      >
        {/* Preset views, first — it frames what the count then reports. Counts
            are over the full set, so they hold still while someone types in the
            keyword box — and a "Pending status (0)" is the tell that the
            unconfirmed status label needs correcting. */}
        <label htmlFor="mtg-view" className="sr-only">
          View
        </label>
        <select
          id="mtg-view"
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value as PresetKey)
            resetScroll()
          }}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label} ({presetCounts[p.key].toLocaleString()})
            </option>
          ))}
        </select>

        <div className="text-sm font-medium tabular-nums">
          {total.toLocaleString()}
          <span className="ml-1 font-normal text-muted-foreground">
            {total === 1 ? "meeting" : "meetings"}
          </span>
          {total !== rows.length && (
            <span className="ml-1 font-normal text-muted-foreground">
              of {rows.length.toLocaleString()}
            </span>
          )}
        </div>

        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              resetScroll()
            }}
            placeholder="Filter by keyword"
            aria-label="Filter meetings by keyword"
            className="h-9 pl-8 pr-8"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("")
                resetScroll()
              }}
              aria-label="Clear filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onExport}
          disabled={exporting || total === 0}
          className="ml-auto cursor-pointer"
        >
          <Download />
          {exporting ? "Exporting…" : "Export to Excel"}
        </Button>
      </div>

      {/* The scroll element is the shared Table's OWN table-container (see
          SCROLLER_CLASSES) — height-bounded there, so the sticky <thead> has a
          real scrolling ancestor to stick to. overflow-hidden on the card keeps
          the 14px corners so rows pass behind the curve. */}
      <div ref={cardRef} className={`${CARD_CLASS} overflow-hidden ${SCROLLER_CLASSES}`}>
        <Table className="min-w-[1700px]">
          <TableHeader className="sticky top-0 z-20 bg-card [&_tr]:border-b-0 [&_th]:bg-card">
            {/* Tier 1: unfilled navy section bands (shared with Portfolio / To-Do). */}
            <GroupBandRow bands={BANDS} />

            {/* Tier 2: the sortable column labels. */}
            <TableRow className="border-b-0" style={{ backgroundColor: SUBHEADER_BG }}>
              {COLUMNS.map((col, i) => (
                <TableHead
                  key={col.key}
                  className={cn("h-7 px-2", BAND_STARTS.has(i) && "relative")}
                  style={{ width: col.width, minWidth: col.width }}
                >
                  {BAND_STARTS.has(i) && <SectionDivider />}
                  <SortHeader
                    label={col.label}
                    title={col.title}
                    isSorted={sort.key === col.key ? sort.dir : false}
                    onClick={() => toggleSort(col.key)}
                  />
                </TableHead>
              ))}
              <TableHead className="h-7 w-9 px-2" aria-label="Open record" />
            </TableRow>

            {/* Tier 3: the navy → blue → teal sweep closing the header. */}
            <GradientSweepRow bands={BANDS} />
          </TableHeader>

          <TableBody>
            {total === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                  {rows.length === 0 ? "No meetings returned." : `No meetings match “${query}”.`}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {/* Spacer standing in for the rows scrolled off the top. */}
                {padTop > 0 && (
                  <tr aria-hidden="true" style={{ height: padTop }}>
                    <td colSpan={colCount} className="p-0" />
                  </tr>
                )}

                {visible.map((r) => (
                  <TableRow
                    key={r.meeting_id}
                    style={{ height: ROW_H }}
                    // The whole row opens the record. TableRow already carries
                    // hover:bg-muted/50, so the cursor is all that's needed to
                    // make it read as clickable.
                    className="cursor-pointer"
                    tabIndex={0}
                    aria-label={`Open record for ${r.client_account_name ?? "meeting"}`}
                    onClick={(e) => {
                      if (!isInteractiveTarget(e.target)) openRecord(r.meeting_id)
                    }}
                    onKeyDown={(e) => {
                      // Only when the ROW itself has focus — otherwise Enter on
                      // the Client link or the open-record button would fire
                      // twice, doing its own job and opening the drawer.
                      if (e.key === "Enter" && e.target === e.currentTarget) {
                        openRecord(r.meeting_id)
                      }
                    }}
                  >
                    <Cell i={0} value={r.meeting_type_label} />
                    <Cell i={1} value={r.meeting_status_label} />
                    <Cell i={2} value={formatEastern(r.meeting_date)} className="tabular-nums" />
                    {/* Client links to its detail page, the same
                          /client-detail?account_id= destination the Portfolio,
                          To-Do and Onboarding tables use. Falls back to plain
                          text when the row carries no account id, so the table
                          never renders a dead link. */}
                    <Cell
                      i={3}
                      value={r.client_account_name}
                      display={
                        r.client_account_name && r.client_account_id ? (
                          <Link
                            href={`/client-detail?account_id=${r.client_account_id}`}
                            className="hover:underline"
                            style={{ color: BRAND_BLUE }}
                          >
                            {r.client_account_name}
                          </Link>
                        ) : undefined
                      }
                    />
                    <Cell i={4} value={r.event_name} />
                    <Cell i={5} value={r.institution_name} />
                    <Cell i={6} value={r.investor_name} />
                    {/* Staff columns: the shared initials-circle avatars, one
                          circle per person, each carrying its own full-name
                          tooltip from the component. */}
                    <Cell
                      i={7}
                      value={r.host_names}
                      display={staffAvatars(STAFF_ROLES.host, r.host_names)}
                    />
                    <Cell
                      i={8}
                      value={r.feedback_name}
                      display={staffAvatars(STAFF_ROLES.feedback, r.feedback_name)}
                    />
                    <Cell
                      i={9}
                      value={r.booker_name}
                      display={staffAvatars(STAFF_ROLES.booker, r.booker_name)}
                    />
                    <Cell
                      i={10}
                      value={r.on_behalf_of}
                      display={staffAvatars(STAFF_ROLES.onBehalf, r.on_behalf_of)}
                    />
                    <Cell i={11} value={r.calendar_label} />
                    <Cell i={12} value={r.feedback_bda_label} />
                    <Cell i={13} value={r.fb_received} />
                    {/* Opens the record drawer. This used to be a direct
                        "Open in CRM" link; that link now lives in the drawer's
                        action bar, where it sits beside the rest of the record. */}
                    <TableCell className="w-9 px-2">
                      <button
                        type="button"
                        onClick={() => openRecord(r.meeting_id)}
                        title="Open record"
                        aria-label="Open record"
                        className="cursor-pointer text-muted-foreground hover:text-foreground"
                      >
                        <PanelRightOpen className="size-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}

                {/* Spacer for everything below the window. */}
                {padBottom > 0 && (
                  <tr aria-hidden="true" style={{ height: padBottom }}>
                    <td colSpan={colCount} className="p-0" />
                  </tr>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {/* The record drawer. Rendered as a SIBLING of the list, never wrapping
          it, so opening a record cannot remount the table — which is what keeps
          the list's scroll position and virtualization window intact. */}
      <MeetingRecordPane
        record={record}
        loading={openId !== null && record === null && recordError === null}
        error={recordError}
        eventName={openRow?.event_name ?? null}
        crmBase={crmBase}
        onClose={closeRecord}
      />
    </>
  )
}

/**
 * One body cell: truncated to its column width with the full value on hover, and
 * carrying the vertical section divider when it opens a header band. An empty
 * value renders a muted em dash, so a blank cell reads as "nothing recorded in
 * the CRM" rather than as a rendering failure.
 *
 * `value` is always the FULL underlying text — it drives both the tooltip and
 * the empty check. `display` optionally overrides only what is painted: the
 * staff columns pass initials, and Client passes a link. Keeping the two
 * separate is what lets a cell show "NM" while still hovering "Natalie
 * Mavroidis", and it means an abbreviated cell can never be mistaken for the
 * real value by anything else in the component.
 */
function Cell({
  i,
  value,
  display,
  className,
}: {
  i: number
  value: string | null | undefined
  display?: React.ReactNode
  className?: string
}) {
  const empty = value == null || value === "" || value === "—"
  const width = COLUMNS[i].width
  return (
    <TableCell
      className={cn(
        "truncate px-2 py-0.5 text-[13px]",
        empty && "text-muted-foreground",
        className,
      )}
      style={{
        width,
        maxWidth: width,
        ...(BAND_STARTS.has(i) ? BODY_SECTION_START_STYLE : null),
      }}
      title={empty ? undefined : (value as string)}
    >
      {empty ? "—" : (display ?? value)}
    </TableCell>
  )
}

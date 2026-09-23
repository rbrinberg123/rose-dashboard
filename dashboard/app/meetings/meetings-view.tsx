"use client"

import * as React from "react"
import { TestBadge } from "@/components/test-badge"
import { EditMeetingDialog, NewMeetingButton, PurgeTestMeetingsButton } from "./new-meeting-dialog"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Check,
  CircleSlash,
  Clock,
  Columns3,
  Download,
  Filter,
  PanelRightOpen,
  Search,
  X,
} from "lucide-react"

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
import { BRAND_BLUE, CANVAS, CARD_CLASS, STATUS_PILL_LIGHT } from "@/lib/design"
import { exportAdminMeetings } from "@/lib/admin-meetings-excel"
import { baseTicker } from "@/lib/client-todo-format"
import type { MeetingRecord } from "@/lib/meeting-record"
import { bandStarts, bandsFor, getColumn, type MeetingColumnDef } from "@/lib/meetings/columns"
import {
  configsDiffer,
  encodeConfig,
  type FilterCondition,
  type SavedView,
  type ViewConfig,
} from "@/lib/meetings/views"
import type { QuickFilters } from "@/lib/meetings/query"
import { ColumnEditor } from "@/components/table-views/column-editor"
import { FilterEditor } from "@/components/table-views/filter-editor"
import { ViewSwitcher, type ViewActions } from "@/components/table-views/view-switcher"
import { catalogBySection, COLUMN_CATALOG, getColumn as getCatalogColumn } from "@/lib/meetings/columns"
import { opsForField } from "@/lib/meetings/views"
import {
  createSavedView,
  deleteSavedView,
  setDefaultSavedView,
  updateSavedView,
} from "./views-actions"
import { loadMeetingRecord, loadRowsForExport } from "./actions"
import { QuickFilterControls } from "./quick-filters"
import { MeetingRecordPane, statusPill } from "./meeting-record-pane"
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

// The View presets themselves live in ./presets, shared with the server loader.
// Their PREDICATES are no longer here at all: each one is applied as a PostgREST
// filter in app/meetings/page.tsx, so `rows` arrives already narrowed to the
// active preset. See that file for the Eastern-day and no-host translations.

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

// ---------------------------------------------------------------------------
// Compact renderings for the narrow workflow columns.
//
// Every one of these paints a MARK and nothing else; the real value always
// reaches the user through the cell's `title`, because Cell is passed the full
// text as `value` and only the mark as `display`. Nothing here is allowed to
// decide whether a cell is empty — that stays with `value` — so a column can
// never render a confident-looking icon over a blank field. The Excel export is
// untouched by all of it and still carries the words.
// ---------------------------------------------------------------------------

/**
 * Meeting Status as a coloured pill carrying the FULL word.
 *
 * Colours come from the SAME map the record drawer's status pill uses
 * (`statusPill`, imported from meeting-record-pane), so a pill on a row and the
 * pill inside that row's drawer can never disagree: Confirmed green, Cancelled
 * red, Pending amber, anything else (e.g. TBR) neutral grey.
 *
 * This was briefly a bare dot. The colour is the part that earns its keep — live
 * data is ~96% Confirmed, so the tint is what makes the other 4% jump out of a
 * long scroll — but the word belongs on screen rather than one hover away, and
 * carrying it costs 90px against the 125px the plain-text column used.
 */
function statusPillCell(label: string | null): React.ReactNode | undefined {
  if (!label) return undefined
  const { bg, text } = statusPill(label)
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: bg, color: text }}
    >
      {label}
    </span>
  )
}

/**
 * FB in BDA as a three-state mark.
 *
 * NOT a yes/no: the field carries "Closed - All in", "Closed - No Feedback" and
 * "Awaiting Additional", and collapsing the first two together would erase the
 * distinction the column exists to show. So: a green check for all-in, a muted
 * slashed circle for closed-with-nothing, an amber clock for still-waiting, and
 * anything unrecognised falls back to the raw text rather than an invented icon.
 */
function bdaMark(label: string | null): React.ReactNode | undefined {
  if (!label) return undefined
  const s = label.trim().toLowerCase()
  if (s.startsWith("closed") && s.includes("all in")) {
    return <Check className="mx-auto size-3.5" style={{ color: STATUS_PILL_LIGHT.positive.text }} />
  }
  if (s.startsWith("closed")) {
    return <CircleSlash className="mx-auto size-3.5" style={{ color: STATUS_PILL_LIGHT.neutral.text }} />
  }
  if (s.startsWith("awaiting")) {
    return <Clock className="mx-auto size-3.5" style={{ color: STATUS_PILL_LIGHT.watch.text }} />
  }
  return undefined
}

/**
 * FB Rec'd as a check when the CRM holds anything at all.
 *
 * The field is a flag OR a date depending on how Dynamics models it, and the
 * view passes whichever through as text — so "has a value" is the only thing
 * that can be read from it without guessing. The value itself (a "Yes", a date)
 * is on the hover. Live data currently has this NULL on every row sampled, so
 * expect a column of em dashes until the CRM starts populating it.
 */
function receivedMark(value: string | null): React.ReactNode | undefined {
  if (!value) return undefined
  return <Check className="mx-auto size-3.5" style={{ color: STATUS_PILL_LIGHT.positive.text }} />
}


/**
 * The table's columns now come from the ACTIVE SAVED VIEW, not from a fixed
 * list: `activeConfig.columns` is an ordered list of catalog keys, resolved
 * through lib/meetings/columns.ts for each one's label, width and renderer.
 *
 * What the catalog does NOT own is how a cell is painted — that is the
 * `renderer` switch in `renderCell` below, which is the one place that knows a
 * status is a dot and a host is a circle.
 */

/** A sort key is any catalog column key; the view stores which one is active. */
type SortKey = string
type SortState = { key: SortKey; dir: "asc" | "desc" }

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

/** One row's searchable text, lower-cased. Shared by the on-screen filter and
 *  the export, so the two can never disagree about what a keyword matches. */
function haystackFor(row: AdminMeetingRow, keys: string[]): string {
  return keys
    .map((k) => {
      const v = (row as unknown as Record<string, unknown>)[k]
      // Booleans are searchable as the words the cell paints, so typing "yes"
      // finds the rows a toggle column shows Yes on.
      if (typeof v === "boolean") return v ? "yes" : "no"
      return typeof v === "string" ? v : ""
    })
    .join(" ")
    .toLowerCase()
}

/** Apply the keyword box to an arbitrary row set (used by the export path). */
function matchesKeyword(
  rows: AdminMeetingRow[],
  keys: string[],
  query: string,
): AdminMeetingRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return rows
  return rows.filter((r) => {
    const hay = haystackFor(r, keys)
    return terms.every((t) => hay.includes(t))
  })
}

/**
 * The keyword box searches the VISIBLE text columns, plus the ticker.
 *
 * Derived from the active columns rather than fixed, so hiding a column also
 * stops it matching — typing a value and hitting a row whose matching cell is
 * not on screen is worse than not matching. Dates are excluded on purpose: a
 * term like "Sep" would match a twelfth of the table and tell you nothing.
 *
 * Ticker is always searchable: the Client column paints it, so typing what is
 * on screen has to find the row.
 */
function searchKeysFor(columns: MeetingColumnDef[]): string[] {
  const keys = columns
    .filter((c) => c.renderer !== "date" && c.type !== "date")
    .map((c) => c.key)
  return [...new Set([...keys, "client_ticker"])]
}

export function MeetingsView({
  rows,
  crmBase,
  views,
  activeViewId,
  savedConfig,
  activeConfig,
  viewCounts,
  canManageSystemViews,
  readOnlyViews,
  availableColumns,
  quickFilters,
  truncated,
  rowCap,
  matchingRows,
}: {
  /** Already narrowed to the active view by the server query — never the full set. */
  rows: AdminMeetingRow[]
  crmBase: string | null
  /** Views the caller may see: built-ins, system views, and their OWN personal ones. */
  views: SavedView[]
  activeViewId: string
  /** The active view's SAVED config — the baseline "Save" would write over. */
  savedConfig: ViewConfig
  /** What is actually rendered: the working config if one is in flight, else saved. */
  activeConfig: ViewConfig
  viewCounts: Record<string, number | null>
  canManageSystemViews: boolean
  /** True while impersonating: every saved-view write is refused server-side. */
  readOnlyViews: boolean
  /**
   * The columns the deployed view actually has, probed server-side. The editors
   * grey out anything absent rather than letting a view be built that would fail
   * to query. null = could not tell, so nothing is greyed out.
   */
  availableColumns: string[] | null
  /** The toolbar dropdowns' current selection, owned by the URL. */
  quickFilters: QuickFilters
  /** True when the fetch stopped at `rowCap` — the view matches more than this. */
  truncated: boolean
  rowCap: number
  /** Rows the view + filters actually match. Equals rows.length unless truncated. */
  matchingRows: number | null
}) {
  const router = useRouter()
  // Changing the view, the columns, the filters or the sort re-runs the SERVER
  // query, so each is a navigation rather than a setState. The transition keeps
  // the current rows on screen while the new set is fetched.
  const [switching, startSwitch] = React.useTransition()
  const [query, setQuery] = React.useState("")
  const [scrollTop, setScrollTop] = React.useState(0)
  const [exporting, setExporting] = React.useState(false)
  const [panel, setPanel] = React.useState<null | "columns" | "filters">(null)
  const [viewError, setViewError] = React.useState<string | null>(null)

  /**
   * The four saved-view writes, bound to the Meetings spec on the server side
   * (./views-actions) and handed to the shared switcher. The switcher itself is
   * entity-free; the authorisation lives in lib/table-views/saved-views.ts.
   */
  const viewActions = React.useMemo<ViewActions>(
    () => ({
      create: createSavedView,
      update: updateSavedView,
      setDefault: setDefaultSavedView,
      remove: deleteSavedView,
    }),
    [],
  )

  /** The catalog, grouped for the column picker. */
  const catalogSections = React.useMemo(() => catalogBySection(), [])

  /** Set form of the probed column list, for the editors' availability checks. */
  const availableSet = React.useMemo(
    () => (availableColumns ? new Set(availableColumns) : null),
    [availableColumns],
  )

  /**
   * The columns to render, resolved from the active view's ordered keys.
   *
   * A key with no catalog entry is dropped rather than rendered blank — that is
   * how a view saved before a column was retired keeps working.
   */
  const columns = React.useMemo(
    () =>
      activeConfig.columns
        .map((k) => getColumn(k))
        .filter((c): c is MeetingColumnDef => c !== undefined),
    [activeConfig.columns],
  )

  const bands: GroupBand[] = React.useMemo(
    () => bandsFor(columns.map((c) => c.key)),
    [columns],
  )
  const bandStartSet = React.useMemo(() => bandStarts(columns.map((c) => c.key)), [columns])

  /** The table's min-width has to track the chosen columns, or the browser
   *  spreads the slack and the layout stops matching the declared widths. */
  const minWidth = React.useMemo(
    () => columns.reduce((sum, c) => sum + (parseInt(c.width, 10) || 100), 0) + 36,
    [columns],
  )

  const sort: SortState = React.useMemo(
    () => ({ key: activeConfig.sort.field, dir: activeConfig.sort.dir }),
    [activeConfig.sort],
  )

  /** Unsaved column/filter/sort edits are in flight. */
  const dirty = React.useMemo(
    () => configsDiffer(activeConfig, savedConfig),
    [activeConfig, savedConfig],
  )


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

  // Edit — offered by the drawer only for origin='dashboard' records (the
  // server refuses anything else). After a save the list refreshes and the
  // drawer reopens on the same record so it shows the new values.
  const [editId, setEditId] = React.useState<string | null>(null)
  const closeEdit = React.useCallback(() => setEditId(null), [])
  const afterEdit = React.useCallback(
    (id: string) => {
      closeRecord()
      router.refresh()
      setTimeout(() => openRecord(id), 0)
    },
    [closeRecord, openRecord, router],
  )

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

  // Precompute one lower-cased haystack per row so a keystroke does not re-read
  // and re-case every visible field across the loaded rows.
  const searchKeys = React.useMemo(() => searchKeysFor(columns), [columns])

  const haystacks = React.useMemo(
    () => rows.map((r) => haystackFor(r, searchKeys)),
    [rows, searchKeys],
  )

  // Keyword only — the View preset was already applied by the server query, so
  // `rows` is the preset’s set. Filtering here stays cheap for every preset but
  // "All meetings", which remains the one heavy case, exactly as before.
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    // Every whitespace-separated term must appear somewhere in the row, so
    // "cancelled fidelity" narrows the set instead of widening it.
    const terms = q ? q.split(/\s+/) : []
    if (!terms.length) return rows
    // The haystack index stays aligned with the row index, so filter by index.
    return rows.filter((_r, i) => terms.every((t) => haystacks[i].includes(t)))
  }, [rows, haystacks, query])

  // Sorting is SERVER-SIDE now: it is part of the view config, so clicking a
  // header re-queries with a new ORDER BY (and saves with the view). `rows`
  // therefore arrives already ordered, and the keyword filter preserves that
  // order — so there is nothing left to sort here.
  const sorted = filtered

  /** Jump back to the top whenever the row set or its order changes — otherwise
   *  the scroll position points into a slice that no longer means anything. */
  const resetScroll = React.useCallback(() => {
    setScrollTop(0)
    scrollerRef.current?.scrollTo({ top: 0 })
  }, [])

  /**
   * Push a new working config into the URL, which re-runs the server query.
   *
   * Filters and sort MUST round-trip through the server — that is what keeps
   * them applied in the database over all ~13.6k rows instead of over whatever
   * the browser happens to be holding. Columns go the same route so one
   * mechanism covers all three.
   */
  /**
   * Build the page URL from the three things that live in it: the view, any
   * unsaved config, and the quick filters.
   *
   * One builder for all of them, because they must not clobber each other —
   * applying a column edit has to preserve the selected host, and picking a host
   * has to preserve an unsaved column set.
   */
  const buildUrl = React.useCallback(
    (config: ViewConfig, quick: QuickFilters) => {
      const params = new URLSearchParams({ view: activeViewId })
      // Back to the saved view's own URL when the edits exactly undo — keeps a
      // clean link rather than a redundant ?cfg= that says nothing.
      if (configsDiffer(config, savedConfig)) params.set("cfg", encodeConfig(config))
      if (quick.client) params.set("client", quick.client)
      if (quick.host) params.set("host", quick.host)
      if (quick.feedback) params.set("fb", quick.feedback)
      return `/meetings?${params.toString()}`
    },
    [activeViewId, savedConfig],
  )

  const applyConfig = React.useCallback(
    (next: ViewConfig) => {
      const url = buildUrl(next, quickFilters)
      resetScroll()
      startSwitch(() => {
        router.push(url)
      })
    },
    [buildUrl, quickFilters, resetScroll, router],
  )

  /** A dropdown changed: same round trip, so the filter applies in the query. */
  const applyQuickFilters = React.useCallback(
    (next: QuickFilters) => {
      const url = buildUrl(activeConfig, next)
      resetScroll()
      startSwitch(() => {
        router.push(url)
      })
    },
    [activeConfig, buildUrl, resetScroll, router],
  )

  const anyQuickFilter = !!(quickFilters.client || quickFilters.host || quickFilters.feedback)

  const toggleSort = React.useCallback(
    (key: SortKey) => {
      const col = getColumn(key)
      const dir: "asc" | "desc" =
        sort.key === key
          ? sort.dir === "asc"
            ? "desc"
            : "asc"
          : // Dates open newest-first; everything else A–Z. Same as every other
            // table here.
            col?.type === "date"
            ? "desc"
            : "asc"
      applyConfig({ ...activeConfig, sort: { field: key, dir } })
    },
    [activeConfig, applyConfig, sort],
  )

  // The visible window: which slice of `sorted` is actually mounted.
  const total = sorted.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
  const visible = sorted.slice(first, last)
  const padTop = first * ROW_H
  const padBottom = Math.max(0, (total - last) * ROW_H)

  // +1 for the trailing open-record column, which is always rendered.
  const colCount = columns.length + 1

  async function onExport() {
    setExporting(true)
    setViewError(null)
    try {
      // The sheet mirrors the ACTIVE VIEW: its columns, in its order. Values stay
      // full and human-readable — the compaction is screen-only (see
      // lib/admin-meetings-excel.ts).
      //
      // The ROWS, though, come from a fresh UNCAPPED server fetch rather than
      // from what is on screen. The page stops at ROW_CAP; the export must not,
      // or capping the page would quietly start truncating spreadsheets. The
      // keyword box is re-applied here because it is the one filter that lives
      // in the browser — everything else was already applied in the query.
      let out = sorted
      if (truncated) {
        const res = await loadRowsForExport({ config: activeConfig, quick: quickFilters })
        if (!res.ok) {
          setViewError(`Export failed: ${res.error}`)
          return
        }
        out = matchesKeyword(res.data, searchKeys, query)
      }
      await exportAdminMeetings(out, columns)
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
          rightSlot={
            <div className="flex items-center gap-2">
              <PurgeTestMeetingsButton />
              <NewMeetingButton />
            </div>
          }
        />
      </div>

      {/* Toolbar, left to right: View preset → count → keyword → Export.
          Sticky so it survives any page-level scroll on a short viewport. The
          negative margins let its opaque canvas background span the full width
          of PageShell's p-6, so rows can't show through beside it. */}
      <div
        className="relative sticky top-0 z-30 -mx-6 mb-3 flex flex-wrap items-center gap-3 px-6 py-2"
        style={{ background: CANVAS }}
      >
        {/* The saved-view switcher, first — it frames what the count then
            reports. Changing it re-queries the DB rather than re-filtering in
            the browser, so the page only ever holds the selected view's set. */}
        <ViewSwitcher
          views={views}
          activeViewId={activeViewId}
          workingConfig={activeConfig}
          dirty={dirty}
          counts={viewCounts}
          canManageSystemViews={canManageSystemViews}
          readOnly={readOnlyViews}
          onError={setViewError}
          actions={viewActions}
          basePath="/meetings"
        />

        {/* Client / Host / Feedback. Each re-queries; they AND with the view's
            own filters and with the keyword box. */}
        <QuickFilterControls
          values={quickFilters}
          onChange={applyQuickFilters}
          disabled={switching}
        />
        {anyQuickFilter && (
          <button
            type="button"
            onClick={() => applyQuickFilters({})}
            className="h-9 cursor-pointer rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear filters
          </button>
        )}

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
          {/* "All meetings" is a multi-second fetch; without this the table just
              sits there showing the previous view's rows and looks stuck. */}
          {switching && (
            <span className="ml-2 font-normal text-muted-foreground">Loading…</span>
          )}
        </div>

        {/* The row cap bit. Said in the toolbar rather than at the bottom of the
            table, because the whole point is that you cannot scroll to the end
            to discover it. The Excel export is NOT capped, which is worth
            saying here — otherwise the honest thing to assume is that it is. */}
        {truncated && (
          <span
            className="rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
            title="Narrow the view or use the Client / Host / Feedback filters to see the rest. Export to Excel still includes every matching row."
          >
            Showing first {rowCap.toLocaleString()}
            {matchingRows ? ` of ${matchingRows.toLocaleString()}` : ""} — refine filters to
            narrow. Export includes all.
          </span>
        )}

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

        {/* Top-right cluster: the two view editors, then Export. */}
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPanel((cur) => (cur === "columns" ? null : "columns"))}
            className="cursor-pointer"
          >
            <Columns3 />
            Edit columns
            <span className="ml-1 text-[11px] text-muted-foreground">{columns.length}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPanel((cur) => (cur === "filters" ? null : "filters"))}
            className="cursor-pointer"
          >
            <Filter />
            Edit filters
            {activeConfig.filters.length > 0 && (
              <span className="ml-1 text-[11px] text-muted-foreground">
                {activeConfig.filters.length}
              </span>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={exporting || total === 0}
            className="cursor-pointer"
          >
            <Download />
            {exporting ? "Exporting…" : "Export to Excel"}
          </Button>
        </div>

        {/* A failed saved-view write, surfaced where the controls are. Server
            actions never throw to the client — they return an error string, and
            this is where it lands. */}
        {viewError && (
          <div className="absolute left-6 right-6 top-full z-40 mt-1 flex items-start gap-2 rounded-md border border-destructive/30 bg-card px-3 py-2 text-[13px] shadow-lg">
            <span className="flex-1 text-destructive">{viewError}</span>
            <button
              type="button"
              onClick={() => setViewError(null)}
              aria-label="Dismiss"
              className="cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* The two editors. Both hand back a whole config and let applyConfig
            re-query — neither filters nor reorders anything locally.

            Anchored to the sticky toolbar (which is `relative`), so they open
            directly under the buttons that toggle them and travel with the
            toolbar when the page scrolls. An absolutely-positioned child does
            not participate in the toolbar's flex layout. */}
        {panel === "columns" && (
          <div className="absolute right-6 top-full z-40 mt-1">
            <ColumnEditor
              columns={activeConfig.columns}
              available={availableSet}
              sections={catalogSections}
              getColumn={getCatalogColumn}
              onClose={() => setPanel(null)}
              onApply={(next: string[]) => {
                setPanel(null)
                applyConfig({ ...activeConfig, columns: next })
              }}
            />
          </div>
        )}
        {panel === "filters" && (
          <div className="absolute right-6 top-full z-40 mt-1">
            <FilterEditor
              filters={activeConfig.filters}
              available={availableSet}
              catalog={COLUMN_CATALOG}
              getColumn={getCatalogColumn}
              opsForField={opsForField}
              onClose={() => setPanel(null)}
              onApply={(next: FilterCondition[]) => {
                setPanel(null)
                applyConfig({ ...activeConfig, filters: next })
              }}
            />
          </div>
        )}
      </div>


      {/* The scroll element is the shared Table's OWN table-container (see
          SCROLLER_CLASSES) — height-bounded there, so the sticky <thead> has a
          real scrolling ancestor to stick to. overflow-hidden on the card keeps
          the 14px corners so rows pass behind the curve. */}
      <div ref={cardRef} className={`${CARD_CLASS} overflow-hidden ${SCROLLER_CLASSES}`}>
        {/* The min-width tracks the CHOSEN columns: leave it fixed and the
            browser spreads the slack, so the declared widths stop matching what
            renders. Recomputed from the active view's own widths. */}
        <Table style={{ minWidth: `${minWidth}px` }}>
          <TableHeader className="sticky top-0 z-20 bg-card [&_tr]:border-b-0 [&_th]:bg-card">
            {/* Tier 1: unfilled navy section bands (shared with Portfolio / To-Do).
                Derived from the columns' catalog sections — see bandsFor. */}
            <GroupBandRow bands={bands} />

            {/* Tier 2: the sortable column labels. Clicking one re-queries with a
                new ORDER BY; the sort is part of the view and saves with it. */}
            <TableRow className="border-b-0" style={{ backgroundColor: SUBHEADER_BG }}>
              {columns.map((col, i) => (
                <TableHead
                  key={col.key}
                  className={cn("h-7 px-2", bandStartSet.has(i) && "relative")}
                  style={{ width: col.width, minWidth: col.width }}
                >
                  {bandStartSet.has(i) && <SectionDivider />}
                  <SortHeader
                    label={col.header ?? col.label}
                    title={col.title ?? col.label}
                    isSorted={sort.key === col.key ? sort.dir : false}
                    onClick={() => toggleSort(col.key)}
                  />
                </TableHead>
              ))}
              <TableHead className="h-7 w-9 px-2" aria-label="Open record" />
            </TableRow>

            {/* Tier 3: the navy → blue → teal sweep closing the header. */}
            <GradientSweepRow bands={bands} />
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
                    {columns.map((col, ci) => (
                      <Cell
                        key={col.key}
                        col={col}
                        index={ci}
                        bandStart={bandStartSet.has(ci)}
                        row={r}
                      />
                    ))}
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
        onEdit={openId ? () => setEditId(openId) : undefined}
        record={record}
        loading={openId !== null && record === null && recordError === null}
        error={recordError}
        eventName={openRow?.event_name ?? null}
        crmBase={crmBase}
        onClose={closeRecord}
      />
      <EditMeetingDialog id={editId} onClose={closeEdit} onSaved={afterEdit} />
    </>
  )
}

/**
 * One body cell.
 *
 * Truncated to its column's width with the FULL value on hover, carrying the
 * vertical section divider when it opens a header band. An empty value renders a
 * muted em dash, so a blank cell reads as "nothing recorded in the CRM" rather
 * than as a rendering failure.
 *
 * ── THE VALUE / DISPLAY SPLIT ──────────────────────────────────────────────
 * `title` always carries the full underlying text, and the painted content is
 * whatever the column's `renderer` produces. That separation is what lets a cell
 * show "NM" while hovering "Natalie Mavroidis", or a green check while hovering
 * "Closed - All in" — and it means an abbreviated cell can never be mistaken for
 * the real value by anything else in the component. The Excel export reads the
 * row, never the cell, so it is unaffected by any of it.
 */
function Cell({
  col,
  index,
  bandStart,
  row,
}: {
  col: MeetingColumnDef
  index: number
  bandStart: boolean
  row: AdminMeetingRow
}) {
  const raw = (row as unknown as Record<string, unknown>)[col.key]

  // The hover text and the empty check both come from the raw value. Booleans
  // are their painted words, so a toggle column hovers "Yes" rather than "true".
  const title =
    typeof raw === "boolean" ? (raw ? "Yes" : "No") : typeof raw === "string" ? raw : null
  const empty = raw === null || raw === undefined || raw === "" || raw === "—"

  const { width, compact } = col
  return (
    <TableCell
      className={cn(
        "truncate py-0.5 text-[13px]",
        // Mark columns centre their glyph and halve the side padding; text
        // columns keep the standard px-2 so their truncation still reads.
        compact ? "px-1 text-center" : "px-2",
        empty && "text-muted-foreground",
        col.renderer === "date" && "tabular-nums",
      )}
      style={{
        width,
        maxWidth: width,
        ...(bandStart ? BODY_SECTION_START_STYLE : null),
      }}
      title={empty ? undefined : (title ?? undefined)}
      data-column={col.key}
      data-column-index={index}
    >
      {empty ? "—" : renderCell(col, row, raw)}
    </TableCell>
  )
}

/**
 * Paint one cell, by the column's renderer.
 *
 * The one place that knows a status is a dot and a host is a circle. Every arm
 * is display-only — nothing here reads or changes data, and the em-dash /
 * emptiness decision has already been made by the caller.
 */
function renderCell(col: MeetingColumnDef, row: AdminMeetingRow, raw: unknown): React.ReactNode {
  const text = typeof raw === "string" ? raw : null

  // Dashboard-created test record: TEST badge beside the client.
  if (col.renderer === "ticker" && row.is_test) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <TestBadge />
        {renderCell(col, { ...row, is_test: false }, raw)}
      </span>
    )
  }

  switch (col.renderer) {
    case "date":
      return formatEastern(text)

    case "ticker": {
      // Shows the TICKER, hovers the full account name (the cell's title), and
      // links to the same /client-detail?account_id= destination Portfolio,
      // To-Do and Onboarding use. Falls back to plain text when the row carries
      // no account id, so the table never renders a dead link — and to the
      // account name when there is no ticker (an account without one, or the
      // whole column before the ticker patch is run).
      if (!row.client_account_id) return text
      return (
        <Link
          href={`/client-detail?account_id=${row.client_account_id}`}
          className="font-medium hover:underline"
          style={{ color: BRAND_BLUE }}
        >
          {row.client_ticker ? baseTicker(row.client_ticker) : text}
        </Link>
      )
    }

    case "people":
      // The shared initials-circle cluster, one circle per person, each with its
      // own full-name tooltip from the component.
      return staffAvatars(staffSpecFor(col.key), text) ?? text

    case "statusPill":
      return statusPillCell(text) ?? text

    case "bdaMark":
      return bdaMark(text) ?? text

    case "checkMark":
      return receivedMark(text) ?? text

    case "bool":
      return raw === true ? "Yes" : raw === false ? "No" : text

    case "text":
    default:
      return text
  }
}

/**
 * Which avatar colour a people column uses.
 *
 * One hue per COLUMN rather than per person — that is what keeps several staff
 * columns readable at a glance once the names are gone. The four original
 * columns keep the hues they had; anything else added from the catalog (Created
 * By, Modified By) takes the neutral navy rather than borrowing a hue that
 * already means something else.
 */
function staffSpecFor(key: string): { role: string; bg: string; fg: string } {
  switch (key) {
    case "host_names":
      return STAFF_ROLES.host
    case "feedback_name":
      return STAFF_ROLES.feedback
    case "booker_name":
      return STAFF_ROLES.booker
    case "on_behalf_of":
      return STAFF_ROLES.onBehalf
    default:
      return { role: getColumn(key)?.label ?? "Person", bg: "#1E2858", fg: "#FFFFFF" }
  }
}

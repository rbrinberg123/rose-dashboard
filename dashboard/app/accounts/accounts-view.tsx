"use client"

/**
 * The all-CRM Clients table. Every client in the CRM, active and inactive, no
 * row scoping — see the security note in app/accounts/page.tsx; this component
 * only renders what it is handed.
 *
 * Same architecture as the Meetings, Events, Tasks, Touches, Notes and Contacts
 * tables, on the same shared pieces: the saved views, the column picker, the
 * filter builder and the quick-filter dropdowns all come from
 * components/table-views/, and the query layer from lib/table-views/. What is
 * local here is only how a CLIENT row is painted.
 *
 * The body is WINDOWED: only the slice of rows near the scroll position is in
 * the DOM, with two spacer rows standing in for everything above and below. At
 * ~228 clients that is not load-bearing today; it is here because every sibling
 * table has it and a divergent table is a second thing to maintain.
 */

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CalendarDays,
  ExternalLink,
  Handshake,
  PanelRightOpen,
  SquareCheck,
  X,
} from "lucide-react"

import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import { accountTeamMembers } from "@/lib/account-team"
import { ListTitleCard } from "@/components/page-masthead"
import { SortHeader } from "@/components/sort-header"
import { CRM_TABLE_DENSITY } from "@/lib/table-density"
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
import { ColumnEditor } from "@/components/table-views/column-editor"
import { FilterEditor } from "@/components/table-views/filter-editor"
import { QuickFilterBar, type QuickFilterDef } from "@/components/table-views/quick-filters"
import { ViewSwitcher, type ViewActions } from "@/components/table-views/view-switcher"
import { TableToolbarActions } from "@/components/table-views/toolbar-actions"
import { BRAND_BLUE, CANVAS, CARD_CLASS } from "@/lib/design"
import { baseTicker } from "@/lib/client-todo-format"
import { configsDiffer, encodeConfig } from "@/lib/table-views/config"
import { exportToExcel } from "@/lib/table-views/excel"
import { BUILTIN_PREFIX, opsForField as sharedOpsForField } from "@/lib/table-views/types"
import type { ColumnDef, FilterCondition, SavedView, ViewConfig } from "@/lib/table-views/types"
import {
  ACCOUNT_TEAM_CELL_DISPLAY,
  TEAM_NAME_SEPARATOR,
  ACCOUNTS_SPEC,
  accountCatalogBySection,
  getAccountColumn,
  isPersonName,
  type AccountColumnDef,
} from "@/lib/accounts/spec"
import { ACCOUNT_TEAM_ROLE_META } from "@/lib/account-teams/roles"

/** At most this many leading "Client" columns freeze on horizontal scroll. */
const MAX_FROZEN = 2
import {
  ACCOUNT_QUICK_FILTER_KEYS,
  hasAccountQuickFilters,
  type AccountQuickFilters,
} from "@/lib/accounts/filters"
import type { AccountRecord } from "@/lib/accounts/record"
import type { AdminAccountRow } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  createSavedView,
  deleteSavedView,
  loadAccountFilterOptions,
  loadAccountRecord,
  loadAccountRowsForExport,
  setDefaultSavedView,
  updateSavedView,
} from "./actions"
import { AccountRecordPane, accountStatePill } from "./account-record-pane"
import { TestBadge } from "@/components/test-badge"
import { EditClientDialog, NewClientButton, PurgeTestClientsButton } from "./new-client-dialog"
import { splitPeople } from "@/lib/team-initials"
import { useFillHeight } from "@/components/use-fill-height"
import { useFitColumns } from "@/components/use-fit-columns"

// Row geometry. ROW_H must match the rendered row height exactly or the spacers
// drift out of step with the scroll position and the window shows the wrong
// slice. Enforced on every row via an inline height, not left to content.
//
// CRM_TABLE_DENSITY.rowH (30), shared with every CRM table. The Client cell carries a
// 24px avatar cluster, which still clears a 30px row.
const ROW_H = CRM_TABLE_DENSITY.rowH
const OVERSCAN = 12

/**
 * THE SCROLL CONTAINER IS THE SHARED <Table>'S OWN WRAPPER, NOT A DIV OF OURS —
 * see the long note in app/meetings/meetings-view.tsx. Give it no bounded height
 * and the sticky <thead> never engages.
 */
// Sized to fill the page — see CRM_TABLE_DENSITY.scroller / useFillHeight.
const SCROLLER_CLASSES = CRM_TABLE_DENSITY.scroller

const VIEWPORT_H_FALLBACK = 560

const EASTERN_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "numeric",
  day: "numeric",
  year: "2-digit",
})

/** "6/09/26" — Eastern. Display only; sorting uses the raw timestamp. */
function formatEastern(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : EASTERN_DATE.format(d)
}

/**
 * The seven quick filters, declared once — one compact row (QuickFilterBar `row`).
 *
 * REMOVED 2026-10-08 (by request): the Active (Active / Inactive), Client
 * Status (Current / Past), Feedback and Logistics dropdowns. The list's active/inactive split is now the
 * built-in views alone — "Active clients" (the default) or "All clients".
 *
 * ACTIVE AND CLIENT STATUS ARE TWO SEPARATE DROPDOWNS ON PURPOSE. "Active" is
 * the Dynamics statecode — the thing the default view and ~15 existing database
 * views mean by an active client. "Client Status" is a Rose business field
 * (Current / Past) that disagrees with it on 33 accounts. Collapsing them into
 * one control would have to pick a winner silently.
 *
 * The five team dropdowns are `searchable` because the staff list runs long
 * enough that a native select becomes a scroll hunt; the six classification
 * lists are short and closed, and are better as native selects.
 *
 * `state` comes back from the options view as TEXT ("0"/"1") — one UNION, one
 * column type — and is converted back to an integer in lib/accounts/filters.ts.
 */
const QUICK_FILTERS: QuickFilterDef[] = [
  { key: "sector", label: "Sector", allLabel: "All sectors", searchable: true },
  { key: "region", label: "Region", allLabel: "All regions" },
  { key: "market_cap", label: "Market Cap", allLabel: "All caps" },
  { key: "account_manager", label: "Account Mgr", allLabel: "All managers", searchable: true },
  { key: "secondary", label: "Secondary", allLabel: "All secondaries", searchable: true },
  { key: "associate", label: "Associate", allLabel: "All associates", searchable: true },
]

/**
 * Per-client jump links (the "Jump to" column, after Last Activity): open the
 * Events / Meetings / Tasks CRM tables filtered to THIS client, on each table's
 * built-in "All …" view (`view=builtin:all` — no stage / date / status filter),
 * so the client is the ONLY filter and the page cannot fall back to its own
 * default (Current & upcoming, Upcoming, Open). The same link shape as Client
 * Detail's "View all meetings →". All three pages read `?view=` + `?client=`
 * (the account id) and each re-checks access server-side.
 */
/** Width of the jump-links column (three 14px icons, evenly spaced). */
const JUMP_COL_W = 104

const ALL_VIEW = encodeURIComponent(`${BUILTIN_PREFIX}all`)
const JUMPS = [
  { path: "/events", label: "All events", Icon: CalendarDays },
  { path: "/meetings", label: "All meetings", Icon: Handshake },
  { path: "/tasks", label: "All tasks", Icon: SquareCheck },
] as const

function JumpLinks({ accountId, name }: { accountId: string; name: string | null }) {
  return (
    <div className="flex items-center justify-center gap-4">
      {JUMPS.map(({ path, label, Icon }) => (
        <Link
          key={path}
          href={`${path}?view=${ALL_VIEW}&client=${encodeURIComponent(accountId)}`}
          title={`${label} for ${name ?? "this client"}`}
          aria-label={`${label} for ${name ?? "this client"}`}
          className="text-muted-foreground transition-colors hover:text-[#0355A7]"
        >
          <Icon className="size-3.5" />
        </Link>
      ))}
    </div>
  )
}

/** Header bands — one per run of consecutive columns sharing a group. */
function bandsFor(cols: AccountColumnDef[]): GroupBand[] {
  const out: GroupBand[] = []
  cols.forEach((c, i) => {
    const last = out[out.length - 1]
    if (last && last.label === c.section) last.colSpan += 1
    else out.push({ key: `${c.section}-${i}`, label: c.section, colSpan: 1 })
  })
  return out
}

function bandStarts(cols: AccountColumnDef[]): Set<number> {
  const starts = new Set<number>()
  let cursor = 0
  for (const b of bandsFor(cols)) {
    if (cursor > 0) starts.add(cursor)
    cursor += b.colSpan
  }
  return starts
}

export function AccountsView({
  rows,
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
  canOpenClientDetail,
}: {
  /** Already narrowed to the active view by the server query. */
  rows: AdminAccountRow[]
  views: SavedView[]
  activeViewId: string
  savedConfig: ViewConfig
  activeConfig: ViewConfig
  viewCounts: Record<string, number | null>
  canManageSystemViews: boolean
  readOnlyViews: boolean
  availableColumns: string[] | null
  quickFilters: AccountQuickFilters
  truncated: boolean
  rowCap: number
  matchingRows: number | null
  /** Server-decided: may this viewer open /client-detail? Gates the name/ticker links. */
  canOpenClientDetail: boolean
}) {
  const router = useRouter()
  const [switching, startSwitch] = React.useTransition()
  const [scrollTop, setScrollTop] = React.useState(0)
  const [exporting, setExporting] = React.useState(false)
  const [panel, setPanel] = React.useState<null | "columns" | "filters">(null)
  const [viewError, setViewError] = React.useState<string | null>(null)

  const [openId, setOpenId] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<AccountRecord | null>(null)
  const [recordError, setRecordError] = React.useState<string | null>(null)

  const availableSet = React.useMemo(
    () => (availableColumns ? new Set(availableColumns) : null),
    [availableColumns],
  )

  const columns = React.useMemo(
    () =>
      activeConfig.columns
        .map((k) => getAccountColumn(k))
        .filter((c): c is AccountColumnDef => c !== undefined),
    [activeConfig.columns],
  )

  const cardRef = React.useRef<HTMLDivElement>(null)
  useFillHeight(cardRef)
  // Columns fitted to the container (fixed-content columns keep their width,
  // text columns compress + truncate) — see components/use-fit-columns.ts.
  const { fitted, minWidth } = useFitColumns(cardRef, columns, 36 + JUMP_COL_W)

  // FROZEN COLUMNS: the leading run of "Client" columns (Ticker + Client Name in
  // the default view; at most two) stays pinned on horizontal scroll — the row is
  // wide once every account-team role has its own column. Same sticky-left
  // technique as Portfolio's frozen Core columns. Value = the column's `left`.
  const frozenLefts = React.useMemo(() => {
    const lefts: number[] = []
    let left = 0
    for (const c of fitted) {
      if (c.section !== "Client" || lefts.length >= MAX_FROZEN) break
      lefts.push(left)
      left += parseInt(c.width, 10) || 100
    }
    return lefts
  }, [fitted])
  const bands = React.useMemo(() => {
    const b = bandsFor(columns)
    // The jump-links column (not a data column) gets its own band after the rest.
    b.push({ key: "jump", label: "Jump to", colSpan: 1 })
    // The Client band's label pins with its columns (GroupBand.sticky). Only when
    // the WHOLE band is frozen, or the label would slide over unfrozen cells.
    if (b.length > 0 && frozenLefts.length > 0 && b[0].colSpan === frozenLefts.length) {
      b[0] = { ...b[0], sticky: true }
    }
    return b
  }, [columns, frozenLefts])
  const bandStartSet = React.useMemo(() => bandStarts(columns), [columns])
  const sort = activeConfig.sort
  const dirty = React.useMemo(
    () => configsDiffer(activeConfig, savedConfig),
    [activeConfig, savedConfig],
  )

  const scrollerRef = React.useRef<HTMLElement | null>(null)
  const [viewportH, setViewportH] = React.useState(VIEWPORT_H_FALLBACK)

  React.useEffect(() => {
    const el = cardRef.current?.querySelector<HTMLElement>("[data-slot=table-container]")
    if (!el) return
    scrollerRef.current = el
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

  const resetScroll = React.useCallback(() => {
    setScrollTop(0)
    scrollerRef.current?.scrollTo({ top: 0 })
  }, [])

  /**
   * Build the page URL from the three things that live in it: the view, any
   * unsaved config, and the quick filters. One builder, because they must not
   * clobber each other.
   *
   * The quick filters are written from ACCOUNT_QUICK_FILTER_KEYS rather than
   * eleven hand-written lines, so adding a dropdown cannot leave a param behind
   * that the page reads but the URL never carries.
   */
  const buildUrl = React.useCallback(
    (config: ViewConfig, quick: AccountQuickFilters) => {
      const params = new URLSearchParams({ view: activeViewId })
      if (configsDiffer(config, savedConfig)) params.set("cfg", encodeConfig(config))
      for (const key of ACCOUNT_QUICK_FILTER_KEYS) {
        const v = quick[key]
        if (v) params.set(key, v)
      }
      return `/accounts?${params.toString()}`
    },
    [activeViewId, savedConfig],
  )

  const applyConfig = React.useCallback(
    (next: ViewConfig) => {
      const url = buildUrl(next, quickFilters)
      resetScroll()
      startSwitch(() => router.push(url))
    },
    [buildUrl, quickFilters, resetScroll, router],
  )

  const applyQuick = React.useCallback(
    (next: Record<string, string | undefined>) => {
      const url = buildUrl(activeConfig, next as AccountQuickFilters)
      resetScroll()
      startSwitch(() => router.push(url))
    },
    [activeConfig, buildUrl, resetScroll, router],
  )

  const anyQuickFilter = hasAccountQuickFilters(quickFilters)

  const viewActions = React.useMemo<ViewActions>(
    () => ({
      create: createSavedView,
      update: updateSavedView,
      setDefault: setDefaultSavedView,
      remove: deleteSavedView,
    }),
    [],
  )

  const loadOptions = React.useCallback(async () => {
    const res = await loadAccountFilterOptions()
    return res.ok ? res.data : {}
  }, [])

  const catalogSections = React.useMemo(
    () => accountCatalogBySection() as { section: string; columns: ColumnDef[] }[],
    [],
  )
  const opsForField = React.useCallback((f: string) => sharedOpsForField(ACCOUNTS_SPEC, f), [])

  /** Open a record — or swap to another. Clearing happens in the handler, not in
   *  an effect, so a swap shows the loading state rather than the previous
   *  client's values under the new one's header. */
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

  // Edit — offered by the drawer only for origin='dashboard' clients (the
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

  // The effect owns only the async fetch — every setState is in a callback.
  React.useEffect(() => {
    if (!openId) return
    let cancelled = false
    loadAccountRecord(openId).then((res) => {
      if (cancelled) return
      if (res.ok) setRecord(res.data ?? null)
      else setRecordError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [openId])

  // No keyword box on Clients (removed 2026-10-10 to keep the toolbar on one
  // row — the view, the dropdowns and ⌘K global search cover lookup). The view's
  // filters and the dropdowns were applied by the server query, and the rows
  // arrive sorted.
  const sorted = rows

  const toggleSort = React.useCallback(
    (key: string) => {
      const col = getAccountColumn(key)
      const dir: "asc" | "desc" =
        sort.field === key
          ? sort.dir === "asc"
            ? "desc"
            : "asc"
          : col?.type === "date"
            ? "desc"
            : "asc"
      applyConfig({ ...activeConfig, sort: { field: key, dir } })
    },
    [activeConfig, applyConfig, sort],
  )

  const total = sorted.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
  const visible = sorted.slice(first, last)
  const padTop = first * ROW_H
  const padBottom = Math.max(0, (total - last) * ROW_H)
  const colCount = columns.length + 2

  async function onExport() {
    setExporting(true)
    setViewError(null)
    try {
      // Rows come from a fresh UNCAPPED server fetch when the page was capped —
      // the export must never be silently truncated. The quick filters go with
      // the request, so the export always matches the ACTIVE VIEW.
      let out = sorted
      if (truncated) {
        const res = await loadAccountRowsForExport({
          config: activeConfig,
          quick: quickFilters,
        })
        if (!res.ok) {
          setViewError(`Export failed: ${res.error}`)
          return
        }
        out = res.data
      }
      await exportToExcel(out as unknown as Record<string, unknown>[], columns, {
        sheetName: "Clients",
        fileStem: "crm-clients",
        // The ticker and the four account-team names always ride along: the
        // Client column paints a ticker and four circles, none of which survive
        // into a spreadsheet cell, and "who covers this client?" is the first
        // question anyone asks of a client dump.
        alwaysInclude: [
          "client_ticker",
          "sales_lead_primary_name",
          "secondary_manager_name",
          "associate_name",
          "logistics_coordinator_name",
        ],
        getColumn: getAccountColumn,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          compact
          eyebrow="CRM"
          title="Clients"
          rightSlot={
            <div className="flex items-center gap-2">
              <PurgeTestClientsButton />
              <NewClientButton />
            </div>
          }
        />
      </div>

      <div
        // ONE LINE from a 1360px window up (2026-10-08): compact view dropdown,
        // the seven filters as one flexible group, count, a fixed-width search and
        // icon-only actions. Below 1360px it wraps (the filter group takes its own
        // line).
        className={CRM_TABLE_DENSITY.toolbar}
        style={{ background: CANVAS }}
      >
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
          basePath="/accounts"
          compact
        />

        <QuickFilterBar
          row
          cacheKey="accounts"
          filters={QUICK_FILTERS}
          values={quickFilters as Record<string, string | undefined>}
          onChange={applyQuick}
          loadOptions={loadOptions}
          disabled={switching}
        />
        {anyQuickFilter && (
          <button
            type="button"
            onClick={() => applyQuick({})}
            className="h-7 shrink-0 cursor-pointer whitespace-nowrap rounded-md px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear filters
          </button>
        )}

        <div className="shrink-0 whitespace-nowrap text-xs font-medium tabular-nums">
          {total.toLocaleString()}
          <span className="ml-1 font-normal text-muted-foreground">
            {total === 1 ? "client" : "clients"}
          </span>
          {total !== rows.length && (
            <span className="ml-1 font-normal text-muted-foreground">
              of {rows.length.toLocaleString()}
            </span>
          )}
          {switching && <span className="ml-2 font-normal text-muted-foreground">Loading…</span>}
        </div>

        {truncated && (
          <span
            className="rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
            title="Narrow the view or use the filters to see the rest. Export to Excel still includes every matching row."
          >
            Showing first {rowCap.toLocaleString()}
            {matchingRows ? ` of ${matchingRows.toLocaleString()}` : ""} — refine filters to narrow.
            Export includes all.
          </span>
        )}

        {/* Compact icon actions, shared by every CRM table. */}
        <TableToolbarActions
          columnCount={columns.length}
          filterCount={activeConfig.filters.length}
          onColumns={() => setPanel((c) => (c === "columns" ? null : "columns"))}
          onFilters={() => setPanel((c) => (c === "filters" ? null : "filters"))}
          onExport={onExport}
          exporting={exporting}
          exportDisabled={total === 0}
        />

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

        {panel === "columns" && (
          <div className="absolute right-6 top-full z-40 mt-1">
            <ColumnEditor
              columns={activeConfig.columns}
              available={availableSet}
              sections={catalogSections}
              getColumn={getAccountColumn}
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
              catalog={ACCOUNTS_SPEC.catalog}
              getColumn={getAccountColumn}
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

      <div ref={cardRef} className={`${CARD_CLASS} overflow-hidden ${SCROLLER_CLASSES}`}>
        <Table className="table-fixed" style={{ minWidth: `${minWidth}px` }}>
          {/* table-fixed + colgroup: the fitted widths are binding, so no cell's
              content can push its column wider (useFitColumns). */}
          <colgroup>
            {fitted.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
            <col style={{ width: JUMP_COL_W }} />
            <col style={{ width: 36 }} />
          </colgroup>
          <TableHeader className="sticky top-0 z-20 bg-card [&_tr]:border-b-0 [&_th]:bg-card">
            <GroupBandRow bands={bands} />
            <TableRow className="border-b-0" style={{ backgroundColor: SUBHEADER_BG }}>
              {fitted.map((col, i) => (
                <TableHead
                  key={col.key}
                  className={cn(CRM_TABLE_DENSITY.headH, col.renderer === "team" ? "px-1" : CRM_TABLE_DENSITY.padX, bandStartSet.has(i) && "relative")}
                  style={{
                    width: col.width,
                    minWidth: col.width,
                    ...(i < frozenLefts.length
                      ? { position: "sticky", left: frozenLefts[i], zIndex: 30, backgroundColor: SUBHEADER_BG }
                      : null),
                  }}
                >
                  {bandStartSet.has(i) && <SectionDivider />}
                  <SortHeader
                    className={CRM_TABLE_DENSITY.headLabel}
                    label={col.header ?? col.label}
                    title={col.title ?? col.label}
                    ariaLabel={col.renderer === "team" ? `Sort by ${col.label}` : undefined}
                    // Team roles: centred over their (centred) avatar circles.
                    align={col.renderer === "team" ? "center" : "left"}
                    isSorted={sort.field === col.key ? sort.dir : false}
                    onClick={() => toggleSort(col.key)}
                  />
                </TableHead>
              ))}
              <TableHead className="relative h-7 px-2" style={{ width: JUMP_COL_W, minWidth: JUMP_COL_W }}>
                <SectionDivider />
                <span className="sr-only">Jump to events, meetings, tasks</span>
              </TableHead>
              <TableHead className="h-7 w-9 px-2" aria-label="Open record" />
            </TableRow>
            <GradientSweepRow bands={bands} />
          </TableHeader>

          <TableBody>
            {total === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                  No clients returned. If the accounts sync has not run yet, this table is empty until it does.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {padTop > 0 && (
                  <tr aria-hidden="true" style={{ height: padTop }}>
                    <td colSpan={colCount} className="p-0" />
                  </tr>
                )}

                {visible.map((r) => (
                  <TableRow
                    key={r.account_id}
                    style={{ height: ROW_H }}
                    className="cursor-pointer"
                    tabIndex={0}
                    aria-label={`Open client record for ${r.name ?? "client"}`}
                    onClick={(e) => {
                      if (!isInteractiveTarget(e.target)) openRecord(r.account_id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) {
                        openRecord(r.account_id)
                      }
                    }}
                  >
                    {fitted.map((col, ci) => (
                      <Cell
                        key={col.key}
                        col={col}
                        bandStart={bandStartSet.has(ci)}
                        frozenLeft={ci < frozenLefts.length ? frozenLefts[ci] : undefined}
                        row={r}
                        canLink={canOpenClientDetail}
                      />
                    ))}
                    <TableCell className="relative px-2 py-0" style={{ width: JUMP_COL_W, minWidth: JUMP_COL_W }}>
                      <SectionDivider />
                      <JumpLinks accountId={r.account_id} name={r.name} />
                    </TableCell>
                    <TableCell className={CRM_TABLE_DENSITY.actionCell}>
                      <button
                        type="button"
                        onClick={() => openRecord(r.account_id)}
                        title="Open record"
                        aria-label="Open record"
                        className="cursor-pointer text-muted-foreground hover:text-foreground"
                      >
                        <PanelRightOpen className="size-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}

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

      {/* Rendered as a SIBLING of the list, never wrapping it, so opening a
          record cannot remount the table. */}
      <AccountRecordPane
        onEdit={openId ? () => setEditId(openId) : undefined}
        record={record}
        loading={openId !== null && record === null && recordError === null}
        error={recordError}
        onClose={closeRecord}
      />
      <EditClientDialog id={editId} onClose={closeEdit} onSaved={afterEdit} />
    </>
  )
}

/**
 * Did this click land on something that handles its own activation? The row
 * opens the drawer, but the Client link must navigate. Asking whether the click
 * landed inside an interactive element covers anything added later without
 * touching the row handler.
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("a, button, input, select, textarea, label, [role=button], [role=link]") !== null
  )
}

/**
 * One body cell.
 *
 * `title` always carries the full underlying text and the painted content is
 * whatever the column's `renderer` produces — so the Client cell can show a
 * ticker while hovering the client's full name. The Excel export reads the row,
 * never the cell, so it is unaffected by any of it.
 */
function Cell({
  col,
  bandStart,
  frozenLeft,
  row,
  canLink,
}: {
  col: AccountColumnDef
  bandStart: boolean
  /** Set on a frozen (sticky-left) column: its left offset in px. */
  frozenLeft?: number
  row: AdminAccountRow
  /** Viewer may open Client Detail — name / ticker cells become links. */
  canLink: boolean
}) {
  const raw = (row as unknown as Record<string, unknown>)[col.key]
  const title =
    typeof raw === "boolean"
      ? raw
        ? "Yes"
        : "No"
      : typeof raw === "string"
        ? raw
        : typeof raw === "number"
          ? String(raw)
          : null
  const empty = raw === null || raw === undefined || raw === ""

  return (
    <TableCell
      className={cn(
        CRM_TABLE_DENSITY.cell,
        col.compact ? CRM_TABLE_DENSITY.padXCompact : CRM_TABLE_DENSITY.padX,
        empty && "text-muted-foreground",
        (col.type === "date" || col.type === "number") && "tabular-nums",
        col.renderer === "number" && "text-right",
      )}
      style={{
        width: col.width,
        maxWidth: col.width,
        ...(bandStart ? BODY_SECTION_START_STYLE : null),
        // Opaque so scrolled cells pass UNDER it; below the sticky header (z-20).
        ...(frozenLeft !== undefined
          ? { position: "sticky", left: frozenLeft, zIndex: 10, backgroundColor: "var(--card)" }
          : null),
      }}
      title={empty ? undefined : (title ?? undefined)}
      data-column={col.key}
    >
      {empty ? "—" : renderCell(col, row, raw, canLink)}
    </TableCell>
  )
}

/** Paint one cell, by the column's renderer. Display-only, top to bottom. */
function renderCell(
  col: AccountColumnDef,
  row: AdminAccountRow,
  raw: unknown,
  canLink: boolean,
): React.ReactNode {
  const text = typeof raw === "string" ? raw : raw == null ? null : String(raw)

  // Dashboard-created test client: TEST badge beside the client.
  if (col.renderer === "client" && row.is_test) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <TestBadge />
        {renderCell(col, { ...row, is_test: false }, raw, canLink)}
      </span>
    )
  }

  switch (col.renderer) {
    case "date":
      return formatEastern(text)

    case "client": {
      // THE ROW'S IDENTITY. Shows the TICKER and hovers the full name (the cell's
      // `title` is the raw value, which for this column IS the name), linking to
      // the same /client-detail?account_id= destination the rest of the app uses.
      //
      // The ACCOUNT TEAM follows the link — the same cluster Client Portfolio and
      // the Events Client column show: same component, same four roles, same
      // colours, same global initials directory. No new team source: the four
      // names come straight off this account row, which is what
      // ACCOUNT_TEAM_ROLES already names. Unlike Events, nothing has to be
      // merged in server-side — on this entity the row IS the account.
      const team = accountTeamMembers(row)
      const hasTeam = team.some((m) => m.name && m.name.trim())
      const label = row.client_ticker ? baseTicker(row.client_ticker) : text
      return (
        // A div, not a span: the avatar cluster renders a div, and a div inside a
        // span is invalid HTML that React will re-parent on hydration.
        //
        // justify-between pins the cluster to the cell's RIGHT edge, so the
        // circles line up down the page instead of starting wherever each ticker
        // happens to end. A row with no team keeps the link on the left.
        <div className="flex min-w-0 items-center justify-between gap-1.5">
          {canLink && row.client_account_id ? (
            <ClientDetailLink accountId={row.client_account_id} className="font-medium">
              {label}
            </ClientDetailLink>
          ) : (
            <span className="min-w-0 truncate font-medium">{label}</span>
          )}
          {/* No em-dash filler when the account has no team — in a cell that
              already shows the client, a lone dash reads as missing data.
              shrink-0 so a long ticker ellipsizes rather than squashing the
              circles. */}
          {hasTeam && (
            <div className="shrink-0">
              <TeamAvatars members={team} />
            </div>
          )}
        </div>
      )
    }

    case "people":
      // One named person. Several of these lookups point at a TEAM rather than an
      // individual, so a single-token value renders verbatim instead of as one
      // misleading initial.
      return isPersonName(text) ? (
        <TeamAvatars members={[{ role: col.label, name: text!, bg: "#1E2858", fg: "#FFFFFF" }]} />
      ) : (
        text
      )

    case "team": {
      // One account-team role. The cell value is the assignee's name, or several
      // joined by TEAM_NAME_SEPARATOR (a line break — never a comma: names contain
      // commas, e.g. "Scott Grossman, CFA"). ACCOUNT_TEAM_CELL_DISPLAY is the one
      // switch between initials circles (name on hover) and full names.
      const names = splitPeople(text, TEAM_NAME_SEPARATOR)
      if (ACCOUNT_TEAM_CELL_DISPLAY === "names" || !col.teamRole) return names.join(" · ")
      const meta = ACCOUNT_TEAM_ROLE_META[col.teamRole]
      return (
        <div className="flex justify-center">
          <TeamAvatars members={names.map((name) => ({ role: meta.label, name, bg: meta.bg, fg: meta.fg }))} />
        </div>
      )
    }

    case "statePill": {
      const { bg, text: fg } = accountStatePill(text)
      return (
        <span
          className="inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: bg, color: fg }}
        >
          {text}
        </span>
      )
    }

    case "url":
      // Only an http(s) value becomes a real link — the CRM holds plenty of bare
      // "example.com" values, and a link that silently resolves against the
      // dashboard's own origin is worse than plain text.
      return text && text.startsWith("http") ? (
        <a
          href={text}
          target="_blank"
          rel="noreferrer"
          title={text}
          className="inline-flex items-center gap-1 hover:underline"
          style={{ color: BRAND_BLUE }}
        >
          Open <ExternalLink className="size-3" />
        </a>
      ) : (
        text
      )

    case "number":
      return typeof raw === "number" ? raw.toLocaleString() : text

    case "bool":
      return raw === true ? "Yes" : raw === false ? "No" : text

    case "text":
    default:
      // The plain Client Name and Ticker columns link to Client Detail too.
      if (
        canLink &&
        row.client_account_id &&
        (col.key === "client_account_name" || col.key === "ticker_symbol")
      ) {
        return <ClientDetailLink accountId={row.client_account_id}>{text}</ClientDetailLink>
      }
      return text
  }
}

/**
 * A full-page link to the client's detail page. stopPropagation keeps the click
 * from ALSO opening the row's record drawer (the row's isInteractiveTarget check
 * already skips anchors; this makes it explicit).
 */
function ClientDetailLink({
  accountId,
  className,
  children,
}: {
  accountId: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={`/client-detail?account_id=${accountId}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn("min-w-0 truncate hover:underline", className)}
      style={{ color: BRAND_BLUE }}
    >
      {children}
    </Link>
  )
}

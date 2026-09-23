"use client"

/**
 * The all-CRM Notes table. Every client-review note, no row scoping — see the
 * security note in app/notes/page.tsx; this component only renders what it is
 * handed.
 *
 * Same architecture as the Meetings, Events, Tasks and Touches tables, on the
 * same shared pieces: the saved views, the column picker, the filter builder and
 * the quick-filter dropdowns all come from components/table-views/, and the query
 * layer from lib/table-views/. What is local here is only how a NOTE row is
 * painted.
 *
 * The body is WINDOWED: only the slice of rows near the scroll position is in
 * the DOM, with two spacer rows standing in for everything above and below.
 */

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Columns3, Download, Filter, PanelRightOpen, Search, X } from "lucide-react"

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
import { ColumnEditor } from "@/components/table-views/column-editor"
import { FilterEditor } from "@/components/table-views/filter-editor"
import { QuickFilterBar, type QuickFilterDef } from "@/components/table-views/quick-filters"
import { ViewSwitcher, type ViewActions } from "@/components/table-views/view-switcher"
import { BRAND_BLUE, CANVAS, CARD_CLASS } from "@/lib/design"
import { baseTicker } from "@/lib/client-todo-format"
import { configsDiffer, encodeConfig } from "@/lib/table-views/config"
import { exportToExcel } from "@/lib/table-views/excel"
import { opsForField as sharedOpsForField } from "@/lib/table-views/types"
import type { ColumnDef, FilterCondition, SavedView, ViewConfig } from "@/lib/table-views/types"
import {
  NOTES_SPEC,
  getNoteColumn,
  isPersonName,
  noteCatalogBySection,
  type NoteColumnDef,
} from "@/lib/notes/spec"
import type { NoteQuickFilters } from "@/lib/notes/filters"
import type { NoteRecord } from "@/lib/notes/record"
import type { AdminNoteRow } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  createSavedView,
  deleteSavedView,
  loadNoteFilterOptions,
  loadNoteRecord,
  loadNoteRowsForExport,
  setDefaultSavedView,
  updateSavedView,
} from "./actions"
import { NoteRecordPane, noteStatusPill } from "./note-record-pane"
import { TestBadge } from "@/components/test-badge"
import { EditNoteDialog, NewNoteButton, PurgeTestNotesButton } from "./new-note-dialog"

// Row geometry. ROW_H must match the rendered row height exactly or the spacers
// drift out of step with the scroll position and the window shows the wrong
// slice. Enforced on every row via an inline height, not left to content.
//
// 30, matching Events and Touches: the Note cell is deliberately ONE truncated
// line, not a wrapped excerpt — a note averages 256 characters and runs to
// 1,465, so letting it wrap would make row height unpredictable and break the
// virtualisation. The full text is one hover (or one click) away.
const ROW_H = 30
const OVERSCAN = 12

/**
 * THE SCROLL CONTAINER IS THE SHARED <Table>'S OWN WRAPPER, NOT A DIV OF OURS —
 * see the long note in app/meetings/meetings-view.tsx. Give it no bounded height
 * and the sticky <thead> never engages.
 */
const SCROLLER_CLASSES =
  "[&_[data-slot=table-container]]:h-[calc(100vh-16rem)] " +
  "[&_[data-slot=table-container]]:min-h-[300px] " +
  "[&_[data-slot=table-container]]:overflow-y-auto"

const VIEWPORT_H_FALLBACK = 560

const EASTERN_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "numeric",
  day: "numeric",
  year: "2-digit",
})

/**
 * "6/09/26" — Eastern. Display only; sorting uses the raw timestamp.
 *
 * note_date and action_deadline are `date`s in the mirror that the view lifts to
 * EASTERN midnight, so formatting them in Eastern returns the same calendar day
 * that was typed into the CRM. Formatting in UTC would show the previous day.
 */
function formatEastern(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : EASTERN_DATE.format(d)
}

/**
 * The five quick filters, declared once.
 *
 * Status and Risk Driver are the TRIMMED values — both the options view and
 * v_admin_notes_all btrim, because the raw columns store "Stable" and "Stable\n"
 * as different values. See lib/notes/filters.ts.
 */
const QUICK_FILTERS: QuickFilterDef[] = [
  { key: "client", label: "Client", allLabel: "All clients", searchable: true },
  { key: "status", label: "Status", allLabel: "All statuses" },
  { key: "risk", label: "Risk Driver", allLabel: "All risk drivers", searchable: true },
  { key: "owner", label: "Owner", allLabel: "All owners" },
  { key: "cycle", label: "Review Cycle", allLabel: "All cycles", searchable: true },
]

/** Header bands — one per run of consecutive columns sharing a group. */
function bandsFor(cols: NoteColumnDef[]): GroupBand[] {
  const out: GroupBand[] = []
  cols.forEach((c, i) => {
    const last = out[out.length - 1]
    if (last && last.label === c.section) last.colSpan += 1
    else out.push({ key: `${c.section}-${i}`, label: c.section, colSpan: 1 })
  })
  return out
}

function bandStarts(cols: NoteColumnDef[]): Set<number> {
  const starts = new Set<number>()
  let cursor = 0
  for (const b of bandsFor(cols)) {
    if (cursor > 0) starts.add(cursor)
    cursor += b.colSpan
  }
  return starts
}

/** The visible text columns the keyword box searches — dates excluded. */
function searchKeysFor(cols: NoteColumnDef[]): string[] {
  return [...new Set(cols.filter((c) => c.type !== "date").map((c) => c.key))]
}

function haystackFor(row: AdminNoteRow, keys: string[]): string {
  return keys
    .map((k) => {
      const v = (row as unknown as Record<string, unknown>)[k]
      if (typeof v === "boolean") return v ? "yes" : "no"
      if (typeof v === "number") return String(v)
      return typeof v === "string" ? v : ""
    })
    .join(" ")
    .toLowerCase()
}

function matchesKeyword(rows: AdminNoteRow[], keys: string[], query: string): AdminNoteRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return rows
  return rows.filter((r) => {
    const hay = haystackFor(r, keys)
    return terms.every((t) => hay.includes(t))
  })
}

export function NotesView({
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
}: {
  /** Already narrowed to the active view by the server query. */
  rows: AdminNoteRow[]
  views: SavedView[]
  activeViewId: string
  savedConfig: ViewConfig
  activeConfig: ViewConfig
  viewCounts: Record<string, number | null>
  canManageSystemViews: boolean
  readOnlyViews: boolean
  availableColumns: string[] | null
  quickFilters: NoteQuickFilters
  truncated: boolean
  rowCap: number
  matchingRows: number | null
}) {
  const router = useRouter()
  const [switching, startSwitch] = React.useTransition()
  const [query, setQuery] = React.useState("")
  const [scrollTop, setScrollTop] = React.useState(0)
  const [exporting, setExporting] = React.useState(false)
  const [panel, setPanel] = React.useState<null | "columns" | "filters">(null)
  const [viewError, setViewError] = React.useState<string | null>(null)

  const [openId, setOpenId] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<NoteRecord | null>(null)
  const [recordError, setRecordError] = React.useState<string | null>(null)

  const availableSet = React.useMemo(
    () => (availableColumns ? new Set(availableColumns) : null),
    [availableColumns],
  )

  const columns = React.useMemo(
    () =>
      activeConfig.columns
        .map((k) => getNoteColumn(k))
        .filter((c): c is NoteColumnDef => c !== undefined),
    [activeConfig.columns],
  )

  const bands = React.useMemo(() => bandsFor(columns), [columns])
  const bandStartSet = React.useMemo(() => bandStarts(columns), [columns])
  const minWidth = React.useMemo(
    () => columns.reduce((sum, c) => sum + (parseInt(c.width, 10) || 100), 0) + 36,
    [columns],
  )
  const sort = activeConfig.sort
  const dirty = React.useMemo(
    () => configsDiffer(activeConfig, savedConfig),
    [activeConfig, savedConfig],
  )

  const cardRef = React.useRef<HTMLDivElement>(null)
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
   */
  const buildUrl = React.useCallback(
    (config: ViewConfig, quick: NoteQuickFilters) => {
      const params = new URLSearchParams({ view: activeViewId })
      if (configsDiffer(config, savedConfig)) params.set("cfg", encodeConfig(config))
      if (quick.client) params.set("client", quick.client)
      if (quick.status) params.set("status", quick.status)
      if (quick.risk) params.set("risk", quick.risk)
      if (quick.owner) params.set("owner", quick.owner)
      if (quick.cycle) params.set("cycle", quick.cycle)
      return `/notes?${params.toString()}`
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
      const url = buildUrl(activeConfig, next as NoteQuickFilters)
      resetScroll()
      startSwitch(() => router.push(url))
    },
    [activeConfig, buildUrl, resetScroll, router],
  )

  const anyQuickFilter = !!(
    quickFilters.client ||
    quickFilters.status ||
    quickFilters.risk ||
    quickFilters.owner ||
    quickFilters.cycle
  )

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
    const res = await loadNoteFilterOptions()
    return res.ok ? res.data : {}
  }, [])

  const catalogSections = React.useMemo(
    () => noteCatalogBySection() as { section: string; columns: ColumnDef[] }[],
    [],
  )
  const opsForField = React.useCallback((f: string) => sharedOpsForField(NOTES_SPEC, f), [])

  /** Open a record — or swap to another. Clearing happens in the handler, not in
   *  an effect, so a swap shows the loading state rather than the previous
   *  note's values under the new one's header. */
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

  // The effect owns only the async fetch — every setState is in a callback.
  React.useEffect(() => {
    if (!openId) return
    let cancelled = false
    loadNoteRecord(openId).then((res) => {
      if (cancelled) return
      if (res.ok) setRecord(res.data ?? null)
      else setRecordError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [openId])

  const searchKeys = React.useMemo(() => searchKeysFor(columns), [columns])
  const haystacks = React.useMemo(
    () => rows.map((r) => haystackFor(r, searchKeys)),
    [rows, searchKeys],
  )

  // Keyword only — the view's filters and the dropdowns were already applied by
  // the server query, and the rows arrive sorted.
  const sorted = React.useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return rows
    return rows.filter((_r, i) => terms.every((t) => haystacks[i].includes(t)))
  }, [rows, haystacks, query])

  const toggleSort = React.useCallback(
    (key: string) => {
      const col = getNoteColumn(key)
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
  const colCount = columns.length + 1

  async function onExport() {
    setExporting(true)
    setViewError(null)
    try {
      // Rows come from a fresh UNCAPPED server fetch when the page was capped —
      // the export must never be silently truncated. The quick filters go with
      // the request, so the export always matches the ACTIVE VIEW. The keyword
      // box is re-applied here because it is the one filter living in the
      // browser.
      let out = sorted
      if (truncated) {
        const res = await loadNoteRowsForExport({ config: activeConfig, quick: quickFilters })
        if (!res.ok) {
          setViewError(`Export failed: ${res.error}`)
          return
        }
        out = matchesKeyword(res.data, searchKeys, query)
      }
      await exportToExcel(out as unknown as Record<string, unknown>[], columns, {
        sheetName: "Notes",
        fileStem: "crm-notes",
        // The full client name, the whole note body and the action detail are
        // what anyone actually wants from a notes dump — the table shows a
        // ticker and a truncated one-liner, and the action fields are hidden on
        // the default view.
        alwaysInclude: [
          "client_account_name",
          "note_body",
          "review_cycle",
          "action_owner",
          "action_deadline",
        ],
        getColumn: getNoteColumn,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          eyebrow="CRM"
          title="Notes"
          subtitle="Every client-review note in the CRM — status, risk driver and agreed actions, one record per client per monthly cycle. No row scoping is applied, so this page is super-user only."
          rightSlot={
            <div className="flex items-center gap-2">
              <PurgeTestNotesButton />
              <NewNoteButton />
            </div>
          }
        />
      </div>

      <div
        className="relative sticky top-0 z-30 -mx-6 mb-3 flex flex-wrap items-center gap-3 px-6 py-2"
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
          basePath="/notes"
        />

        <QuickFilterBar
          cacheKey="notes"
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
            className="h-9 cursor-pointer rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear filters
          </button>
        )}

        <div className="text-sm font-medium tabular-nums">
          {total.toLocaleString()}
          <span className="ml-1 font-normal text-muted-foreground">
            {total === 1 ? "note" : "notes"}
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

        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              resetScroll()
            }}
            placeholder="Filter by keyword"
            aria-label="Filter notes by keyword"
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

        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPanel((c) => (c === "columns" ? null : "columns"))}
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
            onClick={() => setPanel((c) => (c === "filters" ? null : "filters"))}
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
              getColumn={getNoteColumn}
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
              catalog={NOTES_SPEC.catalog}
              getColumn={getNoteColumn}
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
        <Table style={{ minWidth: `${minWidth}px` }}>
          <TableHeader className="sticky top-0 z-20 bg-card [&_tr]:border-b-0 [&_th]:bg-card">
            <GroupBandRow bands={bands} />
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
                    isSorted={sort.field === col.key ? sort.dir : false}
                    onClick={() => toggleSort(col.key)}
                  />
                </TableHead>
              ))}
              <TableHead className="h-7 w-9 px-2" aria-label="Open record" />
            </TableRow>
            <GradientSweepRow bands={bands} />
          </TableHeader>

          <TableBody>
            {total === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                  {rows.length === 0 ? "No notes returned." : `No notes match “${query}”.`}
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
                    key={r.note_id}
                    style={{ height: ROW_H }}
                    className="cursor-pointer"
                    tabIndex={0}
                    aria-label={`Open note for ${r.client_account_name ?? "client"}`}
                    onClick={(e) => {
                      if (!isInteractiveTarget(e.target)) openRecord(r.note_id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) {
                        openRecord(r.note_id)
                      }
                    }}
                  >
                    {columns.map((col, ci) => (
                      <Cell
                        key={col.key}
                        col={col}
                        bandStart={bandStartSet.has(ci)}
                        row={r}
                        onOpen={() => openRecord(r.note_id)}
                      />
                    ))}
                    <TableCell className="w-9 px-2">
                      <button
                        type="button"
                        onClick={() => openRecord(r.note_id)}
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
      <NoteRecordPane
        onEdit={openId ? () => setEditId(openId) : undefined}
        record={record}
        loading={openId !== null && record === null && recordError === null}
        error={recordError}
        onClose={closeRecord}
      />
      <EditNoteDialog id={editId} onClose={closeEdit} onSaved={afterEdit} />
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
 * whatever the column's `renderer` produces — so a cell can show a ticker while
 * hovering the client's full name, and the Note cell can show one truncated line
 * while hovering the whole note. The Excel export reads the row, never the cell,
 * so it is unaffected by any of it.
 */
function Cell({
  col,
  bandStart,
  row,
  onOpen,
}: {
  col: NoteColumnDef
  bandStart: boolean
  row: AdminNoteRow
  onOpen: () => void
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
        "truncate py-0.5 text-[13px]",
        col.compact ? "px-1 text-center" : "px-2",
        empty && "text-muted-foreground",
        col.type === "date" && "tabular-nums",
      )}
      style={{
        width: col.width,
        maxWidth: col.width,
        ...(bandStart ? BODY_SECTION_START_STYLE : null),
      }}
      title={empty ? undefined : (title ?? undefined)}
      data-column={col.key}
    >
      {empty ? "—" : renderCell(col, row, raw, onOpen)}
    </TableCell>
  )
}

/** Paint one cell, by the column's renderer. Display-only, top to bottom. */
function renderCell(
  col: NoteColumnDef,
  row: AdminNoteRow,
  raw: unknown,
  onOpen: () => void,
): React.ReactNode {
  const text = typeof raw === "string" ? raw : raw == null ? null : String(raw)

  switch (col.renderer) {
    case "date":
      return formatEastern(text)

    case "ticker": {
      // Shows the TICKER and hovers the full name, linking to the same
      // /client-detail?account_id= destination the rest of the app uses. Falls
      // back to plain text with no account id, and to the name with no ticker.
      if (!row.client_account_id) return text
      const link = (
        <Link
          href={`/client-detail?account_id=${row.client_account_id}`}
          className="block min-w-0 truncate font-medium hover:underline"
          style={{ color: BRAND_BLUE }}
        >
          {row.client_ticker ? baseTicker(row.client_ticker) : text}
        </Link>
      )
      // Dashboard-created test note: TEST badge beside the client.
      return row.is_test ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <TestBadge />
          {link}
        </span>
      ) : (
        link
      )
    }

    case "people":
      // Owner / Created By / Modified By — all real full names on this entity.
      // NOT action_owner, which is initials ("LW/RB") and renders as plain text.
      return isPersonName(text) ? (
        <TeamAvatars members={[{ role: col.label, name: text!, bg: "#1E2858", fg: "#FFFFFF" }]} />
      ) : (
        <span className="font-medium">{text}</span>
      )

    case "statusPill": {
      const { bg, text: fg } = noteStatusPill(text)
      return (
        <span
          className="inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: bg, color: fg }}
        >
          {text}
        </span>
      )
    }

    case "body":
      // The note body, as ONE truncated line. The cell's `title` already carries
      // the full text for hover; this makes it read as the thing you click to
      // open the drawer, which is where the note is actually legible.
      //
      // The newlines that make the body worth sourcing from _raw are collapsed
      // to spaces HERE only — a raw \n inside a one-line cell renders as a gap.
      return (
        <button
          type="button"
          onClick={onOpen}
          className="w-full cursor-pointer truncate text-left hover:underline"
          title={text ?? undefined}
        >
          {text?.replace(/\s*\n+\s*/g, " · ")}
        </button>
      )

    case "bool":
      return raw === true ? "Yes" : raw === false ? "No" : text

    case "text":
    default:
      return text
  }
}

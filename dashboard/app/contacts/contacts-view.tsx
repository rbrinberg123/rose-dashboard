"use client"

/**
 * The all-CRM Contacts table. Every contact at every client, no row scoping —
 * see the security note in app/contacts/page.tsx; this component only renders
 * what it is handed.
 *
 * Same architecture as the Meetings, Events, Tasks, Touches and Notes tables, on
 * the same shared pieces: the saved views, the column picker, the filter builder
 * and the quick-filter dropdowns all come from components/table-views/, and the
 * query layer from lib/table-views/. What is local here is only how a CONTACT
 * row is painted.
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
  CONTACTS_SPEC,
  contactCatalogBySection,
  getContactColumn,
  isPersonName,
  type ContactColumnDef,
} from "@/lib/contacts/spec"
import {
  CONTACT_QUICK_FILTER_KEYS,
  hasContactQuickFilters,
  type ContactQuickFilters,
} from "@/lib/contacts/filters"
import type { ContactRecord } from "@/lib/contacts/record"
import type { AdminContactRow } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  createSavedView,
  deleteSavedView,
  loadContactFilterOptions,
  loadContactRecord,
  loadContactRowsForExport,
  setDefaultSavedView,
  updateSavedView,
} from "./actions"
import { ContactRecordPane, contactStatePill } from "./contact-record-pane"
import { TestBadge } from "@/components/test-badge"
import { EditContactDialog, NewContactButton, PurgeTestContactsButton } from "./new-contact-dialog"

// Row geometry. ROW_H must match the rendered row height exactly or the spacers
// drift out of step with the scroll position and the window shows the wrong
// slice. Enforced on every row via an inline height, not left to content.
//
// 30, matching Events, Touches and Notes. Every contacts cell is a single short
// value — a name, a title, a Yes/No — so nothing here wants to wrap.
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
 * `verified_on` is a `date` in the mirror that the view lifts to EASTERN
 * midnight, so formatting it in Eastern returns the same calendar day that was
 * typed into the CRM. Formatting in UTC would show the previous day.
 */
function formatEastern(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : EASTERN_DATE.format(d)
}

/**
 * The eleven quick filters, declared once.
 *
 * Client, Industry and Internal Assignment are `searchable` because each can run
 * to hundreds of choices once contacts are synced; the rest are short closed
 * lists and are better as native selects.
 *
 * The four flag filters and Active/Inactive come back from the options view as
 * TEXT ("true"/"false", "0"/"1") — one UNION, one column type. They are
 * converted back to real booleans and integers in lib/contacts/filters.ts.
 */
const QUICK_FILTERS: QuickFilterDef[] = [
  { key: "client", label: "Client", allLabel: "All clients", searchable: true },
  { key: "contact_type", label: "Contact Type", allLabel: "All types" },
  { key: "industry", label: "Industry", allLabel: "All industries", searchable: true },
  {
    key: "internal_assignment",
    label: "Internal Assignment",
    allLabel: "All assignments",
    searchable: true,
  },
  // Searchable: city is free text from the CRM, so the list is long and messy.
  { key: "city", label: "City", allLabel: "All cities", searchable: true },
  { key: "lead_state", label: "Lead State", allLabel: "All lead states" },
  { key: "state", label: "Active", allLabel: "Active & inactive" },
  { key: "ir_only", label: "IR Only", allLabel: "Any" },
  { key: "poc", label: "PoC", allLabel: "Any" },
  { key: "do_not_call", label: "Do Not Call", allLabel: "Any" },
  { key: "distribution_list", label: "Distro", allLabel: "Any" },
]

/** Header bands — one per run of consecutive columns sharing a group. */
function bandsFor(cols: ContactColumnDef[]): GroupBand[] {
  const out: GroupBand[] = []
  cols.forEach((c, i) => {
    const last = out[out.length - 1]
    if (last && last.label === c.section) last.colSpan += 1
    else out.push({ key: `${c.section}-${i}`, label: c.section, colSpan: 1 })
  })
  return out
}

function bandStarts(cols: ContactColumnDef[]): Set<number> {
  const starts = new Set<number>()
  let cursor = 0
  for (const b of bandsFor(cols)) {
    if (cursor > 0) starts.add(cursor)
    cursor += b.colSpan
  }
  return starts
}

/** The visible text columns the keyword box searches — dates excluded. */
function searchKeysFor(cols: ContactColumnDef[]): string[] {
  return [...new Set(cols.filter((c) => c.type !== "date").map((c) => c.key))]
}

function haystackFor(row: AdminContactRow, keys: string[]): string {
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

function matchesKeyword(
  rows: AdminContactRow[],
  keys: string[],
  query: string,
): AdminContactRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return rows
  return rows.filter((r) => {
    const hay = haystackFor(r, keys)
    return terms.every((t) => hay.includes(t))
  })
}

export function ContactsView({
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
  rows: AdminContactRow[]
  views: SavedView[]
  activeViewId: string
  savedConfig: ViewConfig
  activeConfig: ViewConfig
  viewCounts: Record<string, number | null>
  canManageSystemViews: boolean
  readOnlyViews: boolean
  availableColumns: string[] | null
  quickFilters: ContactQuickFilters
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
  const [record, setRecord] = React.useState<ContactRecord | null>(null)
  const [recordError, setRecordError] = React.useState<string | null>(null)

  const availableSet = React.useMemo(
    () => (availableColumns ? new Set(availableColumns) : null),
    [availableColumns],
  )

  const columns = React.useMemo(
    () =>
      activeConfig.columns
        .map((k) => getContactColumn(k))
        .filter((c): c is ContactColumnDef => c !== undefined),
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
   *
   * The quick filters are written from CONTACT_QUICK_FILTER_KEYS rather than
   * ten hand-written lines, so adding a dropdown cannot leave a param behind
   * that the page reads but the URL never carries.
   */
  const buildUrl = React.useCallback(
    (config: ViewConfig, quick: ContactQuickFilters) => {
      const params = new URLSearchParams({ view: activeViewId })
      if (configsDiffer(config, savedConfig)) params.set("cfg", encodeConfig(config))
      for (const key of CONTACT_QUICK_FILTER_KEYS) {
        const v = quick[key]
        if (v) params.set(key, v)
      }
      return `/contacts?${params.toString()}`
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
      const url = buildUrl(activeConfig, next as ContactQuickFilters)
      resetScroll()
      startSwitch(() => router.push(url))
    },
    [activeConfig, buildUrl, resetScroll, router],
  )

  const anyQuickFilter = hasContactQuickFilters(quickFilters)

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
    const res = await loadContactFilterOptions()
    return res.ok ? res.data : {}
  }, [])

  const catalogSections = React.useMemo(
    () => contactCatalogBySection() as { section: string; columns: ColumnDef[] }[],
    [],
  )
  const opsForField = React.useCallback((f: string) => sharedOpsForField(CONTACTS_SPEC, f), [])

  /** Open a record — or swap to another. Clearing happens in the handler, not in
   *  an effect, so a swap shows the loading state rather than the previous
   *  contact's values under the new one's header. */
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
    loadContactRecord(openId).then((res) => {
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
      const col = getContactColumn(key)
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
        const res = await loadContactRowsForExport({
          config: activeConfig,
          quick: quickFilters,
        })
        if (!res.ok) {
          setViewError(`Export failed: ${res.error}`)
          return
        }
        out = matchesKeyword(res.data, searchKeys, query)
      }
      await exportToExcel(out as unknown as Record<string, unknown>[], columns, {
        sheetName: "Contacts",
        fileStem: "crm-contacts",
        // The full client name and both client-link candidates always ride
        // along: the table shows a ticker, and anyone exporting contacts is
        // very likely doing the very comparison this page exists to settle.
        alwaysInclude: [
          "client_account_name",
          "parent_customer_type",
          "company_master_record_name",
          "first_name",
          "last_name",
        ],
        getColumn: getContactColumn,
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
          title="Contacts"
          subtitle="Every contact in the CRM — the people at client companies, with their role, type and flags. No row scoping is applied, so this page is super-user only."
          rightSlot={
            <div className="flex items-center gap-2">
              <PurgeTestContactsButton />
              <NewContactButton />
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
          basePath="/contacts"
        />

        <QuickFilterBar
          cacheKey="contacts"
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
            {total === 1 ? "contact" : "contacts"}
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
            aria-label="Filter contacts by keyword"
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
              getColumn={getContactColumn}
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
              catalog={CONTACTS_SPEC.catalog}
              getColumn={getContactColumn}
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
                  {rows.length === 0
                    ? // The mirror is filled by the sync, not by the page, so an
                      // empty table on a freshly-deployed Contacts page is the
                      // expected first state rather than a fault. Say so.
                      "No contacts returned. If the contacts sync has not run yet, this table is empty until it does."
                    : `No contacts match “${query}”.`}
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
                    key={r.contact_id}
                    style={{ height: ROW_H }}
                    className="cursor-pointer"
                    tabIndex={0}
                    aria-label={`Open contact record for ${r.full_name ?? "contact"}`}
                    onClick={(e) => {
                      if (!isInteractiveTarget(e.target)) openRecord(r.contact_id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) {
                        openRecord(r.contact_id)
                      }
                    }}
                  >
                    {columns.map((col, ci) => (
                      <Cell
                        key={col.key}
                        col={col}
                        bandStart={bandStartSet.has(ci)}
                        row={r}
                      />
                    ))}
                    <TableCell className="w-9 px-2">
                      <button
                        type="button"
                        onClick={() => openRecord(r.contact_id)}
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
      <ContactRecordPane
        onEdit={openId ? () => setEditId(openId) : undefined}
        record={record}
        loading={openId !== null && record === null && recordError === null}
        error={recordError}
        onClose={closeRecord}
      />
      <EditContactDialog id={editId} onClose={closeEdit} onSaved={afterEdit} />
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
 * hovering the client's full name. The Excel export reads the row, never the
 * cell, so it is unaffected by any of it.
 */
function Cell({
  col,
  bandStart,
  row,
}: {
  col: ContactColumnDef
  bandStart: boolean
  row: AdminContactRow
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
      {empty ? "—" : renderCell(col, row, raw)}
    </TableCell>
  )
}

/** Paint one cell, by the column's renderer. Display-only, top to bottom. */
function renderCell(col: ContactColumnDef, row: AdminContactRow, raw: unknown): React.ReactNode {
  const text = typeof raw === "string" ? raw : raw == null ? null : String(raw)

  switch (col.renderer) {
    case "date":
      return formatEastern(text)

    case "ticker": {
      // The CLIENT. Shows the ticker and hovers the full name, linking to the
      // same /client-detail?account_id= destination the rest of the app uses.
      //
      // Falls back to PLAIN TEXT when the parent did not resolve to an account —
      // which on this entity is a real and expected case, not an error: a
      // contact's parentcustomerid can point at another contact, and the view's
      // join is guarded on parent_customer_type = 'account'. Showing the parent's
      // name unlinked is the honest rendering.
      if (!row.client_account_id) return text
      return (
        <Link
          href={`/client-detail?account_id=${row.client_account_id}`}
          className="block min-w-0 truncate font-medium hover:underline"
          style={{ color: BRAND_BLUE }}
        >
          {row.client_ticker ? baseTicker(row.client_ticker) : text}
        </Link>
      )
    }

    case "people":
      // Dashboard-created test contact: TEST badge beside the name.
      if (col.key === "full_name" && row.is_test) {
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <TestBadge />
            <span className="truncate font-medium">{text}</span>
          </span>
        )
      }
      // The contact themselves — initials circle plus the name. Unlike the other
      // CRM tables, where the avatar marks a systemuser, here the person IS the
      // row, so the name rides alongside the circle rather than hiding behind it.
      return isPersonName(text) ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <TeamAvatars
            members={[{ role: col.label, name: text!, bg: "#1E2858", fg: "#FFFFFF" }]}
          />
          <span className="truncate font-medium">{text}</span>
        </span>
      ) : (
        <span className="font-medium">{text}</span>
      )

    case "statePill": {
      const { bg, text: fg } = contactStatePill(text)
      return (
        <span
          className="inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: bg, color: fg }}
        >
          {text}
        </span>
      )
    }

    case "bool":
      return raw === true ? "Yes" : raw === false ? "No" : text

    case "text":
    default:
      return text
  }
}

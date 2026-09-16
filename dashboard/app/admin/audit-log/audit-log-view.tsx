"use client"

/**
 * Admin → Audit Log: the virtualized table, the filter bar, and the detail
 * drawer.
 *
 * ⚠️  READ-ONLY. There is no write control anywhere on this page. `audit_log` is
 * append-only and the database blocks mutation outright; the viewer only reads.
 *
 * Same architecture as the CRM tables (app/notes/notes-view.tsx and friends):
 * a windowed body with two spacer rows, a sticky header, filters that live in
 * the URL and are applied server-side, and a drawer rendered as a SIBLING of
 * the list so opening a record cannot remount the table.
 *
 * What it deliberately does NOT reuse is the saved-views machinery in
 * lib/table-views/. That machinery is built around an `EntitySpec` with its own
 * `*_saved_views` table, column catalog and built-in presets — and this is an
 * admin log with six fixed columns, not a working surface anyone curates views
 * of. Wiring it in would mean a seventh saved-views table for no benefit.
 */

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PanelRightOpen, Search, X } from "lucide-react"

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
import { SUBHEADER_BG } from "@/components/table-group-header"
import { BRAND_BLUE, CANVAS, CARD_CLASS, STATUS_PILL_LIGHT } from "@/lib/design"
import {
  ACTION_PILL,
  actionLabel,
  contextWithoutViewAs,
  entityLabel,
  entityOptions,
  viewAsFrom,
  type AuditAction,
  type AuditListRow,
  type NameLookup,
} from "@/lib/audit-log/labels"
import { cn } from "@/lib/utils"
import { loadAuditActors, loadAuditRecord, type AuditRecordDetail } from "./actions"

export type AuditFilters = {
  actor?: string
  entity?: string
  action?: string
  from?: string
  to?: string
  record?: string
  all?: boolean
}

// Row geometry. ROW_H must match the rendered row height exactly or the spacers
// drift out of step with the scroll position. 30, matching the CRM tables:
// every cell is one truncated line.
const ROW_H = 30
const OVERSCAN = 12

const SCROLLER_CLASSES =
  "[&_[data-slot=table-container]]:h-[calc(100vh-20rem)] " +
  "[&_[data-slot=table-container]]:min-h-[300px] " +
  "[&_[data-slot=table-container]]:overflow-y-auto"

const VIEWPORT_H_FALLBACK = 560

/** Date AND time — an audit entry's minute matters. */
const EASTERN_DT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "numeric",
  day: "numeric",
  year: "2-digit",
  hour: "numeric",
  minute: "2-digit",
})

function formatWhen(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : EASTERN_DT.format(d)
}

const CONTROL =
  "h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"

const COLUMNS = [
  { key: "occurred_at", label: "When", width: "132px" },
  { key: "actor_email", label: "Actor", width: "170px" },
  { key: "action", label: "Action", width: "92px" },
  { key: "entity", label: "Entity", width: "180px" },
  { key: "record_id", label: "Record", width: "230px" },
  { key: "summary", label: "Summary", width: "420px" },
] as const

export function AuditLogView({
  rows,
  totalMatching,
  truncated,
  rowCap,
  filters,
  isHistory,
  defaultDays,
  actorNames,
  recordLabels,
  recordAccountIds,
  tableMissing,
  patchPath,
}: {
  rows: AuditListRow[]
  totalMatching: number
  truncated: boolean
  rowCap: number
  filters: AuditFilters
  isHistory: boolean
  defaultDays: number
  actorNames: NameLookup
  recordLabels: Record<number, string>
  recordAccountIds: Record<number, string>
  tableMissing: boolean
  patchPath: string
}) {
  const router = useRouter()
  const [switching, startSwitch] = React.useTransition()
  const [query, setQuery] = React.useState("")
  const [scrollTop, setScrollTop] = React.useState(0)
  const [actors, setActors] = React.useState<string[] | null>(null)

  const [openId, setOpenId] = React.useState<number | null>(null)
  const [record, setRecord] = React.useState<AuditRecordDetail | null>(null)
  const [recordError, setRecordError] = React.useState<string | null>(null)

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

  // The actor list, fetched AFTER the table paints — nothing on screen needs a
  // dropdown's contents in order to render rows.
  React.useEffect(() => {
    let cancelled = false
    loadAuditActors().then((res) => {
      if (!cancelled) setActors(res.ok ? res.data : [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const resetScroll = React.useCallback(() => {
    setScrollTop(0)
    scrollerRef.current?.scrollTo({ top: 0 })
  }, [])

  /** Every filter lives in the URL, so a filtered view is shareable. */
  const applyFilters = React.useCallback(
    (next: AuditFilters) => {
      const p = new URLSearchParams()
      if (next.actor) p.set("actor", next.actor)
      if (next.entity) p.set("entity", next.entity)
      if (next.action) p.set("action", next.action)
      if (next.from) p.set("from", next.from)
      if (next.to) p.set("to", next.to)
      if (next.record) p.set("record", next.record)
      if (next.all) p.set("all", "1")
      resetScroll()
      startSwitch(() => router.push(`/admin/audit-log${p.size ? `?${p}` : ""}`))
    },
    [resetScroll, router],
  )

  const set = React.useCallback(
    (patch: Partial<AuditFilters>) => applyFilters({ ...filters, ...patch }),
    [applyFilters, filters],
  )

  const anyFilter = !!(
    filters.actor ||
    filters.entity ||
    filters.action ||
    filters.from ||
    filters.to ||
    filters.record ||
    filters.all
  )

  /* -------------------------------------------------- keyword (in-browser) */

  // The one filter that is NOT server-side, matching the CRM tables: it narrows
  // the already-fetched page across record + summary, which are derived strings
  // rather than columns the database could index.
  const filtered = React.useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return rows
    return rows.filter((r) => {
      const hay = `${recordLabels[r.id] ?? r.record_id ?? ""} ${r.summary ?? ""} ${entityLabel(
        r.entity,
      )} ${r.actor_email ?? ""}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }, [rows, query, recordLabels])

  const total = filtered.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
  const visible = filtered.slice(first, last)
  const padTop = first * ROW_H
  const padBottom = Math.max(0, (total - last) * ROW_H)
  const colCount = COLUMNS.length + 1

  /* ------------------------------------------------------------- drawer */

  const openRecord = React.useCallback((id: number) => {
    setRecord(null)
    setRecordError(null)
    setOpenId(id)
  }, [])

  const closeRecord = React.useCallback(() => {
    setRecord(null)
    setRecordError(null)
    setOpenId(null)
  }, [])

  React.useEffect(() => {
    if (openId === null) return
    let cancelled = false
    loadAuditRecord(openId).then((res) => {
      if (cancelled) return
      if (res.ok) setRecord(res.data ?? null)
      else setRecordError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [openId])

  const windowLabel = isHistory
    ? "full history"
    : filters.all
      ? "all time"
      : filters.from || filters.to
        ? "custom range"
        : `last ${defaultDays} days`

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          eyebrow="Admin"
          title="Audit Log"
          subtitle="Every change made through the dashboard — who, what, and the old → new values. Read-only and append-only. Super-user only."
        />
      </div>

      {tableMissing && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px]">
          <div className="font-medium text-destructive">
            The <code>audit_log</code> table does not exist yet
          </div>
          <div className="mt-1 text-muted-foreground">
            Run <code>{patchPath}</code> in Supabase, then reload. Until then this page is empty
            and every write in the app logs a console warning instead of a row — no save is
            affected.
          </div>
        </div>
      )}

      {isHistory && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-input bg-muted/40 px-4 py-2 text-[13px]">
          <span className="font-medium">Showing the full history of one record</span>
          <span className="text-muted-foreground">
            {entityLabel(filters.entity ?? "")} · {filters.record}
          </span>
          <span className="text-muted-foreground">— oldest first, date window ignored.</span>
          <button
            type="button"
            onClick={() => applyFilters({})}
            className="cursor-pointer font-medium hover:underline"
            style={{ color: BRAND_BLUE }}
          >
            Back to all activity
          </button>
        </div>
      )}

      {/* ------------------------------------------------------ filter bar */}
      <div
        className="relative sticky top-0 z-30 -mx-6 mb-3 flex flex-wrap items-center gap-2 px-6 py-2"
        style={{ background: CANVAS }}
      >
        <label htmlFor="af-actor" className="sr-only">
          Actor
        </label>
        <select
          id="af-actor"
          value={filters.actor ?? ""}
          disabled={switching || actors === null}
          onChange={(e) => set({ actor: e.target.value || undefined })}
          className={cn(CONTROL, "max-w-[210px]")}
        >
          <option value="">{actors === null ? "Actor — loading…" : "All actors"}</option>
          {/* A URL can name an actor before the list arrives; keep it selectable. */}
          {filters.actor && !(actors ?? []).includes(filters.actor) && (
            <option value={filters.actor}>{actorNames[filters.actor] ?? filters.actor}</option>
          )}
          {(actors ?? []).map((a) => (
            <option key={a} value={a}>
              {actorNames[a.toLowerCase()] ?? a}
            </option>
          ))}
        </select>

        <label htmlFor="af-entity" className="sr-only">
          Entity
        </label>
        <select
          id="af-entity"
          value={filters.entity ?? ""}
          disabled={switching}
          onChange={(e) =>
            // Changing the entity abandons a single-record history — the record
            // id belongs to the old entity and would return nothing.
            set({ entity: e.target.value || undefined, record: undefined })
          }
          className={cn(CONTROL, "max-w-[210px]")}
        >
          <option value="">All entities</option>
          {entityOptions().map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <label htmlFor="af-action" className="sr-only">
          Action
        </label>
        <select
          id="af-action"
          value={filters.action ?? ""}
          disabled={switching}
          onChange={(e) => set({ action: e.target.value || undefined })}
          className={cn(CONTROL, "max-w-[140px]")}
        >
          <option value="">All actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
        </select>

        <div className="flex items-center gap-1">
          <label htmlFor="af-from" className="text-[11px] text-muted-foreground">
            From
          </label>
          <input
            id="af-from"
            type="date"
            value={filters.from ?? ""}
            disabled={switching}
            onChange={(e) => set({ from: e.target.value || undefined })}
            className={cn(CONTROL, "w-[142px]")}
          />
          <label htmlFor="af-to" className="ml-1 text-[11px] text-muted-foreground">
            To
          </label>
          <input
            id="af-to"
            type="date"
            value={filters.to ?? ""}
            disabled={switching}
            onChange={(e) => set({ to: e.target.value || undefined })}
            className={cn(CONTROL, "w-[142px]")}
          />
        </div>

        <Button
          type="button"
          variant={filters.all ? "default" : "outline"}
          size="sm"
          disabled={switching}
          onClick={() => set({ all: !filters.all, from: undefined, to: undefined })}
          className="cursor-pointer"
          title="Ignore the date window and search the whole trail"
        >
          All time
        </Button>

        {anyFilter && (
          <button
            type="button"
            onClick={() => applyFilters({})}
            className="h-9 cursor-pointer rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear filters
          </button>
        )}

        <div className="text-sm font-medium tabular-nums">
          {total.toLocaleString()}
          <span className="ml-1 font-normal text-muted-foreground">
            {total === 1 ? "entry" : "entries"}
          </span>
          {total !== rows.length && (
            <span className="ml-1 font-normal text-muted-foreground">
              of {rows.length.toLocaleString()}
            </span>
          )}
          <span className="ml-1 font-normal text-muted-foreground">· {windowLabel}</span>
          {switching && <span className="ml-2 font-normal text-muted-foreground">Loading…</span>}
        </div>

        {truncated && (
          <span
            className="rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
            title="Narrow the date range or the filters to see the rest."
          >
            Showing first {rowCap.toLocaleString()} of {totalMatching.toLocaleString()} — narrow
            the filters.
          </span>
        )}

        <div className="relative ml-auto min-w-[180px] sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              resetScroll()
            }}
            placeholder="Search record or summary"
            aria-label="Search the loaded entries by keyword"
            className="h-9 pl-8 pr-8"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("")
                resetScroll()
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------- table */}
      <div ref={cardRef} className={`${CARD_CLASS} overflow-hidden ${SCROLLER_CLASSES}`}>
        <Table style={{ minWidth: "1224px" }}>
          <TableHeader className="sticky top-0 z-20 bg-card [&_tr]:border-b-0 [&_th]:bg-card">
            <TableRow className="border-b-0" style={{ backgroundColor: SUBHEADER_BG }}>
              {COLUMNS.map((col) => (
                <TableHead
                  key={col.key}
                  className="h-8 px-2"
                  style={{ width: col.width, minWidth: col.width }}
                >
                  <SortHeader
                    label={col.label}
                    // The trail has ONE meaningful order — when it happened —
                    // and the server decides the direction (newest first, or
                    // oldest first in a per-record history). Re-sorting a log
                    // by entity would only hide the sequence, so the headers
                    // are labels, not controls.
                    isSorted={col.key === "occurred_at" ? (isHistory ? "asc" : "desc") : false}
                    onClick={() => {}}
                  />
                </TableHead>
              ))}
              <TableHead className="h-8 w-9 px-2" aria-label="Open entry" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {total === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                  {tableMissing
                    ? "No trail yet — run the patch above."
                    : rows.length === 0
                      ? anyFilter
                        ? "No entries match these filters."
                        : `No changes recorded in the ${windowLabel}.`
                      : `No entries match “${query}”.`}
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
                  <Row
                    key={r.id}
                    row={r}
                    actorNames={actorNames}
                    recordLabel={recordLabels[r.id] ?? r.record_id ?? "—"}
                    accountId={recordAccountIds[r.id] ?? null}
                    onOpen={() => openRecord(r.id)}
                  />
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

      {/* A SIBLING of the list, never wrapping it. */}
      <AuditRecordPane
        record={record}
        loading={openId !== null && record === null && recordError === null}
        error={recordError}
        actorNames={actorNames}
        onClose={closeRecord}
        onShowHistory={(entity, recordId) => {
          closeRecord()
          applyFilters({ entity, record: recordId })
        }}
      />
    </>
  )
}

/* -------------------------------------------------------------------------- */

function Row({
  row,
  actorNames,
  recordLabel,
  accountId,
  onOpen,
}: {
  row: AuditListRow
  actorNames: NameLookup
  recordLabel: string
  accountId: string | null
  onOpen: () => void
}) {
  const actor = row.actor_email ? (actorNames[row.actor_email.toLowerCase()] ?? row.actor_email) : null
  const viewAs = viewAsFrom(row.context)
  const pill = STATUS_PILL_LIGHT[ACTION_PILL[row.action as AuditAction] ?? "neutral"]

  return (
    <TableRow
      style={{ height: ROW_H }}
      className="cursor-pointer"
      tabIndex={0}
      aria-label={`Open audit entry ${row.id}`}
      onClick={(e) => {
        if (!isInteractiveTarget(e.target)) onOpen()
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onOpen()
      }}
    >
      <TableCell className="truncate px-2 py-0.5 text-[13px] tabular-nums">
        {formatWhen(row.occurred_at)}
      </TableCell>

      <TableCell className="truncate px-2 py-0.5 text-[13px]" title={row.actor_email ?? undefined}>
        {actor ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <TeamAvatars members={[{ role: "Actor", name: actor, bg: "#1E2858", fg: "#FFFFFF" }]} />
            <span className="truncate">{actor}</span>
            {/* An action taken while impersonating is worth seeing at a glance. */}
            {viewAs && (
              <span
                className="shrink-0 rounded px-1 text-[9px] font-medium uppercase"
                style={{ backgroundColor: "#FCF4E6", color: "#92600B" }}
                title={`Performed while viewing as ${viewAs}`}
              >
                view-as
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">system / cron</span>
        )}
      </TableCell>

      <TableCell className="px-2 py-0.5">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: pill.bg, color: pill.text }}
        >
          {actionLabel(row.action)}
        </span>
      </TableCell>

      <TableCell className="truncate px-2 py-0.5 text-[13px]" title={row.entity}>
        {entityLabel(row.entity)}
      </TableCell>

      <TableCell className="truncate px-2 py-0.5 text-[13px]" title={row.record_id ?? undefined}>
        {accountId ? (
          <Link
            href={`/client-detail?account_id=${accountId}`}
            className="font-medium hover:underline"
            style={{ color: BRAND_BLUE }}
          >
            {recordLabel}
          </Link>
        ) : (
          recordLabel
        )}
      </TableCell>

      <TableCell
        className="truncate px-2 py-0.5 text-[13px] text-muted-foreground"
        title={row.summary ?? undefined}
      >
        {row.summary ?? "—"}
      </TableCell>

      <TableCell className="w-9 px-2">
        <button
          type="button"
          onClick={onOpen}
          title="Open entry"
          aria-label="Open entry"
          className="cursor-pointer text-muted-foreground hover:text-foreground"
        >
          <PanelRightOpen className="size-3.5" />
        </button>
      </TableCell>
    </TableRow>
  )
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("a, button, input, select, textarea, label, [role=button], [role=link]") !== null
  )
}

/* -------------------------------------------------------------------------- */

const EASTERN_FULL = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  dateStyle: "medium",
  timeStyle: "short",
})

/** The drawer: the whole entry, with the diff as a field-by-field old → new list. */
function AuditRecordPane({
  record,
  loading,
  error,
  actorNames,
  onClose,
  onShowHistory,
}: {
  record: AuditRecordDetail | null
  loading: boolean
  error: string | null
  actorNames: NameLookup
  onClose: () => void
  onShowHistory: (entity: string, recordId: string) => void
}) {
  const open = loading || !!record || !!error
  if (!open) return null

  // The diff arrives ALREADY RENDERED — the action resolved every uuid to a
  // person or client name server-side, so the browser never needs the accounts
  // and users lookups. See loadAuditRecord.
  const lines = record?.lines ?? []
  const actor = record?.actor_email
    ? (actorNames[record.actor_email.toLowerCase()] ?? record.actor_email)
    : null
  const viewAs = viewAsFrom(record?.context ?? null)
  const where = contextWithoutViewAs(record?.context ?? null)
  const pill = record
    ? STATUS_PILL_LIGHT[ACTION_PILL[record.action as AuditAction] ?? "neutral"]
    : STATUS_PILL_LIGHT.neutral
  const recLabel = record?.recordLabel ?? "—"

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-black/10" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Audit entry"
        className="fixed right-0 top-0 z-50 flex h-screen w-[560px] max-w-[94vw] flex-col border-l border-[#E5E8EC] bg-white shadow-2xl"
      >
        <header className="border-b border-[#E5E8EC] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-[#9AA1AD]">
                Audit entry
              </div>
              <h2 className="truncate text-[17px] font-semibold text-[#1A2233]">
                {record ? entityLabel(record.entity) : loading ? "Loading…" : "Entry"}
              </h2>
              {record && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: pill.bg, color: pill.text }}
                  >
                    {actionLabel(record.action)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {EASTERN_FULL.format(new Date(record.occurred_at))}
                  </span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {loading && !record && (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading entry…</div>
          )}

          {record && (
            <>
              <section className="mb-5">
                <SectionHeader title="Entry" />
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Field label="When" value={EASTERN_FULL.format(new Date(record.occurred_at))} />
                  <Field label="Action" value={actionLabel(record.action)} />
                  <Field label="Actor" value={actor ?? "system / cron"} person={!!actor} />
                  <Field label="Actor email" value={record.actor_email ?? "—"} />
                  {viewAs && (
                    <Field
                      label="Performed while viewing as"
                      value={viewAs}
                      hint="A super-user was impersonating. The actor above is the REAL person."
                    />
                  )}
                  <Field label="Entity" value={entityLabel(record.entity)} hint={record.entity} />
                  <Field label="Record" value={recLabel} hint={record.record_id ?? undefined} />
                  {where && <Field label="Where" value={where} />}
                </div>
              </section>

              <section className="mb-5">
                <SectionHeader
                  title={
                    record.action === "update"
                      ? "What changed"
                      : record.action === "create"
                        ? "Created with"
                        : "Removed row"
                  }
                />
                {lines.length === 0 ? (
                  <div className="rounded-md border border-[#E4E9F4] bg-[#F4F6FB] px-2 py-2 text-[13px] text-muted-foreground">
                    No field detail was recorded for this entry.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-md border border-[#E4E9F4]">
                    <table className="w-full text-[13px]">
                      <tbody>
                        {lines.map((l, i) => (
                          <tr key={`${l.label}-${i}`} className="border-b last:border-b-0">
                            <td className="w-[38%] bg-[#F4F6FB] px-2 py-1.5 align-top text-[12px] text-[#5B6472]">
                              {l.label}
                            </td>
                            <td className="px-2 py-1.5 align-top">
                              {l.old === null ? (
                                <span className="whitespace-pre-wrap">{l.new}</span>
                              ) : (
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-muted-foreground line-through">
                                    {l.old}
                                  </span>
                                  <span className="text-muted-foreground">→</span>
                                  <span className="font-medium">{l.new}</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {record.record_id && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => onShowHistory(record.entity, record.record_id as string)}
                >
                  View full history for this record
                </Button>
              )}

              <p className="mt-4 pb-4 text-[11px] text-muted-foreground">
                The audit trail is append-only — entries cannot be edited or deleted, by this page
                or by anyone. A correction is a new entry.
              </p>
            </>
          )}
        </div>
      </aside>
    </>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#5B6472]">
        {title}
      </div>
      <div
        className="mt-1 h-[2px] w-full rounded-full"
        style={{ background: "linear-gradient(90deg, #1E2858, #0355A7, #1C8C9C)" }}
      />
    </div>
  )
}

function Field({
  label,
  value,
  hint,
  person,
}: {
  label: string
  value: string
  hint?: string
  person?: boolean
}) {
  return (
    <div>
      <div className="text-[11px] text-[#9AA1AD]">{label}</div>
      <div
        className="mt-0.5 flex items-center gap-2 rounded-md border border-[#E4E9F4] bg-[#F4F6FB] px-2 py-1 text-[13px]"
        title={hint}
      >
        {person && (
          <TeamAvatars members={[{ role: label, name: value, bg: "#1E2858", fg: "#FFFFFF" }]} />
        )}
        <span className="min-w-0 truncate">{value}</span>
      </div>
    </div>
  )
}

"use client"

/**
 * CRM → Time Off: the virtualized list, the filter bar and the record drawer.
 *
 * Same architecture as the Audit Log viewer (app/admin/audit-log/audit-log-view.tsx):
 * a windowed body with two spacer rows, a sticky header, and a drawer rendered
 * as a SIBLING of the list. Like the Audit Log it deliberately does NOT use the
 * lib/table-views saved-views machinery — a fixed eight-column list of ~480
 * rows does not need a saved-views table. All rows are loaded, so the four
 * filters and the keyword box run in the browser.
 *
 * Edit / Delete / Approve / Deny buttons are shown per the record's flags, but
 * the RULES live server-side in ./actions.ts.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, PanelRightOpen, Pencil, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import { ListTitleCard } from "@/components/page-masthead"
import { SortHeader } from "@/components/sort-header"
import { TestBadge } from "@/components/test-badge"
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
import { CANVAS, CARD_CLASS, STATUS_PILL_LIGHT } from "@/lib/design"
import {
  TIME_OFF_REQUEST_TYPES,
  TIME_OFF_STATUSES,
  formatDays,
  type TimeOffListRow,
  type TimeOffRecord,
} from "@/lib/time-off-requests/model"
import { cn } from "@/lib/utils"
import { deleteTimeOffRequest, loadTimeOffRecord } from "./actions"
import { ReviewControls } from "./review-controls"
import { EditTimeOffDialog, NewTimeOffButton, PurgeTestTimeOffButton } from "./time-off-form-dialog"

const ROW_H = 30
const OVERSCAN = 12
const VIEWPORT_H_FALLBACK = 560

const SCROLLER_CLASSES =
  "[&_[data-slot=table-container]]:h-[calc(100vh-20rem)] " +
  "[&_[data-slot=table-container]]:min-h-[300px] " +
  "[&_[data-slot=table-container]]:overflow-y-auto"

const CONTROL = "h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"

const COLUMNS = [
  { key: "requested_by_name", label: "Requested By", width: "190px" },
  { key: "start_date", label: "Start", width: "104px" },
  { key: "end_date", label: "End", width: "104px" },
  { key: "request_type", label: "Request Type", width: "130px" },
  { key: "total_days", label: "Total Days", width: "96px" },
  { key: "status", label: "Status", width: "104px" },
  { key: "reviewing_team", label: "Reviewing Team", width: "220px" },
  { key: "source", label: "Source", width: "130px" },
] as const

type Filters = { type: string; status: string; source: string; person: string }
const NO_FILTERS: Filters = { type: "", status: "", source: "", person: "" }

/** "10/12/26" for a YYYY-MM-DD calendar day — no zone shift. */
function formatDay(ymd: string | null): string {
  if (!ymd) return "—"
  const [y, m, d] = ymd.split("-")
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`
}

const STATUS_TONE: Record<string, { bg: string; text: string }> = {
  Pending: STATUS_PILL_LIGHT.watch,
  Approved: STATUS_PILL_LIGHT.positive,
  Denied: STATUS_PILL_LIGHT.atRisk,
}

function StatusPill({ status }: { status: string | null }) {
  const tone = STATUS_TONE[status ?? ""] ?? STATUS_PILL_LIGHT.neutral
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: tone.bg, color: tone.text }}
    >
      {status ?? "—"}
    </span>
  )
}

function SourceBadge({ source, isTest }: { source: string; isTest: boolean | null }) {
  const tone = source === "Dashboard" ? STATUS_PILL_LIGHT.new : STATUS_PILL_LIGHT.neutral
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span
        className="inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium"
        style={{ backgroundColor: tone.bg, color: tone.text }}
      >
        {source}
      </span>
      {isTest && <TestBadge />}
    </span>
  )
}

export function TimeOffRequestsView({
  rows,
  truncated,
}: {
  rows: TimeOffListRow[]
  truncated: boolean
}) {
  const [filters, setFilters] = React.useState<Filters>(NO_FILTERS)
  const [query, setQuery] = React.useState("")
  const [scrollTop, setScrollTop] = React.useState(0)
  const [open, setOpen] = React.useState<{ id: string; source: TimeOffListRow["source"] } | null>(null)

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

  const set = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }))
    resetScroll()
  }

  /** Everyone who appears in the list, for the Person filter. */
  const people = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) {
      const key = r.requested_by_id ?? r.requested_by_name ?? ""
      if (key && !m.has(key)) m.set(key, r.requested_by_name ?? "(unknown)")
    }
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const filtered = React.useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return rows.filter((r) => {
      if (filters.type && r.request_type !== filters.type) return false
      if (filters.status && r.status !== filters.status) return false
      if (filters.source && r.source !== filters.source) return false
      if (filters.person && (r.requested_by_id ?? r.requested_by_name) !== filters.person) return false
      if (!terms.length) return true
      const hay = `${r.requested_by_name ?? ""} ${r.request_type ?? ""} ${r.description ?? ""} ${
        r.reviewing_team ?? ""
      }`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }, [rows, filters, query])

  const anyFilter = !!(filters.type || filters.status || filters.source || filters.person || query)
  const pendingCount = rows.filter((r) => r.status === "Pending").length

  const total = filtered.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
  const visible = filtered.slice(first, last)
  const padTop = first * ROW_H
  const padBottom = Math.max(0, (total - last) * ROW_H)
  const colCount = COLUMNS.length + 1

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          eyebrow="CRM"
          title="Time Off"
          subtitle="Every time-off request — the Dynamics history (read-only) plus requests made here, which go Pending → Approved / Denied by the person's reviewing team. Super-user only for now."
          rightSlot={
            <div className="flex items-center gap-2">
              <PurgeTestTimeOffButton />
              <NewTimeOffButton />
            </div>
          }
        />
      </div>

      {/* ------------------------------------------------------ filter bar */}
      <div
        className="relative sticky top-0 z-30 -mx-6 mb-3 flex flex-wrap items-center gap-2 px-6 py-2"
        style={{ background: CANVAS }}
      >
        <select
          aria-label="Request type"
          value={filters.type}
          onChange={(e) => set({ type: e.target.value })}
          className={cn(CONTROL, "max-w-[170px]")}
        >
          <option value="">All types</option>
          {TIME_OFF_REQUEST_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={filters.status}
          onChange={(e) => set({ status: e.target.value })}
          className={cn(CONTROL, "max-w-[150px]")}
        >
          <option value="">All statuses</option>
          {TIME_OFF_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
              {s === "Pending" && pendingCount ? ` (${pendingCount})` : ""}
            </option>
          ))}
        </select>
        <select
          aria-label="Source"
          value={filters.source}
          onChange={(e) => set({ source: e.target.value })}
          className={cn(CONTROL, "max-w-[150px]")}
        >
          <option value="">All sources</option>
          <option value="Dashboard">Dashboard</option>
          <option value="Dynamics">Dynamics</option>
        </select>
        <select
          aria-label="Person"
          value={filters.person}
          onChange={(e) => set({ person: e.target.value })}
          className={cn(CONTROL, "max-w-[210px]")}
        >
          <option value="">All people</option>
          {people.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>

        {anyFilter && (
          <button
            type="button"
            onClick={() => {
              setFilters(NO_FILTERS)
              setQuery("")
              resetScroll()
            }}
            className="h-9 cursor-pointer rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear filters
          </button>
        )}

        <div className="text-sm font-medium tabular-nums">
          {total.toLocaleString()}
          <span className="ml-1 font-normal text-muted-foreground">
            {total === 1 ? "request" : "requests"}
          </span>
          {total !== rows.length && (
            <span className="ml-1 font-normal text-muted-foreground">of {rows.length.toLocaleString()}</span>
          )}
        </div>

        {truncated && (
          <span className="rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            Showing the first {rows.length.toLocaleString()} only.
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
            placeholder="Search person, type, description"
            aria-label="Search the requests by keyword"
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
        <Table style={{ minWidth: "1114px" }}>
          <TableHeader className="sticky top-0 z-20 bg-card [&_tr]:border-b-0 [&_th]:bg-card">
            <TableRow className="border-b-0" style={{ backgroundColor: SUBHEADER_BG }}>
              {COLUMNS.map((col) => (
                <TableHead key={col.key} className="h-8 px-2" style={{ width: col.width, minWidth: col.width }}>
                  {/* Newest start date first, fixed — headers are labels, not sort controls. */}
                  <SortHeader
                    label={col.label}
                    isSorted={col.key === "start_date" ? "desc" : false}
                    onClick={() => {}}
                  />
                </TableHead>
              ))}
              <TableHead className="h-8 w-9 px-2" aria-label="Open request" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {total === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                  {rows.length === 0 ? "No time-off requests yet." : "No requests match these filters."}
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
                    key={`${r.source}:${r.id}`}
                    row={r}
                    onOpen={() => setOpen({ id: r.id, source: r.source })}
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

      {/* A SIBLING of the list, never wrapping it. Keyed so each open starts fresh. */}
      {open && (
        <TimeOffPane
          key={`${open.source}:${open.id}`}
          id={open.id}
          source={open.source}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}

function Row({ row, onOpen }: { row: TimeOffListRow; onOpen: () => void }) {
  return (
    <TableRow
      style={{ height: ROW_H }}
      className="cursor-pointer"
      tabIndex={0}
      aria-label={`Open time off for ${row.requested_by_name ?? "unknown"}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onOpen()
      }}
    >
      <TableCell className="truncate px-2 py-0.5 text-[13px]">
        <span className="flex min-w-0 items-center gap-1.5">
          {row.requested_by_name && (
            <TeamAvatars
              members={[{ role: "Requested by", name: row.requested_by_name, bg: "#1E2858", fg: "#FFFFFF" }]}
            />
          )}
          <span className="truncate">{row.requested_by_name ?? "—"}</span>
        </span>
      </TableCell>
      <TableCell className="px-2 py-0.5 text-[13px] tabular-nums">{formatDay(row.start_date)}</TableCell>
      <TableCell className="px-2 py-0.5 text-[13px] tabular-nums">{formatDay(row.end_date)}</TableCell>
      <TableCell className="truncate px-2 py-0.5 text-[13px]">{row.request_type ?? "—"}</TableCell>
      <TableCell className="px-2 py-0.5 text-[13px] tabular-nums">{formatDays(row.total_days)}</TableCell>
      <TableCell className="px-2 py-0.5">
        <StatusPill status={row.status} />
      </TableCell>
      <TableCell className="truncate px-2 py-0.5 text-[13px] text-muted-foreground" title={row.reviewing_team ?? undefined}>
        {row.reviewing_team ?? "—"}
      </TableCell>
      <TableCell className="px-2 py-0.5">
        <SourceBadge source={row.source} isTest={row.is_test} />
      </TableCell>
      <TableCell className="w-9 px-2">
        <PanelRightOpen className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </TableCell>
    </TableRow>
  )
}

/* -------------------------------------------------------------------------- */

const EASTERN_FULL = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  dateStyle: "medium",
  timeStyle: "short",
})

function dayLong(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/** The drawer: one request, its days, and the actions the viewer may take. */
function TimeOffPane({
  id,
  source,
  onClose,
}: {
  id: string
  source: TimeOffListRow["source"]
  onClose: () => void
}) {
  const router = useRouter()
  const [record, setRecord] = React.useState<TimeOffRecord | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [reload, setReload] = React.useState(0)
  const [editing, setEditing] = React.useState(false)
  const [deleting, startDelete] = React.useTransition()

  React.useEffect(() => {
    let live = true
    loadTimeOffRecord(id, source).then((r) => {
      if (!live) return
      if (r.ok) setRecord(r.data)
      else setError(r.error)
    })
    return () => {
      live = false
    }
  }, [id, source, reload])

  const closeEdit = React.useCallback(() => setEditing(false), [])

  function onDelete() {
    if (!record) return
    if (
      !window.confirm(
        `Permanently delete ${record.requested_by_name ?? "this"}'s ${record.request_type ?? ""} request (${formatDay(record.start_date)} – ${formatDay(record.end_date)})?`,
      )
    )
      return
    startDelete(async () => {
      const r = await deleteTimeOffRequest(record.id)
      if (!r.ok) {
        toast.error("Could not delete", { description: r.error })
        return
      }
      toast.success("Request deleted")
      router.refresh()
      onClose()
    })
  }

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-black/10" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Time off request"
        className="fixed right-0 top-0 z-50 flex h-screen w-[520px] max-w-[94vw] flex-col border-l border-[#E5E8EC] bg-white shadow-2xl"
      >
        <header className="border-b border-[#E5E8EC] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-[#9AA1AD]">Time off request</div>
              <h2 className="truncate text-[17px] font-semibold text-[#1A2233]">
                {record ? (record.requested_by_name ?? "Unknown") : error ? "Request" : "Loading…"}
              </h2>
              {record && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <StatusPill status={record.status} />
                  <SourceBadge source={record.source} isTest={record.is_test} />
                  {record.source === "Dashboard" && record.canEdit && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setEditing(true)}
                      >
                        <Pencil className="size-3" /> Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px] text-[#B42318]"
                        onClick={onDelete}
                        disabled={deleting}
                      >
                        {deleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                        Delete
                      </Button>
                    </>
                  )}
                  {record.source === "Dynamics" && (
                    <span className="text-[11px] text-muted-foreground">
                      Synced from Dynamics — read-only history
                    </span>
                  )}
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
          {!record && !error && (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading request…</div>
          )}

          {record && (
            <>
              {record.source === "Dashboard" && record.status === "Pending" && (
                <section className="mb-5 rounded-md border border-[#F3E2BF] bg-[#FCF4E6] p-3">
                  <div className="mb-2 text-[12px] font-semibold text-[#92600B]">Awaiting review</div>
                  <ReviewControls
                    id={record.id}
                    disabledReason={record.canReview ? null : record.reviewBlockedReason}
                    onDone={() => setReload((n) => n + 1)}
                  />
                </section>
              )}

              <section className="mb-5">
                <SectionHeader title="Request" />
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Field label="Requested by" value={record.requested_by_name ?? "—"} />
                  <Field label="Request type" value={record.request_type ?? "—"} />
                  <Field label="Start (ET)" value={record.start_date ? dayLong(record.start_date) : "—"} />
                  <Field label="End (ET)" value={record.end_date ? dayLong(record.end_date) : "—"} />
                  <Field label="Total days" value={formatDays(record.total_days)} />
                  <Field
                    label="Reviewing team"
                    value={record.reviewers.length ? record.reviewers.join(", ") : "None assigned"}
                  />
                </div>
                {record.description && <Block label="Description" value={record.description} />}
                {record.comments && <Block label="Comments" value={record.comments} />}
              </section>

              {record.source === "Dashboard" && (
                <section className="mb-5">
                  <SectionHeader title="Days" />
                  <div className="overflow-hidden rounded-md border border-[#E4E9F4]">
                    {record.days.map((d) => (
                      <div
                        key={d.date}
                        className="flex justify-between border-b px-2.5 py-1 text-[13px] last:border-b-0"
                      >
                        <span className="tabular-nums">{dayLong(d.date)}</span>
                        <span className={d.portion === "Full" ? "" : "font-medium text-[#92600B]"}>
                          {d.portion === "Full" ? "Full day" : `½ day (${d.portion})`}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="mb-5">
                <SectionHeader title="Review" />
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Field label="Status" value={record.status ?? "—"} />
                  <Field label="Reviewed by" value={record.reviewed_by_name ?? "—"} />
                  <Field
                    label="Reviewed at"
                    value={record.reviewed_at ? EASTERN_FULL.format(new Date(record.reviewed_at)) : "—"}
                  />
                </div>
                {record.review_comments && <Block label="Review comments" value={record.review_comments} />}
                {record.source === "Dynamics" && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Dynamics never fills its request status, so every synced request is shown as
                    Approved (the same rule as the Logistics Time Off calendar).
                  </p>
                )}
              </section>

              <section className="mb-5">
                <SectionHeader title="System" />
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Field label="Created by" value={record.created_by_name ?? "—"} />
                  <Field
                    label="Created"
                    value={record.created_on ? EASTERN_FULL.format(new Date(record.created_on)) : "—"}
                  />
                </div>
              </section>
            </>
          )}
        </div>
      </aside>

      {editing && (
        <EditTimeOffDialog
          id={id}
          onClose={closeEdit}
          onSaved={() => {
            setEditing(false)
            setReload((n) => n + 1)
          }}
        />
      )}
    </>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#5B6472]">{title}</div>
      <div
        className="mt-1 h-[2px] w-full rounded-full"
        style={{ background: "linear-gradient(90deg, #1E2858, #0355A7, #1C8C9C)" }}
      />
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-[#9AA1AD]">{label}</div>
      <div className="mt-0.5 rounded-md border border-[#E4E9F4] bg-[#F4F6FB] px-2 py-1 text-[13px]" title={value}>
        <span className="block truncate">{value}</span>
      </div>
    </div>
  )
}

function Block({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2">
      <div className="text-[11px] text-[#9AA1AD]">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap rounded-md border border-[#E4E9F4] bg-[#F4F6FB] px-2 py-1 text-[13px]">
        {value}
      </div>
    </div>
  )
}

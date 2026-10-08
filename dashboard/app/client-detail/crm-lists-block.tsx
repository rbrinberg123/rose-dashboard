"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronDown, ChevronUp } from "lucide-react"

import { STATUS_PILL_LIGHT, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import { cn } from "@/lib/utils"
import { loadEventRecord } from "@/app/events/actions"
import { EventRecordPane, eventStatePill } from "@/app/events/event-record-pane"
import { TaskDrawerHost, useOpenTask } from "@/app/my-dashboard/task-drawer"
import type { EventRecord } from "@/lib/events/record"
import type { ClientCrmLists, ClientEventItem, ClientTaskItem } from "./crm-lists"

/**
 * Client Detail → Events · Tasks. Two compact cards, side by side at lg+
 * (stacked below). Each shows 5 rows, "Show more" reveals up to 10 (the Recent
 * Touchpoints extender pattern), "View all →" opens the CRM list filtered to
 * this client (?client=<account_id>, each page's own quick filter).
 *
 * Every row opens that record's EXISTING drawer over this page — EventRecordPane
 * (loadEventRecord) and the CRM task drawer (TaskDrawerHost, as on My Dashboard /
 * Feedback). Contacts live in the top card's Key Contacts strip
 * (./key-contacts-strip.tsx); meetings in Last 25 Meetings at the bottom of the
 * page (which uses useRecordDrawer below for its meeting card). The drawers are
 * fixed overlays, so the page underneath never moves and closing returns to the
 * same scroll spot. A row with no id renders as plain text. Data + scoping: see
 * ./crm-lists.ts.
 */

const NAVY_DEEP = "#1E2858"
const RED = "#C53030"
const AMBER = "#B7791F"
const SHOW = 5

const CARD = "flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#E5E8EC] bg-white shadow-[0_1px_2px_rgba(16,32,64,0.05)]"
const ROW = "flex w-full items-center gap-2 border-b border-[#EEF2F7] px-3 py-1.5 text-left last:border-0"
const ROW_CLICK = "cursor-pointer transition-colors hover:bg-[#F7F9FC] focus-visible:bg-[#F1F4F8] focus-visible:outline-none"

const ET_YMD = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
const ET_SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" })

function etYmd(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : ET_YMD.format(d)
}
function etShort(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : ET_SHORT.format(d)
}
function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** One card: header (title · count · View all →), rows, Show more / less. */
function ListCard<T>({
  title,
  total,
  viewAllHref,
  rows,
  empty,
  renderRow,
}: {
  title: string
  total: number
  viewAllHref: string
  rows: T[]
  empty: string
  renderRow: (row: T) => React.ReactNode
}) {
  const [expanded, setExpanded] = React.useState(false)
  const visible = expanded ? rows : rows.slice(0, SHOW)
  return (
    <div className={CARD}>
      <div className="flex items-baseline gap-2 border-b border-[#EEF2F7] px-3 pb-2 pt-2.5">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: NAVY_DEEP }}>
          {title}
        </h3>
        <span className="text-[11px] tabular-nums" style={{ color: TEXT_MUTED }}>
          {total.toLocaleString()}
        </span>
        <Link href={viewAllHref} className="ml-auto text-[11px] font-semibold text-[#0355A7] hover:underline">
          View all →
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs" style={{ color: TEXT_MUTED }}>
          {empty}
        </div>
      ) : (
        <div className="flex-1">{visible.map(renderRow)}</div>
      )}
      {rows.length > SHOW && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full cursor-pointer items-center justify-center gap-1 border-t border-[#EEF2F7] bg-[#F7F9FC] py-1.5 text-[11px] font-semibold text-[#0355A7] hover:bg-[#EEF2FB]"
        >
          {expanded ? (
            <>
              Show less <ChevronUp className="size-3.5" />
            </>
          ) : (
            <>
              Show more <ChevronDown className="size-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  )
}

/** A row that opens a drawer — or plain text when the id is missing. */
function RowButton({ onOpen, label, children }: { onOpen: (() => void) | null; label: string; children: React.ReactNode }) {
  if (!onOpen) return <div className={ROW}>{children}</div>
  return (
    <button type="button" onClick={onOpen} className={cn(ROW, ROW_CLICK)} title={label}>
      {children}
    </button>
  )
}

/**
 * Open / load / close for one view-only record drawer (one record at a time).
 * Used here for the event card and by Last 25 Meetings for the meeting card.
 */
export function useRecordDrawer<R>(load: (id: string) => Promise<{ ok: boolean; data?: R; error?: string }>) {
  const [id, setId] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<R | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!id) return
    let cancelled = false
    load(id).then((res) => {
      if (cancelled) return
      if (res.ok) setRecord(res.data ?? null)
      else setError(res.error ?? "Could not load the record.")
    })
    return () => {
      cancelled = true
    }
  }, [id, load])
  return {
    record,
    error,
    loading: id !== null && record === null && error === null,
    open: (next: string) => {
      setRecord(null)
      setError(null)
      setId(next)
    },
    close: () => {
      setId(null)
      setRecord(null)
      setError(null)
    },
  }
}

export function ClientCrmListsBlock({ accountId, lists }: { accountId: string; lists: ClientCrmLists }) {
  return (
    <TaskDrawerHost>
      <Block accountId={accountId} lists={lists} />
    </TaskDrawerHost>
  )
}

function Block({ accountId, lists }: { accountId: string; lists: ClientCrmLists }) {
  const openTask = useOpenTask()
  const q = `?client=${encodeURIComponent(accountId)}`
  // The EVENT drawer — view-only, wired as Feedback Reports / FB Coming Soon wire it.
  const ev = useRecordDrawer<EventRecord>(loadEventRecord)

  const [today] = React.useState(() => ET_YMD.format(new Date()))
  const soon = addDaysYmd(today, 7)

  const eventRow = (e: ClientEventItem) => {
    const pill = eventStatePill(e.event_state_label)
    const name = e.event_title || [e.event_location, e.event_dates].filter(Boolean).join(" · ") || "Event"
    const when = e.event_dates || etShort(e.meetings_start) || "Dates TBC"
    return (
      <RowButton key={e.event_id} label="Open event" onOpen={e.event_id ? () => ev.open(e.event_id) : null}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium" style={{ color: TEXT_PRIMARY }}>
            {name}
          </span>
          <span className="block truncate text-[11px]" style={{ color: TEXT_MUTED }}>
            {when}
          </span>
        </span>
        {e.event_state_label && (
          <span
            className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: pill.bg, color: pill.text }}
          >
            {e.event_state_label}
          </span>
        )}
      </RowButton>
    )
  }

  const taskRow = (t: ClientTaskItem) => {
    const due = etYmd(t.due_date)
    const tone = due && due < today ? "over" : due && due <= soon ? "soon" : "none"
    const dot = tone === "over" ? RED : tone === "soon" ? AMBER : "#D5DBE7"
    return (
      <RowButton key={t.task_id} label="Open task" onOpen={t.task_id && openTask ? () => openTask(t.task_id) : null}>
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
          aria-label={tone === "over" ? "Overdue" : tone === "soon" ? "Due soon" : "Open"}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium" style={{ color: TEXT_PRIMARY }}>
            {t.subject || "Untitled task"}
          </span>
          {t.task_type_label && (
            <span
              className="mt-0.5 inline-block rounded px-1.5 text-[9px] font-semibold uppercase tracking-wide"
              style={{ backgroundColor: STATUS_PILL_LIGHT.neutral.bg, color: STATUS_PILL_LIGHT.neutral.text }}
            >
              {t.task_type_label}
            </span>
          )}
        </span>
        <span
          className={cn("shrink-0 whitespace-nowrap text-[11px] tabular-nums", tone !== "none" && "font-semibold")}
          style={{ color: tone === "over" ? RED : tone === "soon" ? AMBER : TEXT_MUTED }}
        >
          {etShort(t.due_date) ?? "No due date"}
        </span>
      </RowButton>
    )
  }

  return (
    <>
      <div className="mb-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <ListCard
          title="Events"
          total={lists.events.total}
          viewAllHref={`/events${q}`}
          rows={lists.events.rows}
          empty="No events for this client."
          renderRow={eventRow}
        />
        <ListCard
          title="Open tasks"
          total={lists.tasks.total}
          viewAllHref={`/tasks${q}`}
          rows={lists.tasks.rows}
          empty="No open tasks for this client."
          renderRow={taskRow}
        />
      </div>

      <EventRecordPane record={ev.record} loading={ev.loading} error={ev.error} onClose={ev.close} />
    </>
  )
}

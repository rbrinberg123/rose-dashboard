"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { CARD_CLASS, STATUS_PILL_LIGHT, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import type { EventRecord } from "@/lib/events/record"
import { loadEventRecord } from "@/app/events/actions"
import { EventRecordPane } from "@/app/events/event-record-pane"
import { MarkReceivedControl } from "@/app/events/mark-received-control"

/** One FB Coming Soon row (serialisable — built by page.tsx on the server). */
export type ComingSoonRow = {
  taskId: string
  isDynamics: boolean
  owner: string | null
  clientId: string | null
  clientName: string | null
  isTest: boolean
  eventId: string | null
  eventName: string | null
  report: string | null
  due: string | null
  meetings: number | null
}

const BTN =
  "inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-md border border-input bg-background px-2 text-[11.5px] font-medium " +
  "text-foreground transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"

const DUE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
})

/**
 * The FB Coming Soon working hub. Dashboard rows: Mark received (moves the
 * report onto Feedback Reports, claimable) and Open event — the Events drawer
 * in place, whose Feedback reports panel carries Split and per-report Mark
 * received. Dynamics rows: Open event only (view-only, no panel), marked
 * "Managed in Dynamics · not actionable yet". No claiming here.
 */
export function ComingSoonTable({ rows, readOnly }: { rows: ComingSoonRow[]; readOnly: boolean }) {
  const router = useRouter()
  // Optimistic hide, keyed to the rows it was made against (falls away on refresh).
  const [hidden, setHidden] = React.useState<{ base: ComingSoonRow[]; ids: Set<string> }>({
    base: rows,
    ids: new Set(),
  })
  const hiddenIds = hidden.base === rows ? hidden.ids : new Set<string>()
  const setHide = (id: string, on: boolean) =>
    setHidden((cur) => {
      const ids = new Set(cur.base === rows ? cur.ids : [])
      if (on) ids.add(id)
      else ids.delete(id)
      return { base: rows, ids }
    })

  // The inline event drawer.
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<EventRecord | null>(null)
  const [recordError, setRecordError] = React.useState<string | null>(null)
  const openEvent = (id: string) => {
    setRecord(null)
    setRecordError(null)
    setOpenId(id)
  }
  const closeEvent = () => {
    setOpenId(null)
    setRecord(null)
    setRecordError(null)
  }
  React.useEffect(() => {
    if (!openId) return
    let cancelled = false
    loadEventRecord(openId).then((res) => {
      if (cancelled) return
      if (res.ok) setRecord(res.data ?? null)
      else setRecordError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [openId])

  const visible = rows.filter((r) => !hiddenIds.has(r.taskId))

  return (
    <>
      <div className={CARD_CLASS + " overflow-x-auto"}>
        <table className="w-full table-fixed text-[12.5px]">
          {/* Fixed widths so every row stays on ONE line; long names truncate
              (full text on hover). */}
          <colgroup>
            <col style={{ width: "7%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "23%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "25%" }} />
          </colgroup>
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2.5 py-1.5 text-left font-medium">Origin</th>
              <th className="px-2.5 py-1.5 text-left font-medium">Owner</th>
              <th className="px-2.5 py-1.5 text-left font-medium">Client</th>
              <th className="px-2.5 py-1.5 text-left font-medium">Event</th>
              <th className="px-2.5 py-1.5 text-left font-medium">Report</th>
              <th className="px-2.5 py-1.5 text-center font-medium">Due</th>
              <th className="px-2.5 py-1.5 text-center font-medium">Meetings</th>
              <th className="px-2.5 py-1.5 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.taskId} className="border-b last:border-0 hover:bg-slate-50/60">
                <td className="px-2.5 py-1">
                  <span
                    className="inline-block whitespace-nowrap rounded-full px-1.5 py-px text-[10.5px] font-medium"
                    style={{
                      background: r.isDynamics ? "#FFFFFF" : STATUS_PILL_LIGHT.neutral.bg,
                      color: STATUS_PILL_LIGHT.neutral.text,
                      border: "1px solid " + (r.isDynamics ? "#E2E6EC" : "transparent"),
                    }}
                  >
                    {r.isDynamics ? "Dynamics" : "Dashboard"}
                  </span>
                </td>
                <td className="truncate px-2.5 py-1" title={r.owner ?? undefined} style={{ color: r.owner ? TEXT_PRIMARY : TEXT_MUTED }}>
                  {r.owner ?? (r.isDynamics ? "—" : "System")}
                </td>
                <td className="truncate px-2.5 py-1 font-medium" title={r.clientName ?? undefined}>
                  {r.clientId ? (
                    <Link href={"/client-detail?account_id=" + r.clientId} className="hover:underline">
                      {r.clientName ?? "—"}
                    </Link>
                  ) : (
                    (r.clientName ?? "—")
                  )}
                  {r.isTest && (
                    <span className="ml-1.5 text-[10.5px] font-normal" style={{ color: TEXT_MUTED }}>
                      test
                    </span>
                  )}
                </td>
                <td className="truncate px-2.5 py-1" title={r.eventName ?? undefined}>
                  {r.eventId ? (
                    <button
                      type="button"
                      className="max-w-full cursor-pointer truncate text-left align-bottom hover:underline"
                      onClick={() => openEvent(r.eventId!)}
                    >
                      {r.eventName ?? "Event"}
                    </button>
                  ) : (
                    (r.eventName ?? "—")
                  )}
                </td>
                <td className="truncate px-2.5 py-1" style={{ color: TEXT_MUTED }}>
                  {r.report ?? "—"}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1 text-center tabular-nums" style={{ color: TEXT_MUTED }}>
                  {r.due ? DUE_FMT.format(new Date(r.due)) : "—"}
                </td>
                <td className="px-2.5 py-1 text-center tabular-nums" style={{ color: TEXT_MUTED }}>
                  {r.meetings ?? "—"}
                </td>
                <td className="px-2.5 py-1">
                  <div className="flex flex-nowrap items-center gap-1 overflow-hidden">
                    {r.eventId && (
                      <button type="button" className={BTN} onClick={() => openEvent(r.eventId!)}>
                        Open event
                      </button>
                    )}
                    {r.isDynamics ? (
                      <span
                        className="truncate text-[11px]"
                        style={{ color: TEXT_MUTED }}
                        title="Managed in Dynamics · not actionable yet"
                      >
                        Managed in Dynamics · not actionable yet
                      </span>
                    ) : (
                      <MarkReceivedControl
                        taskId={r.taskId}
                        disabled={readOnly}
                        onOptimistic={() => setHide(r.taskId, true)}
                        onRollback={() => setHide(r.taskId, false)}
                        onDone={() => router.refresh()}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The Events drawer, in place. For a dashboard event it carries the
          Feedback reports panel (Split + per-report Mark received); a Dynamics
          event opens view-only. No edit button here. */}
      <EventRecordPane
        record={record}
        loading={openId !== null && record === null && recordError === null}
        error={recordError}
        onClose={closeEvent}
      />
    </>
  )
}

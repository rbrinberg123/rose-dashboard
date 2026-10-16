"use client"

/**
 * Client Margin (Phase 1) — known-hours table. One row per active client:
 * total hours + the five category columns, the "< 1 year" flag, and a grand
 * total row. Sortable on every numeric column (default: total, high → low).
 * The window selector re-requests the page (?window=); the cancelled toggle is
 * client-side — both totals are already on every row.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"

import { ListTitleCard } from "@/components/page-masthead"
import { SortHeader } from "@/components/sort-header"
import { BRAND_NAVY, CARD_CLASS, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import { HOURS, WINDOW_OPTIONS, type ClientHours } from "@/lib/client-margin/hours"
import type { ClientMarginData } from "@/lib/client-margin/load"

type SortKey =
  | "client_name"
  | "total"
  | "booking"
  | "hosting"
  | "feedbackCollection"
  | "reportPrep"
  | "clientMgmt"

const fmtH = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const START_SOURCE_LABEL: Record<string, string> = {
  original_start_date: "Original start date (Dynamics)",
  contract_start: "Earliest contract start",
  first_meeting: "First meeting date",
}

export function ClientMarginView({ data }: { data: ClientMarginData }) {
  const router = useRouter()
  const [countCancelled, setCountCancelled] = React.useState(true)
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "total", dir: "desc" })

  const booking = (r: ClientHours) => (countCancelled ? r.booking : r.bookingExclCancelled)
  const total = (r: ClientHours) => (countCancelled ? r.total : r.totalExclCancelled)
  const value = (r: ClientHours, k: SortKey): number | string =>
    k === "client_name" ? r.client_name : k === "total" ? total(r) : k === "booking" ? booking(r) : r[k]

  const rows = React.useMemo(() => {
    const out = [...data.rows]
    out.sort((a, b) => {
      const va = value(a, sort.key)
      const vb = value(b, sort.key)
      const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)
      return sort.dir === "asc" ? c : -c
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.rows, sort, countCancelled])

  const sum = (f: (r: ClientHours) => number) => data.rows.reduce((s, r) => s + f(r), 0)
  const grand = {
    total: sum(total),
    totalWith: sum((r) => r.total),
    totalWithout: sum((r) => r.totalExclCancelled),
    booking: sum(booking),
    hosting: sum((r) => r.hosting),
    feedbackCollection: sum((r) => r.feedbackCollection),
    reportPrep: sum((r) => r.reportPrep),
    clientMgmt: sum((r) => r.clientMgmt),
    cancelled: sum((r) => r.cancelledLive + r.cancelledVirtual),
  }

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "client_name" ? "asc" : "desc" }))
  const sorted = (key: SortKey) => (sort.key === key ? sort.dir : false)

  const windowLabel = `${format(new Date(data.windowStart), "MMM d, yyyy")} – ${format(new Date(new Date(data.windowEnd).getTime() - 1), "MMM d, yyyy")}`

  const num = (key: SortKey, label: string, title: string) => (
    <th className="px-3 py-2 text-right font-medium">
      <SortHeader label={label} title={title} align="right" isSorted={sorted(key)} onClick={() => toggle(key)} />
    </th>
  )

  return (
    <div className="space-y-4">
      <ListTitleCard
        eyebrow="Hidden · Super user"
        title="Client Margin"
        subtitle={
          <>
            Phase 1 — known hours per active client ({windowLabel}). Hours only; cost and margin come next.
          </>
        }
        rightSlot={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs" style={{ color: TEXT_MUTED }}>
              <input
                type="checkbox"
                checked={countCancelled}
                onChange={(e) => setCountCancelled(e.target.checked)}
              />
              Count booking hours on cancelled meetings
            </label>
            <select
              aria-label="Time window"
              value={data.windowKey}
              onChange={(e) => router.push(`/client-margin?window=${e.target.value}`)}
              className="h-9 rounded-md border bg-white px-2 text-sm"
            >
              {WINDOW_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm" style={{ color: TEXT_PRIMARY }}>
          <Kpi label="Total known hours" value={fmtH(grand.total)} />
          <Kpi label="Active clients" value={String(data.rows.length)} />
          <Kpi label="With cancelled booking" value={fmtH(grand.totalWith)} />
          <Kpi label="Without cancelled" value={fmtH(grand.totalWithout)} />
          <Kpi label="Cancelled meetings" value={String(grand.cancelled)} />
        </div>
      </ListTitleCard>

      <div className={`${CARD_CLASS} overflow-x-auto`}>
        <table className="w-full text-[13px]">
          <thead className="border-b bg-muted/40 text-left text-[12px] text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">
                <SortHeader label="Client" isSorted={sorted("client_name")} onClick={() => toggle("client_name")} />
              </th>
              {num("total", "Total hrs", "Sum of the five categories")}
              {num("booking", "Booking", `Virtual ${HOURS.bookVirtual} h · Live ${HOURS.bookLive} h per meeting`)}
              {num("hosting", "Hosting", `Virtual ${HOURS.hostVirtual} h · Live ${HOURS.hostLive} h per held meeting`)}
              {num("feedbackCollection", "FB collection", `${HOURS.feedbackCollection} h per held meeting`)}
              {num("reportPrep", "Report prep", `${HOURS.reportPrep} h per completed feedback report`)}
              {num("clientMgmt", "Client mgmt", `${HOURS.clientMgmtPerMonth} h per month as a client in the window`)}
              <th className="px-3 py-2 text-right font-medium">Meetings (V / L)</th>
              <th className="px-3 py-2 font-medium">Client since</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.account_id} className="border-b last:border-b-0 hover:bg-muted/20">
                <td className="px-4 py-2 font-medium" style={{ color: TEXT_PRIMARY }}>
                  {r.client_name}
                  {r.lessThanOneYear && (
                    <span
                      className="ml-2 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
                      style={{ background: "#FDF3E1", color: "#9A5B00" }}
                    >
                      Less than one year
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: BRAND_NAVY }}>
                  {fmtH(total(r))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtH(booking(r))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtH(r.hosting)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtH(r.feedbackCollection)}</td>
                <td className="px-3 py-2 text-right tabular-nums" title={`${r.reports} reports`}>
                  {fmtH(r.reportPrep)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums" title={`${r.monthsInWindow} months in window`}>
                  {fmtH(r.clientMgmt)}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums"
                  style={{ color: TEXT_MUTED }}
                  title={`Held: ${r.heldVirtual} virtual / ${r.heldLive} live · Cancelled: ${r.cancelledVirtual} virtual / ${r.cancelledLive} live`}
                >
                  {r.meetingsVirtual} / {r.meetingsLive}
                </td>
                <td
                  className="px-3 py-2 tabular-nums"
                  style={{ color: TEXT_MUTED }}
                  title={r.start_source ? START_SOURCE_LABEL[r.start_source] : "No start date recorded"}
                >
                  {r.start_date ? format(new Date(r.start_date + "T12:00:00"), "MMM d, yyyy") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 bg-muted/40 font-semibold" style={{ color: TEXT_PRIMARY }}>
              <td className="px-4 py-2">Grand total ({data.rows.length} clients)</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: BRAND_NAVY }}>
                {fmtH(grand.total)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtH(grand.booking)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtH(grand.hosting)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtH(grand.feedbackCollection)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtH(grand.reportPrep)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtH(grand.clientMgmt)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {data.unknownTypeMeetings > 0 && (
        <p className="text-xs" style={{ color: TEXT_MUTED }}>
          {data.unknownTypeMeetings} meeting(s) in this window have no Live/Virtual type and are counted at the virtual rate.
        </p>
      )}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

"use client"

import * as React from "react"
import { ListTitleCard } from "@/components/page-masthead"
import { StatCard } from "@/components/stat-card"
import { CARD_CLASS } from "@/lib/design"
import type { FeedbackManagerRow, FeedbackManagerState } from "@/lib/types"

// ---------------------------------------------------------------------------
// State palette — the four active pipeline states, ordered closest-to-done
// first (matches the KPI card order in the spec). Colors are drawn from the
// site's STATUS_PILL_LIGHT tints so the page reads as part of the system.
// ---------------------------------------------------------------------------
const STATE_ORDER: FeedbackManagerState[] = [
  "Reports Pending Review",
  "Reports In Progress",
  "Reports Not Started",
  "Waiting on Feedback",
]

const STATE_STYLE: Record<
  FeedbackManagerState,
  { bg: string; text: string; short: string }
> = {
  "Reports Pending Review": { bg: "#E7F5EE", text: "#0E7C56", short: "Pending Review" },
  "Reports In Progress": { bg: "#EEF2FB", text: "#2D4A8A", short: "In Progress" },
  "Reports Not Started": { bg: "#FCF4E6", text: "#92600B", short: "Not Started" },
  "Waiting on Feedback": { bg: "#F1F3F7", text: "#5B6472", short: "Waiting on Feedback" },
}

// Meeting feedback-status tally colors (one per feedback_status_label choice).
const FB_ALL_IN = { bg: "#E7F5EE", text: "#0E7C56" }
const FB_NO_FB = { bg: "#FAECE7", text: "#993C1D" }
const FB_AWAITING = { bg: "#FAEEDA", text: "#854F0B" }
const FB_NONE = { bg: "#F1F3F7", text: "#6B7280" }

// All dates out of the view are timestamptz; format the calendar day in UTC so
// it agrees with v_planning_events' meeting_day (also UTC) and never drifts a
// day on late-UTC timestamps.
const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
})
function fmtDate(iso: string | null): string {
  return iso ? DATE_FMT.format(new Date(iso)) : "—"
}

function fmtPct(pct: number | null): string {
  return pct == null ? "—" : `${Math.round(pct * 100)}%`
}

// Fixed column widths (px) applied via <colgroup> + table-fixed so the layout
// NEVER reflows when the KPI filter changes — only the visible rows change, the
// column positions/widths stay identical. table-fixed sizes columns from these
// widths alone and ignores cell content; text columns truncate (with a title
// tooltip) instead of widening. Order matches the <th>/<td> order below.
const COL_WIDTHS = [
  "110px", // State
  "240px", // Event
  "160px", // Client
  "120px", // Meeting Start
  "120px", // Meeting End
  "90px", // Meetings
  "150px", // FB Rec'd tally
  "90px", // % Closed
  "96px", // FB Rec'd?
  "110px", // Rec'd Date
  "96px", // FB Task
  "96px", // Claimed?
  "140px", // Claimed By
  "110px", // Report Sent
]

export function FeedbackManagerView({ rows }: { rows: FeedbackManagerRow[] }) {
  // null = no filter (show all four active states).
  const [filter, setFilter] = React.useState<FeedbackManagerState | null>(null)

  const counts = React.useMemo(() => {
    const c: Record<FeedbackManagerState, number> = {
      "Reports Pending Review": 0,
      "Reports In Progress": 0,
      "Reports Not Started": 0,
      "Waiting on Feedback": 0,
    }
    for (const r of rows) if (r.state in c) c[r.state]++
    return c
  }, [rows])

  const visible = React.useMemo(() => {
    const list = filter ? rows.filter((r) => r.state === filter) : rows
    // Oldest meeting end first — the most overdue feedback surfaces at the top.
    // Events with no Confirmed meetings (null end) sort last.
    return [...list].sort((a, b) => {
      if (a.meeting_end == null && b.meeting_end == null) {
        return a.event_name.localeCompare(b.event_name)
      }
      if (a.meeting_end == null) return 1
      if (b.meeting_end == null) return -1
      return a.meeting_end.localeCompare(b.meeting_end)
    })
  }, [rows, filter])

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          title="Feedback Manager"
          subtitle="Active events by feedback-report stage. Done events (report sent) are excluded."
        />
      </div>

      {/* KPI cards — click to filter the table to that state; click the active
          card again (or “Show all”) to clear. */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATE_ORDER.map((state) => {
          const style = STATE_STYLE[state]
          const active = filter === state
          return (
            <button
              key={state}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(active ? null : state)}
              className="rounded-[13px] text-left transition-transform hover:-translate-y-0.5"
              style={{
                outline: active ? `2px solid ${style.text}` : "none",
                outlineOffset: 2,
              }}
            >
              <StatCard
                floating
                label={style.short}
                value={counts[state]}
                valueColor={style.text}
              />
            </button>
          )
        })}
      </div>

      {/* Result count + active-filter / clear control */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {visible.length} {visible.length === 1 ? "event" : "events"}
          {filter ? (
            <>
              {" "}
              in{" "}
              <span style={{ color: STATE_STYLE[filter].text }} className="font-medium">
                {STATE_STYLE[filter].short}
              </span>
            </>
          ) : (
            " across all active states"
          )}
        </span>
        {filter && (
          <button
            type="button"
            onClick={() => setFilter(null)}
            className="rounded-md border border-border bg-card px-2 py-1 font-medium text-foreground hover:bg-slate-50"
          >
            Show all
          </button>
        )}
      </div>

      {/* Event table */}
      {visible.length === 0 ? (
        <div className={`px-4 py-10 text-center text-sm text-muted-foreground ${CARD_CLASS}`}>
          No events in this state.
        </div>
      ) : (
        <div className={`overflow-x-auto ${CARD_CLASS}`}>
          <table className="w-full min-w-[1728px] table-fixed text-sm">
            <colgroup>
              {COL_WIDTHS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <Th>State</Th>
                <Th>Event</Th>
                <Th>Client</Th>
                <Th>Meeting Start</Th>
                <Th>Meeting End</Th>
                <Th right>Meetings</Th>
                <Th>FB Rec&apos;d</Th>
                <Th right>% Closed</Th>
                <Th center>FB Rec&apos;d?</Th>
                <Th>Rec&apos;d Date</Th>
                <Th center>FB Task</Th>
                <Th center>Claimed?</Th>
                <Th>Claimed By</Th>
                <Th center>Report Sent</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const ss = STATE_STYLE[r.state]
                return (
                  <tr key={r.event_id} className="border-b last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5">
                      <Pill bg={ss.bg} text={ss.text}>
                        {ss.short}
                      </Pill>
                    </td>
                    <td
                      className="truncate px-3 py-2.5 font-medium"
                      title={r.event_name}
                    >
                      {r.event_name}
                    </td>
                    <td
                      className="truncate px-3 py-2.5"
                      title={r.client_account_name || undefined}
                    >
                      {r.client_account_name || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                      {fmtDate(r.meeting_start)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                      {fmtDate(r.meeting_end)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.meeting_count}</td>
                    <td className="px-3 py-2.5">
                      <FbTally row={r} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(r.pct_closed)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <YesNo yes={r.feedback_received} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                      {fmtDate(r.feedback_received_date)}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <OpenClosed state={r.feedback_task_state_label} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <YesNo yes={r.claimed} />
                    </td>
                    <td
                      className="truncate px-3 py-2.5"
                      title={r.claimed_by_name || undefined}
                    >
                      {r.claimed_by_name || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <OpenClosed state={r.report_sent_state_label} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------
function Th({
  children,
  right,
  center,
}: {
  children: React.ReactNode
  right?: boolean
  center?: boolean
}) {
  return (
    <th
      className={
        "truncate whitespace-nowrap px-3 py-2 font-medium " +
        (right ? "text-right" : center ? "text-center" : "text-left")
      }
    >
      {children}
    </th>
  )
}

function Pill({
  children,
  bg,
  text,
}: {
  children: React.ReactNode
  bg: string
  text: string
}) {
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: bg, color: text }}
    >
      {children}
    </span>
  )
}

// Meeting feedback-status counts as compact colored pills; zeros are hidden.
function FbTally({ row }: { row: FeedbackManagerRow }) {
  const segs: { n: number; label: string; bg: string; text: string }[] = [
    { n: row.fb_closed_all_in, label: "All-in", ...FB_ALL_IN },
    { n: row.fb_closed_no_feedback, label: "No FB", ...FB_NO_FB },
    { n: row.fb_awaiting_additional, label: "Await", ...FB_AWAITING },
    { n: row.fb_no_status, label: "None", ...FB_NONE },
  ]
  const shown = segs.filter((s) => s.n > 0)
  if (shown.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((s) => (
        <span
          key={s.label}
          title={`${s.n} ${s.label}`}
          className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
          style={{ backgroundColor: s.bg, color: s.text }}
        >
          {s.n} {s.label}
        </span>
      ))}
    </span>
  )
}

function YesNo({ yes }: { yes: boolean }) {
  return yes ? (
    <Pill bg="#E7F5EE" text="#0E7C56">
      Yes
    </Pill>
  ) : (
    <Pill bg="#F1F3F7" text="#6B7280">
      No
    </Pill>
  )
}

// Renders a task's open/closed state. 'Completed' reads as "Closed"; null /
// absent (no Report Sent task) reads as an em dash.
function OpenClosed({ state }: { state: string | null }) {
  if (state == null) return <span className="text-muted-foreground">—</span>
  if (state === "Completed") {
    return (
      <Pill bg="#E7F5EE" text="#0E7C56">
        Closed
      </Pill>
    )
  }
  // 'Open' / 'Not Started' and any other non-completed label all read as open.
  return (
    <Pill bg="#EEF2FB" text="#2D4A8A">
      Open
    </Pill>
  )
}

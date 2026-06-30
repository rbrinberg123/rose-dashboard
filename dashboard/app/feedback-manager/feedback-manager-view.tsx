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
  month: "numeric",
  day: "numeric",
  year: "2-digit",
})
function fmtDate(iso: string | null): string {
  return iso ? DATE_FMT.format(new Date(iso)) : "—"
}

function fmtPct(pct: number | null): string {
  return pct == null ? "—" : `${Math.round(pct * 100)}%`
}

// Small uppercase muted control label — matches the filter labels used on the
// Profiles page so the controls read as part of the same system.
const FILTER_LABEL = "text-[11px] font-medium uppercase tracking-wide text-[#9AA1AD]"
const NAVY_DEEP = "#1E2858"
const ALL = "__all__"

// Tri-state filters (Claimed? and Feedback Complete) share this shape.
type TriState = "all" | "yes" | "no"

export function FeedbackManagerView({ rows }: { rows: FeedbackManagerRow[] }) {
  // State single-select — "All" (every state) by default; pick one state to filter.
  const [stateFilter, setStateFilter] = React.useState<FeedbackManagerState | typeof ALL>(ALL)
  const [claimedBy, setClaimedBy] = React.useState<string>(ALL)
  const [claimed, setClaimed] = React.useState<TriState>("all")
  // Feedback Complete maps to the task-level feedback_received (bcs_feedback_received) flag.
  const [feedbackComplete, setFeedbackComplete] = React.useState<TriState>("all")

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

  // Distinct claimant names for the "Claimed By" dropdown, alphabetical.
  const claimedByOptions = React.useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.claimed_by_name).filter(Boolean) as string[]),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  // "Clear" removes all filters: State back to All, all dropdowns/toggles to "all".
  const atDefault =
    stateFilter === ALL &&
    claimedBy === ALL &&
    claimed === "all" &&
    feedbackComplete === "all"

  function clearAll() {
    setStateFilter(ALL)
    setClaimedBy(ALL)
    setClaimed("all")
    setFeedbackComplete("all")
  }

  const visible = React.useMemo(() => {
    const list = rows.filter((r) => {
      if (stateFilter !== ALL && r.state !== stateFilter) return false
      if (claimedBy !== ALL && r.claimed_by_name !== claimedBy) return false
      if (claimed === "yes" && !r.claimed) return false
      if (claimed === "no" && r.claimed) return false
      if (feedbackComplete === "yes" && !r.feedback_received) return false
      if (feedbackComplete === "no" && r.feedback_received) return false
      return true
    })
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
  }, [rows, stateFilter, claimedBy, claimed, feedbackComplete])

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          title="Feedback Report Pipeline"
          subtitle="Active events by feedback-report stage. Done events (report sent) are excluded."
        />
      </div>

      {/* Count cards — informational only (no longer clickable). Filtering is
          driven by the State multi-toggle below. */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATE_ORDER.map((state) => {
          const style = STATE_STYLE[state]
          return (
            <StatCard
              key={state}
              floating
              label={style.short}
              value={counts[state]}
              valueColor={style.text}
            />
          )
        })}
      </div>

      {/* Filters — all on one row, State first; wraps gracefully when narrow.
          Clear pinned right. */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        {/* State single-select — navy-filled active pill, one at a time.
            "All" shows every state. */}
        <div className="flex flex-col gap-1">
          <span className={FILTER_LABEL}>State</span>
          <div
            className="flex h-9 items-center rounded-md bg-card p-0.5"
            style={{ border: "0.5px solid var(--border)" }}
          >
            <button
              type="button"
              onClick={() => setStateFilter(ALL)}
              aria-pressed={stateFilter === ALL}
              className={
                "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
                (stateFilter === ALL ? "text-white" : "text-foreground hover:bg-slate-50")
              }
              style={stateFilter === ALL ? { backgroundColor: NAVY_DEEP } : undefined}
            >
              All
            </button>
            {STATE_ORDER.map((state) => {
              const active = stateFilter === state
              return (
                <button
                  key={state}
                  type="button"
                  onClick={() => setStateFilter(state)}
                  aria-pressed={active}
                  className={
                    "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
                    (active ? "text-white" : "text-foreground hover:bg-slate-50")
                  }
                  style={active ? { backgroundColor: NAVY_DEEP } : undefined}
                >
                  {STATE_STYLE[state].short}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fbmgr-claimed-by" className={FILTER_LABEL}>
            Claimed By
          </label>
          <select
            id="fbmgr-claimed-by"
            value={claimedBy}
            onChange={(e) => setClaimedBy(e.target.value)}
            className="h-9 max-w-[260px] rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value={ALL}>All</option>
            {claimedByOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <TriToggle
          label="Claimed?"
          value={claimed}
          onChange={setClaimed}
          yesLabel="Claimed"
          noLabel="Unclaimed"
        />
        <TriToggle
          label="Feedback Complete"
          value={feedbackComplete}
          onChange={setFeedbackComplete}
          yesLabel="Complete"
          noLabel="Incomplete"
        />
        {!atDefault && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto h-9 cursor-pointer rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Result count */}
      <div className="mb-3 text-xs text-muted-foreground">
        {visible.length} {visible.length === 1 ? "event" : "events"}
      </div>

      {/* Event table */}
      {visible.length === 0 ? (
        <div className={`px-4 py-10 text-center text-sm text-muted-foreground ${CARD_CLASS}`}>
          No events match the current filters.
        </div>
      ) : (
        <div className={`overflow-x-auto ${CARD_CLASS}`}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <Th>State</Th>
                <Th>Event</Th>
                <Th>Client</Th>
                <Th>Start</Th>
                <Th>End</Th>
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
                      className="max-w-[280px] truncate px-3 py-2.5 font-medium"
                      title={r.event_name}
                    >
                      {r.event_name}
                    </td>
                    <td
                      className="max-w-[180px] truncate px-3 py-2.5"
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
                    <td className="max-w-[180px] px-3 py-2.5">
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
                      className="max-w-[150px] truncate px-3 py-2.5"
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

// Tri-state segmented control (All / yes / no), styled like the navy State
// multi-toggle: the active segment is navy-filled.
function TriToggle({
  label,
  value,
  onChange,
  yesLabel,
  noLabel,
}: {
  label: string
  value: TriState
  onChange: (v: TriState) => void
  yesLabel: string
  noLabel: string
}) {
  const opts: { v: TriState; label: string }[] = [
    { v: "all", label: "All" },
    { v: "yes", label: yesLabel },
    { v: "no", label: noLabel },
  ]
  return (
    <div className="flex flex-col gap-1">
      <span className={FILTER_LABEL}>{label}</span>
      <div
        className="flex h-9 items-center rounded-md bg-card p-0.5"
        style={{ border: "0.5px solid var(--border)" }}
      >
        {opts.map((o) => {
          const active = value === o.v
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(o.v)}
              aria-pressed={active}
              className={
                "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
                (active ? "text-white" : "text-foreground hover:bg-slate-50")
              }
              style={active ? { backgroundColor: NAVY_DEEP } : undefined}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

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

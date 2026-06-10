"use client"

import * as React from "react"
import { ArrowUp } from "lucide-react"
import type { SchedulerMeetingRow, SchedulerUnassignedRow } from "@/lib/types"

// Brand palette
const NAVY_DEEP = "#1E2858"
const VIRTUAL = "#378ADD" // virtual meeting block (blue)
const INPERSON = "#1D9E75" // in-person 1h core (teal)
// Striped travel-buffer fill, built from the in-person colour at low opacity.
const BUFFER_FILL = `repeating-linear-gradient(45deg, ${INPERSON}40, ${INPERSON}40 5px, ${INPERSON}14 5px, ${INPERSON}14 10px)`

// Default visible grid window: 7:00am–6:00pm. Auto-extended per displayed set
// when meetings (incl. buffers) fall outside it.
const DEFAULT_START = 7 * 60
const DEFAULT_END = 18 * 60

// In-person travel buffer, minutes each side of the 1h core.
const BUFFER = 45
const CORE = 60

// "Free at" options: hourly 9am–5pm, plus an "Any time" default (null).
const FREE_AT_OPTIONS = Array.from({ length: 9 }, (_, i) => 540 + i * 60) // 540..1020

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const PX_PER_HOUR = 44 // week view vertical scale

type Interval = { start: number; end: number }
type Mode = "day" | "week"

// A computed host suggestion for one unassigned meeting (advisory only).
type UnassignedItem = {
  row: SchedulerUnassignedRow
  noPrior: boolean // pool empty — no host has ever hosted this institution/client
  suggestedName: string | null // highest-ranked free candidate, if any
  rationale: string | null // why the suggested host fits
  bumpNote: string | null // amber note when the usual top host is busy
}

// ---------------------------------------------------------------------------
// Duration / occupied-interval model (lives here, not in SQL).
// Every meeting's core is 1h from start. Virtual occupies [start, start+60];
// in-person adds a 45m travel buffer each side: [start-45, start+60+45].
// ---------------------------------------------------------------------------
function occFrom(startMinutes: number, isInPerson: boolean): Interval {
  if (isInPerson) {
    return { start: startMinutes - BUFFER, end: startMinutes + CORE + BUFFER }
  }
  return { start: startMinutes, end: startMinutes + CORE }
}
function occupiedInterval(m: SchedulerMeetingRow): Interval {
  return occFrom(m.start_minutes, m.is_in_person)
}

// Two half-open intervals overlap when each starts before the other ends.
function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

type Seg = { startM: number; endM: number; kind: "virtual" | "core" | "buffer" }
function meetingSegments(m: SchedulerMeetingRow): Seg[] {
  const s = m.start_minutes
  if (m.is_in_person) {
    return [
      { startM: s - BUFFER, endM: s, kind: "buffer" },
      { startM: s, endM: s + CORE, kind: "core" },
      { startM: s + CORE, endM: s + CORE + BUFFER, kind: "buffer" },
    ]
  }
  return [{ startM: s, endM: s + CORE, kind: "virtual" }]
}

// Merge overlapping/adjacent occupied intervals into continuous busy bands so
// the free-finder stays accurate when meetings or buffers collide.
function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged: Interval[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const cur = sorted[i]
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end)
    else merged.push({ ...cur })
  }
  return merged
}

// A host is busy at instant T if T falls in any merged band. Half-open so a
// meeting ending exactly at T frees the host at T.
function isBusyAt(bands: Interval[], t: number): boolean {
  return bands.some((b) => t >= b.start && t < b.end)
}

// Auto-extend the 7–6 window to cover everything in the displayed set.
function computeWindow(meetings: SchedulerMeetingRow[]): Interval {
  let lo = DEFAULT_START
  let hi = DEFAULT_END
  for (const m of meetings) {
    const iv = occupiedInterval(m)
    if (iv.start < lo) lo = iv.start
    if (iv.end > hi) hi = iv.end
  }
  lo = Math.max(0, Math.floor(lo / 60) * 60)
  hi = Math.ceil(hi / 60) * 60
  return { start: lo, end: hi }
}

// 840 -> "2pm", 870 -> "2:30pm". Wraps past-midnight values sensibly.
function fmtTime(min: number): string {
  const h = (((Math.floor(min / 60) % 24) + 24) % 24)
  const m = ((min % 60) + 60) % 60
  const period = h < 12 ? "am" : "pm"
  let h12 = h % 12
  if (h12 === 0) h12 = 12
  const mm = m === 0 ? "" : ":" + String(m).padStart(2, "0")
  return `${h12}${mm}${period}`
}
function fmtTickShort(min: number): string {
  const h = (((Math.floor(min / 60) % 24) + 24) % 24)
  const period = h < 12 ? "a" : "p"
  let h12 = h % 12
  if (h12 === 0) h12 = 12
  return `${h12}${period}`
}

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}
// Parse a date-input value ('YYYY-MM-DD') as a local date. Returns null if empty
// or malformed (e.g. the user clears the field).
function ymdToDate(s: string): Date | null {
  const parts = s.split("-").map(Number)
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null
  return new Date(parts[0], parts[1] - 1, parts[2])
}
function mondayOf(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (r.getDay() + 6) % 7 // Mon=0 … Sun=6
  return addDays(r, -dow)
}

function meetingLabel(m: SchedulerMeetingRow): string {
  return m.client_account_name || m.institution_name || "Meeting"
}
function meetingTooltip(m: SchedulerMeetingRow): string {
  const time = `${fmtTime(m.start_minutes)}–${fmtTime(m.start_minutes + CORE)}`
  const type = m.is_in_person ? "In-person (+45m travel each side)" : "Virtual"
  return `${meetingLabel(m)} · ${time} · ${type}`
}

// Build hour ticks across [start, end].
function hourTicks(win: Interval): number[] {
  const ticks: number[] = []
  for (let t = win.start; t <= win.end; t += 60) ticks.push(t)
  return ticks
}

const selectClass = "h-9 rounded-md border border-border bg-card px-2 text-sm"

export function SchedulerView({
  meetings,
  unassigned,
}: {
  meetings: SchedulerMeetingRow[]
  unassigned: SchedulerUnassignedRow[]
}) {
  const today = React.useMemo(() => new Date(), [])

  // Cutoff for "last 12 months" host activity, as an Eastern calendar date
  // string so it compares directly against meeting_day ('YYYY-MM-DD').
  const cutoffYmd = React.useMemo(
    () => ymd(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())),
    [today],
  )

  // Meetings hosted by each person in the last 12 months — drives the default
  // host ordering (most active first).
  const l12mByHost = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const m of meetings) {
      if (m.meeting_day >= cutoffYmd) map.set(m.host_id, (map.get(m.host_id) ?? 0) + 1)
    }
    return map
  }, [meetings, cutoffYmd])

  // Distinct hosts that have actually hosted a confirmed meeting, ordered by
  // last-12-month hosted count (desc), with host_name A–Z as the tiebreaker.
  const hosts = React.useMemo(() => {
    const names = new Map<string, string>()
    for (const m of meetings) if (!names.has(m.host_id)) names.set(m.host_id, m.host_name)
    return Array.from(names, ([host_id, host_name]) => ({
      host_id,
      host_name,
      l12m: l12mByHost.get(host_id) ?? 0,
    })).sort((a, b) => b.l12m - a.l12m || a.host_name.localeCompare(b.host_name))
  }, [meetings, l12mByHost])

  // Lifetime frequency maps + per-host/day occupied intervals, derived once from
  // hosted meetings. Used to suggest a host for each unassigned meeting.
  // Hosted meetings expose client_account_name (not id), so client affinity is
  // matched by name; institution affinity is matched by institution_name.
  const affinity = React.useMemo(() => {
    const hostName = new Map<string, string>()
    const instHost = new Map<string, Map<string, number>>() // institution → host → count
    const clientHost = new Map<string, Map<string, number>>() // client name → host → count
    const instTotal = new Map<string, number>() // institution → total hosted meetings
    const clientTotal = new Map<string, number>() // client name → total hosted meetings
    const hostDay = new Map<string, Map<string, Interval[]>>() // host → day → occupied intervals

    const bump = (m: Map<string, Map<string, number>>, key: string, host: string) => {
      let inner = m.get(key)
      if (!inner) m.set(key, (inner = new Map()))
      inner.set(host, (inner.get(host) ?? 0) + 1)
    }

    for (const m of meetings) {
      hostName.set(m.host_id, m.host_name)
      if (m.institution_name) {
        bump(instHost, m.institution_name, m.host_id)
        instTotal.set(m.institution_name, (instTotal.get(m.institution_name) ?? 0) + 1)
      }
      if (m.client_account_name) {
        bump(clientHost, m.client_account_name, m.host_id)
        clientTotal.set(m.client_account_name, (clientTotal.get(m.client_account_name) ?? 0) + 1)
      }
      let days = hostDay.get(m.host_id)
      if (!days) hostDay.set(m.host_id, (days = new Map()))
      const arr = days.get(m.meeting_day)
      if (arr) arr.push(occupiedInterval(m))
      else days.set(m.meeting_day, [occupiedInterval(m)])
    }
    return { hostName, instHost, clientHost, instTotal, clientTotal, hostDay }
  }, [meetings])

  const [mode, setMode] = React.useState<Mode>("day")
  // Single source of truth: the selected date. Day mode shows this date; Week
  // mode shows the Mon–Fri week containing it. Defaults to today.
  const [anchorDate, setAnchorDate] = React.useState<Date>(() => new Date())
  const [freeAt, setFreeAt] = React.useState<number | null>(null)
  const [selectedHost, setSelectedHost] = React.useState<string>("")

  // Default the Week-view host to the first one alphabetically until the user
  // picks one (derived, so no effect/cascading render).
  const effectiveHost = selectedHost || hosts[0]?.host_id || ""

  const weekStart = React.useMemo(() => mondayOf(anchorDate), [anchorDate])
  const weekDays = React.useMemo(() => {
    return WEEKDAY_LABELS.map((label, i) => {
      const d = addDays(weekStart, i)
      return { label, date: d, ymd: ymd(d) }
    })
  }, [weekStart])

  const todayYmd = ymd(today)
  const anchorYmd = ymd(anchorDate)
  const anchorLabel = `${DOW_SHORT[anchorDate.getDay()]} ${MONTHS[anchorDate.getMonth()]} ${anchorDate.getDate()}`

  const weekRangeLabel = `${MONTHS[weekDays[0].date.getMonth()]} ${weekDays[0].date.getDate()} – ${MONTHS[weekDays[4].date.getMonth()]} ${weekDays[4].date.getDate()}, ${weekDays[4].date.getFullYear()}`

  // ---- Day-mode derived data --------------------------------------------
  const dayYmd = anchorYmd
  const dayMeetings = React.useMemo(
    () => meetings.filter((m) => m.meeting_day === dayYmd),
    [meetings, dayYmd],
  )
  const dayWindow = React.useMemo(() => computeWindow(dayMeetings), [dayMeetings])

  const dayRows = React.useMemo(() => {
    return hosts.map((h) => {
      const ms = dayMeetings
        .filter((m) => m.host_id === h.host_id)
        .sort((a, b) => a.start_minutes - b.start_minutes)
      const bands = mergeIntervals(ms.map(occupiedInterval))
      const free = freeAt == null ? null : !isBusyAt(bands, freeAt)
      return { ...h, meetings: ms, free }
    })
  }, [hosts, dayMeetings, freeAt])

  // Default order is already L12M-desc (hosts is pre-sorted). With a "Free at"
  // time, free hosts float to the top, then within each free/busy group keep
  // the L12M-desc order (host_name as the final tiebreaker).
  const sortedDayRows = React.useMemo(() => {
    if (freeAt == null) return dayRows
    return [...dayRows].sort((a, b) => {
      if (a.free !== b.free) return a.free ? -1 : 1
      return b.l12m - a.l12m || a.host_name.localeCompare(b.host_name)
    })
  }, [dayRows, freeAt])

  // Suggested host per unassigned meeting on the selected date. Each is computed
  // independently (no chain-reservation across rows) and is advisory only.
  const unassignedItems = React.useMemo<UnassignedItem[]>(() => {
    const rows = unassigned
      .filter((u) => u.meeting_day === anchorYmd)
      .sort((a, b) => a.start_minutes - b.start_minutes)

    return rows.map((u) => {
      const occ = occFrom(u.start_minutes, u.is_in_person)
      const inst = u.institution_name
      const client = u.client_account_name
      const instMap = inst ? affinity.instHost.get(inst) : undefined
      const clientMap = client ? affinity.clientHost.get(client) : undefined

      // Candidate pool = any host who has hosted this institution OR this client.
      const candidateIds = new Set<string>()
      if (instMap) for (const id of instMap.keys()) candidateIds.add(id)
      if (clientMap) for (const id of clientMap.keys()) candidateIds.add(id)

      const candidates = Array.from(candidateIds)
        .map((id) => ({
          id,
          name: affinity.hostName.get(id) ?? "—",
          instCount: instMap?.get(id) ?? 0,
          clientCount: clientMap?.get(id) ?? 0,
          l12m: l12mByHost.get(id) ?? 0,
        }))
        // Rank: institution count desc, then client count desc, then L12M desc,
        // with name as a final deterministic tiebreaker.
        .sort(
          (a, b) =>
            b.instCount - a.instCount ||
            b.clientCount - a.clientCount ||
            b.l12m - a.l12m ||
            a.name.localeCompare(b.name),
        )

      const isBusy = (id: string) => {
        const ivs = affinity.hostDay.get(id)?.get(u.meeting_day)
        return ivs ? ivs.some((iv) => intervalsOverlap(iv, occ)) : false
      }

      const rationaleFor = (c: { instCount: number; clientCount: number }) => {
        if (c.instCount > 0 && inst) {
          return `hosts ${c.instCount} of ${affinity.instTotal.get(inst) ?? c.instCount} ${inst} meetings`
        }
        if (c.clientCount > 0 && client) {
          return `hosts ${c.clientCount} of ${affinity.clientTotal.get(client) ?? c.clientCount} ${client} meetings`
        }
        return null
      }

      const top = candidates[0]
      const suggested = candidates.find((c) => !isBusy(c.id)) ?? null
      const topPrimaryN = top ? (top.instCount > 0 ? top.instCount : top.clientCount) : 0

      // Surface a note when the overall top candidate was skipped (or everyone
      // is busy) because the usual host has a conflict.
      const bumpNote =
        top && (!suggested || suggested.id !== top.id)
          ? `${top.name} usually hosts (${topPrimaryN}) but is busy at ${fmtTime(u.start_minutes)}`
          : null

      return {
        row: u,
        noPrior: candidates.length === 0,
        suggestedName: suggested ? suggested.name : null,
        rationale: suggested ? rationaleFor(suggested) : null,
        bumpNote,
      }
    })
  }, [unassigned, anchorYmd, affinity, l12mByHost])

  const freeCount = freeAt == null ? 0 : dayRows.filter((r) => r.free).length

  // ---- Week-mode derived data -------------------------------------------
  const weekHostMeetings = React.useMemo(() => {
    if (!effectiveHost) return [] as SchedulerMeetingRow[]
    const set = new Set(weekDays.map((d) => d.ymd))
    return meetings.filter((m) => m.host_id === effectiveHost && set.has(m.meeting_day))
  }, [meetings, effectiveHost, weekDays])
  const weekWindow = React.useMemo(() => computeWindow(weekHostMeetings), [weekHostMeetings])

  const selectedHostName = hosts.find((h) => h.host_id === effectiveHost)?.host_name ?? ""

  function pctOf(win: Interval, t: number): number {
    return ((t - win.start) / (win.end - win.start)) * 100
  }

  return (
    <>
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-medium tracking-tight" style={{ color: NAVY_DEEP }}>
          Scheduler
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Host availability from confirmed meetings. See one person&apos;s week, or who&apos;s
          free across everyone on a given day.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-4 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Mode toggle */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">View</label>
            <div className="flex h-9 items-center rounded-md border border-border bg-card p-0.5">
              {(
                [
                  { key: "day", label: "Day · everyone" },
                  { key: "week", label: "Week · one person" },
                ] as const
              ).map((opt) => {
                const active = mode === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setMode(opt.key)}
                    className={
                      "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
                      (active ? "bg-[#1E2858] text-white" : "text-foreground hover:bg-slate-50")
                    }
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Date navigator — date picker jumps to any date; arrows step by
              day (Day mode) or week (Week mode). */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            <div className="flex h-9 items-center gap-1">
              <button
                type="button"
                onClick={() => setAnchorDate((d) => addDays(d, mode === "week" ? -7 : -1))}
                className="h-9 rounded-md border border-border bg-card px-2 text-sm hover:bg-slate-50"
                aria-label={mode === "week" ? "Previous week" : "Previous day"}
              >
                ◀
              </button>
              <input
                type="date"
                value={anchorYmd}
                onChange={(e) => {
                  const d = ymdToDate(e.target.value)
                  if (d) setAnchorDate(d)
                }}
                className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                aria-label="Selected date"
              />
              <button
                type="button"
                onClick={() => setAnchorDate((d) => addDays(d, mode === "week" ? 7 : 1))}
                className="h-9 rounded-md border border-border bg-card px-2 text-sm hover:bg-slate-50"
                aria-label={mode === "week" ? "Next week" : "Next day"}
              >
                ▶
              </button>
              <button
                type="button"
                onClick={() => setAnchorDate(new Date())}
                className="h-9 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-slate-50"
              >
                Today
              </button>
              <span className="ml-1 text-sm tabular-nums text-muted-foreground">
                {mode === "week" ? weekRangeLabel : anchorLabel}
              </span>
            </div>
          </div>

          {/* Day mode: weekday tabs + Free-at */}
          {mode === "day" && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Day</label>
                <div className="flex h-9 items-center rounded-md border border-border bg-card p-0.5">
                  {weekDays.map((d) => {
                    const active = d.ymd === anchorYmd
                    const isToday = d.ymd === todayYmd
                    return (
                      <button
                        key={d.ymd}
                        type="button"
                        onClick={() => setAnchorDate(d.date)}
                        className={
                          "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
                          (active
                            ? "bg-[#1E2858] text-white"
                            : "text-foreground hover:bg-slate-50")
                        }
                        title={`${d.label} ${d.date.getDate()}`}
                      >
                        {d.label}
                        {isToday ? <span className="ml-0.5 opacity-70">•</span> : null}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Free at</label>
                <select
                  value={freeAt == null ? "any" : String(freeAt)}
                  onChange={(e) =>
                    setFreeAt(e.target.value === "any" ? null : Number(e.target.value))
                  }
                  className={selectClass}
                  aria-label="Free at time"
                >
                  <option value="any">Any time</option>
                  {FREE_AT_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {fmtTime(t)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Week mode: host dropdown */}
          {mode === "week" && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Host</label>
              <select
                value={effectiveHost}
                onChange={(e) => setSelectedHost(e.target.value)}
                className={selectClass + " w-56"}
                aria-label="Host"
              >
                {hosts.map((h) => (
                  <option key={h.host_id} value={h.host_id}>
                    {h.host_name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Legend + caveat — placed above the grid so the key reads first. */}
      <Legend />

      {/* Unassigned meetings — Day view only, for the selected date. */}
      {mode === "day" && (
        <UnassignedSection items={unassignedItems} dateLabel={anchorLabel} />
      )}

      {/* Summary line */}
      <div className="mb-3 text-sm text-muted-foreground">
        {mode === "day" ? (
          freeAt == null ? (
            <>
              {anchorLabel} · {dayMeetings.length} meeting
              {dayMeetings.length === 1 ? "" : "s"} across {hosts.length} host
              {hosts.length === 1 ? "" : "s"}
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{freeCount}</span> of {hosts.length}{" "}
              free at {fmtTime(freeAt)} · {anchorLabel}
            </>
          )
        ) : (
          <>
            <span className="font-medium text-foreground">{selectedHostName}</span> ·{" "}
            {weekHostMeetings.length} meeting{weekHostMeetings.length === 1 ? "" : "s"} · week of{" "}
            {weekRangeLabel}
          </>
        )}
      </div>

      {/* Grid */}
      {mode === "day" ? (
        <DayGrid
          rows={sortedDayRows}
          win={dayWindow}
          freeAt={freeAt}
          pctOf={pctOf}
        />
      ) : (
        <WeekGrid host={selectedHostName} meetings={weekHostMeetings} weekDays={weekDays} win={weekWindow} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Day view: rows = hosts, horizontal timelines across the visible window.
// ---------------------------------------------------------------------------
function DayGrid({
  rows,
  win,
  freeAt,
  pctOf,
}: {
  rows: { host_id: string; host_name: string; free: boolean | null; meetings: SchedulerMeetingRow[] }[]
  win: Interval
  freeAt: number | null
  pctOf: (win: Interval, t: number) => number
}) {
  const ticks = hourTicks(win)
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div className="min-w-[720px]">
        {/* Hour header */}
        <div className="flex border-b">
          <div className="w-44 shrink-0 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            Host
          </div>
          <div className="relative flex-1 py-1.5">
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ left: `${pctOf(win, t)}%` }}
              >
                {fmtTickShort(t)}
              </span>
            ))}
            {/* Free-at marker */}
            {freeAt != null && freeAt >= win.start && freeAt <= win.end && (
              <span
                className="absolute top-0 -translate-x-1/2 text-[10px] font-medium"
                style={{ left: `${pctOf(win, freeAt)}%`, color: NAVY_DEEP }}
              >
                ▾
              </span>
            )}
          </div>
        </div>

        {rows.map((row) => {
          const dim = freeAt != null && row.free === false
          return (
            <div key={row.host_id} className={"flex border-b last:border-0 " + (dim ? "opacity-40" : "")}>
              <div className="flex w-44 shrink-0 items-center gap-1.5 px-3 py-2">
                <span className="truncate text-sm">{row.host_name}</span>
                {freeAt != null && row.free && (
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                    free
                  </span>
                )}
              </div>
              <div className="relative h-11 flex-1">
                {/* Hour gridlines */}
                {ticks.map((t) => (
                  <div
                    key={t}
                    className="absolute top-0 bottom-0 border-l border-border/50"
                    style={{ left: `${pctOf(win, t)}%` }}
                  />
                ))}
                {/* Free-at vertical marker */}
                {freeAt != null && freeAt >= win.start && freeAt <= win.end && (
                  <div
                    className="absolute top-0 bottom-0 border-l-2 border-dashed"
                    style={{ left: `${pctOf(win, freeAt)}%`, borderColor: NAVY_DEEP }}
                  />
                )}
                {/* Meeting blocks */}
                {row.meetings.map((m) =>
                  meetingSegments(m).map((s, i) => {
                    const left = pctOf(win, s.startM)
                    const width = pctOf(win, s.endM) - pctOf(win, s.startM)
                    const isCore = s.kind !== "buffer"
                    return (
                      <div
                        key={m.meeting_id + "-" + i}
                        title={meetingTooltip(m)}
                        className="absolute top-1.5 bottom-1.5 flex items-center overflow-hidden rounded px-1"
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 0)}%`,
                          ...(s.kind === "virtual"
                            ? { backgroundColor: VIRTUAL }
                            : s.kind === "core"
                              ? { backgroundColor: INPERSON }
                              : { background: BUFFER_FILL, border: `1px solid ${INPERSON}55` }),
                        }}
                      >
                        {isCore && (
                          <span className="truncate text-[10px] font-medium leading-none text-white">
                            {meetingLabel(m)}
                          </span>
                        )}
                      </div>
                    )
                  }),
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Week view: one host, Mon–Fri columns × hour rows for the visible window.
// ---------------------------------------------------------------------------
function WeekGrid({
  host,
  meetings,
  weekDays,
  win,
}: {
  host: string
  meetings: SchedulerMeetingRow[]
  weekDays: { label: string; date: Date; ymd: string }[]
  win: Interval
}) {
  const ticks = hourTicks(win)
  const pxPerMin = PX_PER_HOUR / 60
  const gridHeight = (win.end - win.start) * pxPerMin
  const topOf = (t: number) => (t - win.start) * pxPerMin

  if (!host) {
    return (
      <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        Select a host to see their week.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div className="flex min-w-[720px]">
        {/* Time axis */}
        <div className="w-12 shrink-0">
          <div className="h-7 border-b" />
          <div className="relative" style={{ height: gridHeight }}>
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: topOf(t) }}
              >
                {fmtTickShort(t)}
              </span>
            ))}
          </div>
        </div>

        {/* Day columns */}
        {weekDays.map((d) => {
          const dayMeetings = meetings
            .filter((m) => m.meeting_day === d.ymd)
            .sort((a, b) => a.start_minutes - b.start_minutes)
          return (
            <div key={d.ymd} className="flex-1 border-l">
              <div className="flex h-7 items-center justify-center border-b text-xs font-medium text-muted-foreground">
                {d.label} {d.date.getDate()}
              </div>
              <div className="relative" style={{ height: gridHeight }}>
                {/* Hour gridlines */}
                {ticks.map((t) => (
                  <div
                    key={t}
                    className="absolute left-0 right-0 border-t border-border/50"
                    style={{ top: topOf(t) }}
                  />
                ))}
                {/* Meeting blocks */}
                {dayMeetings.map((m) =>
                  meetingSegments(m).map((s, i) => {
                    const top = topOf(s.startM)
                    const height = (s.endM - s.startM) * pxPerMin
                    const isCore = s.kind !== "buffer"
                    return (
                      <div
                        key={m.meeting_id + "-" + i}
                        title={meetingTooltip(m)}
                        className="absolute left-0.5 right-0.5 overflow-hidden rounded px-1"
                        style={{
                          top,
                          height: Math.max(height, 0),
                          ...(s.kind === "virtual"
                            ? { backgroundColor: VIRTUAL }
                            : s.kind === "core"
                              ? { backgroundColor: INPERSON }
                              : { background: BUFFER_FILL, border: `1px solid ${INPERSON}55` }),
                        }}
                      >
                        {isCore && (
                          <span className="block truncate text-[10px] font-medium leading-tight text-white">
                            {meetingLabel(m)}
                          </span>
                        )}
                      </div>
                    )
                  }),
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Unassigned meetings: host-less meetings on the selected date, with a
// suggested host for each. Advisory only — the dashboard is read-only against
// the mirrored CRM, so there is no assign action.
// ---------------------------------------------------------------------------
function UnassignedSection({
  items,
  dateLabel,
}: {
  items: UnassignedItem[]
  dateLabel: string
}) {
  return (
    <div className="mb-4">
      <div className="mb-2">
        <h2 className="text-sm font-semibold" style={{ color: NAVY_DEEP }}>
          Unassigned meetings
        </h2>
        <p className="text-xs text-muted-foreground">
          Upcoming confirmed meetings with no host yet — with a suggested host based on who
          usually covers that institution or client and who&apos;s free at the time.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        {items.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No unassigned meetings for {dateLabel}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">When</th>
                  <th className="px-3 py-2 text-left font-medium">Meeting</th>
                  <th className="px-3 py-2 text-left font-medium">Suggested host</th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ row, noPrior, suggestedName, rationale, bumpNote }) => (
                  <tr key={row.meeting_id} className="border-b last:border-0 align-top">
                    {/* When */}
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <div className="font-medium tabular-nums">{fmtTime(row.start_minutes)}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.is_in_person ? "In-person" : "Virtual"}
                      </div>
                    </td>
                    {/* Meeting */}
                    <td className="px-3 py-2.5">
                      <div className="font-medium">
                        {row.institution_name || row.client_account_name || "—"}
                      </div>
                      {row.institution_name && row.client_account_name && (
                        <div className="text-xs text-muted-foreground">
                          {row.client_account_name}
                        </div>
                      )}
                    </td>
                    {/* Suggested host */}
                    <td className="px-3 py-2.5">
                      {noPrior ? (
                        <span className="text-sm italic text-muted-foreground">
                          No prior host for this institution — assign manually.
                        </span>
                      ) : suggestedName ? (
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{suggestedName}</span>
                            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                              free
                            </span>
                          </div>
                          {rationale && (
                            <div className="text-xs text-muted-foreground">{rationale}</div>
                          )}
                          {bumpNote && (
                            <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-600">
                              <ArrowUp className="size-3 shrink-0" />
                              {bumpNote}
                            </div>
                          )}
                        </div>
                      ) : (
                        // Pool non-empty but everyone busy.
                        <div>
                          <span className="text-sm italic text-muted-foreground">
                            No free usual host — assign manually.
                          </span>
                          {bumpNote && (
                            <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-600">
                              <ArrowUp className="size-3 shrink-0" />
                              {bumpNote}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className="mb-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-6 rounded" style={{ backgroundColor: VIRTUAL }} />
          Virtual (1h)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-6 rounded" style={{ backgroundColor: INPERSON }} />
          In-person (1h)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-6 rounded"
            style={{ background: BUFFER_FILL, border: `1px solid ${INPERSON}55` }}
          />
          Travel buffer (45m, in-person)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
            free
          </span>
          Free at the selected time
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Durations are inferred: only meeting <em>start</em> times are in the data, so every
        meeting is assumed to run 1 hour, and in-person meetings add a 45-minute travel buffer
        before and after. Times are US Eastern. A host counts as busy whenever a meeting (or its
        buffer) overlaps a time — overlapping meetings are merged into continuous busy bands for
        the free-finder, but each meeting is still drawn separately.
      </p>
    </div>
  )
}

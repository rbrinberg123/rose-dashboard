"use client"

import * as React from "react"
import { ListTitleCard } from "@/components/page-masthead"
import { CARD_CLASS, BRAND_NAVY, TEXT_PRIMARY, ACCENT_STRIP } from "@/lib/design"
import { cn } from "@/lib/utils"
import type { TimeOffRow } from "@/lib/types"

// Two time-off styles — differentiated by BOTH color and fill style:
//   OOO    = filled light-green pill/bar with dark-green text.
//   Remote = outlined — white fill, slate-blue border + text.
const OOO_STYLE = { fill: "#D6EBD9", border: "#6FAE78", text: "#2E6B3A" }
const REMOTE_STYLE = { fill: "#FFFFFF", border: "#3D5599", text: "#34487F" }

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
// Business-week grid: Monday–Friday only (no weekend columns).
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"]

const TODAY_TINT = "#F2F4FB"

// Prominent divider between week rows (darker + thicker than a hairline).
const ROW_DIVIDER = "#D1D7E0"

// ---- date helpers (local, date-only) --------------------------------------
function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
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
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Short display name: drop credentials after a comma, then first name + last
// initial. "Scott Grossman, CFA" -> "Scott G."
function shortName(name: string): string {
  const base = name.split(",")[0].trim()
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return name
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

function rangeLabel(e: TimeOffRow): string {
  const fmt = (s: string) => {
    const d = parseYmd(s)
    return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`
  }
  return e.start_date === e.end_date ? fmt(e.start_date) : `${fmt(e.start_date)} – ${fmt(e.end_date)}`
}

function tooltipFor(e: TimeOffRow): string {
  const type =
    e.time_off_type === "Remote"
      ? "Remote"
      : `OOO${e.request_type_label ? ` (${e.request_type_label})` : ""}`
  return `${e.person} · ${type} · ${rangeLabel(e)}`
}

// OOO before Remote, then by person name — stable, readable ordering.
function sortDayEntries(arr: TimeOffRow[]): void {
  arr.sort(
    (a, b) =>
      (a.time_off_type === b.time_off_type ? 0 : a.time_off_type === "OOO" ? -1 : 1) ||
      a.person.localeCompare(b.person),
  )
}

// A small color-coded name pill — used in the banner (today + week-ahead).
function Pill({ e }: { e: TimeOffRow }) {
  const remote = e.time_off_type === "Remote"
  const s = remote ? REMOTE_STYLE : OOO_STYLE
  return (
    <span
      title={tooltipFor(e)}
      className="inline-block max-w-[150px] truncate rounded px-1.5 py-0.5 align-middle text-[11px] font-medium leading-tight"
      style={{
        backgroundColor: s.fill,
        color: s.text,
        border: `${remote ? "1.5px" : "1px"} solid ${s.border}`,
      }}
    >
      {shortName(e.person)}
    </span>
  )
}

export function TimeOffView({ entries }: { entries: TimeOffRow[] }) {
  const today = React.useMemo(() => startOfDay(new Date()), [])
  const [viewMonth, setViewMonth] = React.useState<Date>(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [hostsOnly, setHostsOnly] = React.useState(false)
  // Paging for the banner's week view only (0 = current week). The "Out Today"
  // count above stays pinned to the real today regardless of this.
  const [weekOffset, setWeekOffset] = React.useState(0)

  // Active working set — optionally narrowed to people who host meetings.
  const active = React.useMemo(
    () => (hostsOnly ? entries.filter((e) => e.is_host) : entries),
    [entries, hostsOnly],
  )
  const parsed = React.useMemo(
    () => active.map((e) => ({ e, start: parseYmd(e.start_date), end: parseYmd(e.end_date) })),
    [active],
  )

  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()

  // ---- Month grid as weeks (Monday-first, Mon–Fri only) -------------------
  const weeks = React.useMemo(() => {
    const first = new Date(year, month, 1)
    const daysFromMonday = (first.getDay() + 6) % 7
    const gridStart = addDays(first, -daysFromMonday)
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const nWeeks = Math.ceil((daysFromMonday + daysInMonth) / 7)
    const out = []
    for (let w = 0; w < nWeeks; w++) {
      const weekStart = addDays(gridStart, w * 7) // Monday
      const days = WEEKDAY_LABELS.map((_, i) => {
        const d = addDays(weekStart, i)
        return {
          date: d,
          ymd: ymd(d),
          day: d.getDate(),
          inMonth: d.getMonth() === month,
          isToday: d.getTime() === today.getTime(),
        }
      })
      out.push({ weekStart, weekEnd: days[4].date, days })
    }
    return out
  }, [year, month, today])

  // ---- Per-day entries (ymd -> people out that weekday) -------------------
  // A multi-day entry lands on every weekday in its range, so its pill repeats
  // on each day it covers. Weekend days are skipped (no cell renders them).
  const byDay = React.useMemo(() => {
    const map = new Map<string, TimeOffRow[]>()
    const winStart = weeks[0].days[0].date
    const winEnd = weeks[weeks.length - 1].days[4].date
    for (const { e, start, end } of parsed) {
      if (end < winStart || start > winEnd) continue
      let d = start < winStart ? winStart : start
      const last = end > winEnd ? winEnd : end
      while (d <= last) {
        const dow = d.getDay()
        if (dow !== 0 && dow !== 6) {
          const k = ymd(d)
          const arr = map.get(k)
          if (arr) arr.push(e)
          else map.set(k, [e])
        }
        d = addDays(d, 1)
      }
    }
    for (const arr of map.values()) sortDayEntries(arr)
    return map
  }, [weeks, parsed])

  // ---- Banner week view (pageable via weekOffset) -------------------------
  // "Out Today" always reflects the real today; the Mon–Fri grid below reflects
  // the week the user has paged to (current week + weekOffset).
  const weekView = React.useMemo(() => {
    const thisMonday = addDays(today, -((today.getDay() + 6) % 7))
    const monday = addDays(thisMonday, weekOffset * 7)
    const days = WEEKDAY_LABELS.map((label, i) => {
      const d = addDays(monday, i)
      return {
        date: d,
        ymd: ymd(d),
        label,
        day: d.getDate(),
        isToday: d.getTime() === today.getTime(),
        items: [] as TimeOffRow[],
      }
    })
    for (const { e, start, end } of parsed) {
      for (const dc of days) if (start <= dc.date && dc.date <= end) dc.items.push(e)
    }
    days.forEach((dc) => sortDayEntries(dc.items))
    const todayItems: TimeOffRow[] = []
    for (const { e, start, end } of parsed) if (start <= today && today <= end) todayItems.push(e)
    sortDayEntries(todayItems)
    const weekOfLabel = `${MONTHS[monday.getMonth()].slice(0, 3)} ${monday.getDate()}`
    return { todayItems, days, weekOfLabel }
  }, [parsed, today, weekOffset])

  // ---- Month summary ------------------------------------------------------
  const summary = React.useMemo(() => {
    const monthStart = new Date(year, month, 1)
    const monthEnd = new Date(year, month + 1, 0)
    let ooo = 0
    let remote = 0
    for (const { e, start, end } of parsed) {
      if (end < monthStart || start > monthEnd) continue
      if (e.time_off_type === "Remote") remote++
      else ooo++
    }
    return { ooo, remote, total: ooo + remote }
  }, [parsed, year, month])

  const monthLabel = `${MONTHS[month]} ${year}`
  const todayLabel = `${DOW_SHORT[today.getDay()]} ${MONTHS[today.getMonth()].slice(0, 3)} ${today.getDate()}`

  const goPrev = () => setViewMonth(new Date(year, month - 1, 1))
  const goNext = () => setViewMonth(new Date(year, month + 1, 1))
  const goToday = () => {
    const n = new Date()
    setViewMonth(new Date(n.getFullYear(), n.getMonth(), 1))
  }

  return (
    <>
      {/* Floating list-title card */}
      <div className="mb-4">
        <ListTitleCard
          title="Time Off"
          subtitle="Approved time off across the team — today at a glance, plus the month ahead."
        />
      </div>

      {/* This Week banner (B1): Out Today + Week Ahead, navy-accented card */}
      <div className="mb-4 flex overflow-hidden rounded-[14px] border border-[#D9DFEC] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_rgba(16,24,40,0.05)]">
        <div aria-hidden="true" className="w-[5px] shrink-0" style={{ background: ACCENT_STRIP }} />
        <div className="min-w-0 flex-1 p-4">
          {/* Out Today */}
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold leading-none" style={{ color: BRAND_NAVY }}>
              {weekView.todayItems.length}
            </span>
            <span className="text-sm font-medium text-foreground">
              {weekView.todayItems.length === 1 ? "person" : "people"} out or remote today
            </span>
            <span className="text-xs text-muted-foreground">
              · {todayLabel}
              {hostsOnly ? " · hosts" : ""}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {weekView.todayItems.length === 0 ? (
              <span className="text-sm text-muted-foreground">No one is out today.</span>
            ) : (
              weekView.todayItems.map((e) => <Pill key={e.ooo_id} e={e} />)
            )}
          </div>

          {/* Divider */}
          <div className="my-3 border-t border-border" />

          {/* Week of [Monday] — pageable Mon–Fri grid, everyone shown */}
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Week of {weekView.weekOfLabel}
            </span>
            <button
              type="button"
              onClick={() => setWeekOffset((o) => o - 1)}
              aria-label="Previous week"
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-slate-100 hover:text-foreground"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset((o) => o + 1)}
              aria-label="Next week"
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-slate-100 hover:text-foreground"
            >
              ›
            </button>
          </div>

          <div className="space-y-1.5">
            {weekView.days.map((dc) => (
              <div key={dc.ymd} className="flex items-start gap-2">
                <span className="mt-0.5 w-16 shrink-0 text-xs font-medium text-muted-foreground">
                  {dc.label} {dc.day}
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {dc.items.length === 0 ? (
                    <span className="text-xs text-muted-foreground/50">—</span>
                  ) : (
                    dc.items.map((e) => <Pill key={e.ooo_id} e={e} />)
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Monthly Calendar section header */}
      <h2 className="mb-2 mt-1 text-base font-semibold" style={{ color: TEXT_PRIMARY }}>
        Monthly Calendar
      </h2>

      {/* Controls + legend */}
      <div className={`mb-4 p-4 ${CARD_CLASS}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Month navigator */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goPrev}
              className="h-9 rounded-md border border-border bg-card px-2 text-sm hover:bg-slate-50"
              aria-label="Previous month"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={goToday}
              className="h-9 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-slate-50"
            >
              Today
            </button>
            <button
              type="button"
              onClick={goNext}
              className="h-9 rounded-md border border-border bg-card px-2 text-sm hover:bg-slate-50"
              aria-label="Next month"
            >
              ▶
            </button>
            <span className="ml-2 text-base font-semibold" style={{ color: TEXT_PRIMARY }}>
              {monthLabel}
            </span>
          </div>

          {/* Hosts-only filter + legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex cursor-pointer items-center gap-1.5 select-none">
              <input
                type="checkbox"
                checked={hostsOnly}
                onChange={(e) => setHostsOnly(e.target.checked)}
                className="size-3.5 accent-[#1E2858]"
              />
              Hosts only
            </label>
            <span className="text-border">|</span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-6 rounded"
                style={{ backgroundColor: OOO_STYLE.fill, border: `1px solid ${OOO_STYLE.border}` }}
              />
              OOO (filled)
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-6 rounded"
                style={{ backgroundColor: REMOTE_STYLE.fill, border: `1.5px solid ${REMOTE_STYLE.border}` }}
              />
              Remote (outlined)
            </span>
          </div>
        </div>

        {/* Month summary */}
        <div className="mt-3 text-sm text-muted-foreground">
          {summary.total === 0 ? (
            <>No approved time off in {monthLabel}{hostsOnly ? " for hosts" : ""}.</>
          ) : (
            <>
              <span className="font-medium text-foreground">{summary.total}</span> time-off entr
              {summary.total === 1 ? "y" : "ies"} this month
              <span className="mx-1.5 text-border">·</span>
              {summary.ooo} OOO
              <span className="mx-1.5 text-border">·</span>
              {summary.remote} Remote
              {hostsOnly ? <span className="ml-1.5 text-muted-foreground/80">(hosts only)</span> : null}
            </>
          )}
        </div>
      </div>

      {/* Spanning-bar month calendar */}
      <div className={`overflow-hidden ${CARD_CLASS}`}>
        {/* Weekday header (Mon–Fri) */}
        <div className="grid grid-cols-5 border-b border-border bg-slate-50">
          {WEEKDAY_LABELS.map((w) => (
            <div
              key={w}
              className="px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {w}
            </div>
          ))}
        </div>

        {/* Week rows — each a Mon–Fri row of per-day cells */}
        {weeks.map((week, wi) => (
          <div
            key={week.weekStart.getTime()}
            className="grid grid-cols-5"
            style={{
              borderBottom: wi === weeks.length - 1 ? undefined : `2px solid ${ROW_DIVIDER}`,
            }}
          >
            {week.days.map((d) => {
              const items = byDay.get(d.ymd) ?? []
              return (
                <div
                  key={d.ymd}
                  className={cn(
                    "flex min-h-[157px] flex-col border-r border-border/60 p-1.5 [&:nth-child(5n)]:border-r-0",
                    d.inMonth ? "bg-white" : "bg-[#F7F8FA]",
                  )}
                  style={
                    d.isToday
                      ? { backgroundColor: TODAY_TINT, boxShadow: `inset 0 0 0 2px ${BRAND_NAVY}` }
                      : undefined
                  }
                >
                  {/* Date number (today gets a navy chip) */}
                  <div
                    className={cn(
                      "mb-1 flex shrink-0 items-center justify-end text-sm font-bold tabular-nums",
                      d.inMonth ? "text-foreground" : "text-muted-foreground/40",
                    )}
                  >
                    {d.isToday ? (
                      <span
                        className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[13px] font-bold text-white"
                        style={{ backgroundColor: BRAND_NAVY }}
                      >
                        {d.day}
                      </span>
                    ) : (
                      <span>{d.day}</span>
                    )}
                  </div>

                  {/* Per-day name pills — individual inline pills that wrap, so
                      several people fit per row (same as the banner). Scrolls
                      within the cell on busy days. */}
                  <div className="flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-y-auto pr-0.5">
                    {items.map((e) => (
                      <Pill key={e.ooo_id} e={e} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Shows approved time off only, Monday–Friday (weekends are not shown). A multi-day entry
        appears as a pill on each weekday in its range. Names are shortened to first name + last
        initial; hover any pill for the full name, type, and dates. OOO (filled green) covers
        vacation, personal, sick, and other non-remote time; Remote (outlined blue) is remote-work
        days. &ldquo;Hosts only&rdquo; limits the view to people who host meetings.
      </p>
    </>
  )
}

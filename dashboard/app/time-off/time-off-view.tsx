"use client"

import * as React from "react"
import { ListTitleCard } from "@/components/page-masthead"
import { CARD_CLASS, BRAND_NAVY, TEXT_PRIMARY, ACCENT_STRIP } from "@/lib/design"
import { cn } from "@/lib/utils"
import type { TimeOffRow } from "@/lib/types"

// Two time-off styles — differentiated by BOTH color and fill style:
//   OOO    = solid light-green pill with dark-green text (distinct from the
//            money-green #0E7C56 and the success greens used elsewhere).
//   Remote = outlined pill — white fill, slate-blue border + text.
const OOO_STYLE = { fill: "#C0DD97", border: "#97C459", text: "#27500A" }
const REMOTE_STYLE = { fill: "#FFFFFF", border: "#3D5599", text: "#34487F" }

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
// Business-week grid: Monday–Friday only (no weekend columns).
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"]

// Today's-cell accent + a faint tint so the current day clearly stands out.
const TODAY_TINT = "#F2F4FB"

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

// Short display name for the narrow pills: drop credentials after a comma, then
// first name + last initial. "Scott Grossman, CFA" -> "Scott G."
function shortName(name: string): string {
  const base = name.split(",")[0].trim()
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return name
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

// Human range for the pill tooltip.
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

// OOO before Remote, then by person name — stable, readable per-day ordering.
function sortDayEntries(arr: TimeOffRow[]): void {
  arr.sort(
    (a, b) =>
      (a.time_off_type === b.time_off_type ? 0 : a.time_off_type === "OOO" ? -1 : 1) ||
      a.person.localeCompare(b.person),
  )
}

export function TimeOffView({ entries }: { entries: TimeOffRow[] }) {
  const today = React.useMemo(() => startOfDay(new Date()), [])
  const [viewMonth, setViewMonth] = React.useState<Date>(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [hostsOnly, setHostsOnly] = React.useState(false)

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

  // Build the calendar grid — Monday-first, Mon–Fri only (5 columns/week).
  const cells = React.useMemo(() => {
    const first = new Date(year, month, 1)
    const daysFromMonday = (first.getDay() + 6) % 7 // Mon=0 … Sun=6
    const gridStart = addDays(first, -daysFromMonday)
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const weeks = Math.ceil((daysFromMonday + daysInMonth) / 7)
    const out: {
      date: Date
      ymd: string
      day: number
      inMonth: boolean
      isToday: boolean
    }[] = []
    for (let w = 0; w < weeks; w++) {
      for (let dow = 0; dow < 5; dow++) {
        // dow 0..4 = Mon..Fri; weekend days are simply never emitted.
        const d = addDays(gridStart, w * 7 + dow)
        out.push({
          date: d,
          ymd: ymd(d),
          day: d.getDate(),
          inMonth: d.getMonth() === month,
          isToday: d.getTime() === today.getTime(),
        })
      }
    }
    return out
  }, [year, month, today])

  // Map ymd -> entries out that day. Multi-day spans land on every weekday in
  // range; weekend days are dropped (no cell renders them).
  const byDay = React.useMemo(() => {
    const map = new Map<string, TimeOffRow[]>()
    const winStart = cells[0].date
    const winEnd = cells[cells.length - 1].date
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
  }, [parsed, cells])

  // Current Mon–Fri business week (based on the real today, independent of the
  // month being viewed). Drives the "This Week" strip; respects the same
  // hosts-only filter via `parsed`.
  const thisWeek = React.useMemo(() => {
    const monday = addDays(today, -((today.getDay() + 6) % 7))
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
    const winStart = days[0].date
    const winEnd = days[4].date
    let total = 0
    for (const { e, start, end } of parsed) {
      if (end < winStart || start > winEnd) continue
      let counted = false
      for (const dc of days) {
        if (start <= dc.date && dc.date <= end) {
          dc.items.push(e)
          counted = true
        }
      }
      if (counted) total++
    }
    days.forEach((dc) => sortDayEntries(dc.items))
    const fmt = (d: Date) => `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
    return { days, total, rangeLabel: `${fmt(monday)} – ${fmt(days[4].date)}` }
  }, [parsed, today])

  // Month-level summary: distinct entries overlapping the actual month, by type.
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
          subtitle="Approved time off across the team. Each pill marks a day someone is out — color-coded by type."
        />
      </div>

      {/* This Week — accented "right now" strip above the month calendar. Uses
          the real current Mon–Fri week and respects the hosts-only filter. */}
      <div className="mb-4 overflow-hidden rounded-[14px] border border-[#C9D3EC] bg-[#F5F8FD] shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_rgba(16,24,40,0.05)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#DCE3F3] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-4 w-1 rounded-full"
              style={{ background: ACCENT_STRIP }}
            />
            <span className="text-sm font-semibold" style={{ color: BRAND_NAVY }}>
              This Week
            </span>
            <span className="text-xs text-muted-foreground">{thisWeek.rangeLabel}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {thisWeek.total === 0
              ? "no one out"
              : `${thisWeek.total} out${hostsOnly ? " · hosts" : ""}`}
          </span>
        </div>

        {thisWeek.total === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No one is out this week{hostsOnly ? " (hosts)" : ""}.
          </div>
        ) : (
          <div className="grid grid-cols-5">
            {thisWeek.days.map((dc) => (
              <div
                key={dc.ymd}
                className={cn(
                  "border-r border-border/60 p-2 [&:nth-child(5n)]:border-r-0",
                  dc.isToday && "bg-[#E8EEFB]",
                )}
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span
                    className={cn(
                      "text-[11px] font-medium uppercase tracking-wide",
                      dc.isToday ? "text-[#1E2858]" : "text-muted-foreground",
                    )}
                  >
                    {dc.label}
                  </span>
                  {dc.isToday ? (
                    <span
                      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white"
                      style={{ backgroundColor: BRAND_NAVY }}
                    >
                      {dc.day}
                    </span>
                  ) : (
                    <span className="text-[11px] tabular-nums text-muted-foreground">{dc.day}</span>
                  )}
                </div>
                <div className="max-h-[160px] space-y-0.5 overflow-y-auto pr-0.5">
                  {dc.items.length === 0 ? (
                    <div className="px-1 py-0.5 text-[11px] text-muted-foreground/50">—</div>
                  ) : (
                    dc.items.map((e) => {
                      const remote = e.time_off_type === "Remote"
                      const s = remote ? REMOTE_STYLE : OOO_STYLE
                      return (
                        <div
                          key={e.ooo_id}
                          title={tooltipFor(e)}
                          className="truncate rounded px-1 py-[1px] text-[10px] font-medium leading-tight"
                          style={{
                            backgroundColor: s.fill,
                            color: s.text,
                            border: `${remote ? "1.5px" : "1px"} solid ${s.border}`,
                          }}
                        >
                          {shortName(e.person)}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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

      {/* Calendar */}
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

        {/* Day cells */}
        <div className="grid grid-cols-5">
          {cells.map((c) => {
            const items = byDay.get(c.ymd) ?? []
            return (
              <div
                key={c.ymd}
                className={cn(
                  "relative flex h-[224px] flex-col border-b border-r border-border/60 p-1.5 [&:nth-child(5n)]:border-r-0",
                  c.inMonth ? "bg-white" : "bg-[#F7F8FA]",
                )}
                style={c.isToday ? { backgroundColor: TODAY_TINT, boxShadow: `inset 0 0 0 2px ${BRAND_NAVY}` } : undefined}
              >
                {/* Date number (today gets a navy chip) */}
                <div
                  className={cn(
                    "mb-1 flex shrink-0 items-center justify-between text-[11px] tabular-nums",
                    c.inMonth ? "text-foreground" : "text-muted-foreground/40",
                  )}
                >
                  {/* "Today" tag on the left of the current day */}
                  {c.isToday ? (
                    <span
                      className="rounded px-1 text-[9px] font-semibold uppercase tracking-wide text-white"
                      style={{ backgroundColor: BRAND_NAVY }}
                    >
                      Today
                    </span>
                  ) : (
                    <span />
                  )}
                  {c.isToday ? (
                    <span
                      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-semibold text-white"
                      style={{ backgroundColor: BRAND_NAVY }}
                    >
                      {c.day}
                    </span>
                  ) : (
                    <span className="px-0.5">{c.day}</span>
                  )}
                </div>

                {/* Name pills — scrolls within the cell when a busy day has more
                    entries than fit (handles 10+ people out cleanly). */}
                <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
                  {items.map((e) => {
                    const remote = e.time_off_type === "Remote"
                    const s = remote ? REMOTE_STYLE : OOO_STYLE
                    return (
                      <div
                        key={e.ooo_id}
                        title={tooltipFor(e)}
                        className="truncate rounded px-1 py-[1px] text-[10px] font-medium leading-tight"
                        style={{
                          backgroundColor: s.fill,
                          color: s.text,
                          border: `${remote ? "1.5px" : "1px"} solid ${s.border}`,
                        }}
                      >
                        {shortName(e.person)}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Shows approved time off only, Monday–Friday (weekend days are not shown). A multi-day entry
        appears on each weekday in its range. Names are shortened to first name + last initial; hover
        any pill for the full name, type, and dates. OOO (filled green) covers vacation, personal,
        sick, and other non-remote time; Remote (outlined blue) is remote-work days. &ldquo;Hosts
        only&rdquo; limits the view to people who host meetings.
      </p>
    </>
  )
}

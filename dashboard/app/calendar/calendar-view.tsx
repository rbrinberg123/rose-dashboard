"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { ListTitleCard } from "@/components/page-masthead"
import { CARD_CLASS, BRAND_NAVY, BRAND_BLUE, TEXT_MUTED } from "@/lib/design"
import type { MarketingCalendarRow } from "@/lib/types"

// -----------------------------------------------------------------------------
// Layout constants
// -----------------------------------------------------------------------------
const LABEL_WIDTH = 200 // left ticker/company column
const GRID_WIDTH = 1020 // the day-axis area stays ~1020px wide (day width scales)
const LANE_HEIGHT = 30 // one client lane
const BAR_HEIGHT = 14 // event range bar
const MARK_SIZE = 11 // single-day event mark
const STRIP_BAR_MAX = 34 // tallest density bar (px)
const MS_PER_DAY = 86_400_000

// Accent for the "Clients marketing" density strip. Aligned to the app blue
// design token so the summary lane reads as part of the palette.
const DENSITY_ACCENT = BRAND_BLUE

// Event-state color palette (approved). Any unknown/future state falls back to a
// neutral gray so the lane still renders.
const STATE_COLORS: Record<string, string> = {
  "Pre-Launch": "#0E9AA7",
  "Live Outreach": "#0355A7",
  "Meetings Ongoing": "#0E7C56",
  "Schedule Closed": "#B7791F",
  "Preparing Feedback": "#6B3FA0",
  Complete: "#8A93A3",
}
const STATE_ORDER = [
  "Pre-Launch",
  "Live Outreach",
  "Meetings Ongoing",
  "Schedule Closed",
  "Preparing Feedback",
  "Complete",
]
const STATE_FALLBACK = "#B0B7C3"

function stateColor(label: string | null): string {
  if (!label) return STATE_FALLBACK
  return STATE_COLORS[label] ?? STATE_FALLBACK
}

type Zoom = 1 | 3 | 6

// -----------------------------------------------------------------------------
// Date helpers — everything is done in whole UTC day indices so arithmetic is
// integer and DST-proof.
// -----------------------------------------------------------------------------

/** Whole-day index (days since the Unix epoch) for a UTC calendar day. */
function dayIndex(year: number, month0: number, day: number): number {
  return Math.floor(Date.UTC(year, month0, day) / MS_PER_DAY)
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
}

/** Add `delta` calendar months to (year, month0), normalizing the overflow. */
function addMonths(year: number, month0: number, delta: number) {
  const total = year * 12 + month0 + delta
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 }
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

// -----------------------------------------------------------------------------
// event_dates parser — defensive. Splits the free-text "dates" string into
// concrete day marks / ranges, inferring the year from event_start_actual and
// rolling a token to next year when its month is before the event's start month.
// Never throws: unparseable tokens are skipped.
// -----------------------------------------------------------------------------
type Segment = { startIdx: number; endIdx: number; kind: "day" | "range" }

/** Year + 0-based month the event started (for year inference), or null. */
function startAnchor(startActual: string | null): { year: number; month0: number } | null {
  if (!startActual) return null
  const d = new Date(startActual)
  if (Number.isNaN(d.getTime())) return null
  // Use UTC parts — the stored value is an instant; we only need its calendar
  // month/year to anchor the yearless "dates" tokens.
  return { year: d.getUTCFullYear(), month0: d.getUTCMonth() }
}

/** Resolve a yearless month to a concrete year: same year as the event start,
 *  bumped to the next year when the month falls before the start month (so a
 *  "1/5" on an event that started in December lands next January). */
function resolveYear(month0: number, anchor: { year: number; month0: number }): number {
  return month0 < anchor.month0 ? anchor.year + 1 : anchor.year
}

function isValidMD(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

function parseEventDates(dates: string | null, startActual: string | null): Segment[] {
  if (!dates) return []
  const anchor = startAnchor(startActual) ?? {
    // No start date to anchor on — assume the current year and treat every month
    // as "not before start" so nothing rolls.
    year: new Date().getUTCFullYear(),
    month0: 0,
  }

  const out: Segment[] = []
  // Split on commas and ampersands; each piece is one token.
  const tokens = dates.split(/[,&]/)
  for (const raw of tokens) {
    // Strip parenthetical notes like "(Chicago TBC)" and trim.
    const token = raw.replace(/\([^)]*\)/g, "").trim()
    if (!token) continue

    try {
      // Range: "M/D-M/D" (spaces around the dash allowed).
      let m = token.match(/^(\d{1,2})\/(\d{1,2})\s*[-–]\s*(\d{1,2})\/(\d{1,2})$/)
      if (m) {
        const sMonth = Number(m[1]), sDay = Number(m[2])
        const eMonth = Number(m[3]), eDay = Number(m[4])
        if (!isValidMD(sMonth, sDay) || !isValidMD(eMonth, eDay)) continue
        const sIdx = dayIndex(resolveYear(sMonth - 1, anchor), sMonth - 1, sDay)
        let eYear = resolveYear(eMonth - 1, anchor)
        let eIdx = dayIndex(eYear, eMonth - 1, eDay)
        // Cross-year range whose end month didn't roll (e.g. "12/30-1/2" when the
        // event started mid-year): push the end into the following year.
        if (eIdx < sIdx) {
          eYear += 1
          eIdx = dayIndex(eYear, eMonth - 1, eDay)
        }
        if (eIdx < sIdx) continue
        out.push({ startIdx: sIdx, endIdx: eIdx, kind: eIdx > sIdx ? "range" : "day" })
        continue
      }

      // Range with a day-only right side: "M/D-D" (same month).
      m = token.match(/^(\d{1,2})\/(\d{1,2})\s*[-–]\s*(\d{1,2})$/)
      if (m) {
        const sMonth = Number(m[1]), sDay = Number(m[2]), eDay = Number(m[3])
        if (!isValidMD(sMonth, sDay) || !isValidMD(sMonth, eDay)) continue
        const year = resolveYear(sMonth - 1, anchor)
        const sIdx = dayIndex(year, sMonth - 1, sDay)
        const eIdx = dayIndex(year, sMonth - 1, eDay)
        if (eIdx < sIdx) continue
        out.push({ startIdx: sIdx, endIdx: eIdx, kind: eIdx > sIdx ? "range" : "day" })
        continue
      }

      // Single day: "M/D".
      m = token.match(/^(\d{1,2})\/(\d{1,2})$/)
      if (m) {
        const month = Number(m[1]), day = Number(m[2])
        if (!isValidMD(month, day)) continue
        const idx = dayIndex(resolveYear(month - 1, anchor), month - 1, day)
        out.push({ startIdx: idx, endIdx: idx, kind: "day" })
        continue
      }
      // Anything else: skip quietly.
    } catch {
      // Never let one bad token break the lane.
    }
  }
  return out
}

/** Day index from an ISO timestamp string (its UTC calendar day), or null. */
function isoDayIndex(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_PER_DAY)
}

/** Segments to plot for one event: the parsed free-text dates, else a single
 *  fallback bar spanning start_actual..end_actual. Empty when nothing is placeable. */
function eventSegments(row: MarketingCalendarRow): Segment[] {
  const parsed = parseEventDates(row.event_dates, row.event_start_actual)
  if (parsed.length > 0) return parsed

  const start = isoDayIndex(row.event_start_actual)
  if (start == null) return []
  const end = isoDayIndex(row.event_end_actual) ?? start
  const s = Math.min(start, end)
  const e = Math.max(start, end)
  return [{ startIdx: s, endIdx: e, kind: e > s ? "range" : "day" }]
}

// -----------------------------------------------------------------------------
// Grouping — one lane per client, grouped by ticker, sorted A→Z (nulls last).
// -----------------------------------------------------------------------------
type Group = {
  key: string
  ticker: string | null
  name: string | null
  rows: MarketingCalendarRow[]
}

function buildGroups(rows: MarketingCalendarRow[]): Group[] {
  const byKey = new Map<string, Group>()
  for (const r of rows) {
    const key =
      r.client_account_id ??
      (r.client_account_name ? `name:${r.client_account_name}` : `event:${r.event_id}`)
    let g = byKey.get(key)
    if (!g) {
      g = { key, ticker: r.ticker, name: r.client_account_name, rows: [] }
      byKey.set(key, g)
    }
    g.rows.push(r)
  }
  return Array.from(byKey.values()).sort((a, b) => {
    // A→Z by ticker, tickerless clients last, then by company name.
    if (a.ticker && b.ticker) {
      const t = a.ticker.localeCompare(b.ticker)
      if (t !== 0) return t
    } else if (a.ticker) return -1
    else if (b.ticker) return 1
    return (a.name ?? "").localeCompare(b.name ?? "")
  })
}

// -----------------------------------------------------------------------------
// View
// -----------------------------------------------------------------------------
export function CalendarView({ rows }: { rows: MarketingCalendarRow[] }) {
  const [zoom, setZoom] = React.useState<Zoom>(3)
  // Month offset from the current month; ‹ › move the window one month at a time.
  const [monthOffset, setMonthOffset] = React.useState(0)

  const groups = React.useMemo(() => buildGroups(rows), [rows])

  // Today's UTC-day index (browser-local calendar day).
  const todayIdx = React.useMemo(() => {
    const n = new Date()
    return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / MS_PER_DAY)
  }, [])

  // Window = `zoom` months, month-aligned, starting at (current month + offset).
  const win = React.useMemo(() => {
    const now = new Date()
    const start = addMonths(now.getFullYear(), now.getMonth(), monthOffset)
    const startIdx = dayIndex(start.year, start.month0, 1)
    const end = addMonths(start.year, start.month0, zoom)
    const endIdx = dayIndex(end.year, end.month0, 1)
    const totalDays = endIdx - startIdx
    const dayWidth = GRID_WIDTH / totalDays

    // Months spanned, with their pixel offsets (for the header + separators).
    const months: { year: number; month0: number; x: number; width: number }[] = []
    for (let i = 0; i < zoom; i++) {
      const mm = addMonths(start.year, start.month0, i)
      const dim = daysInMonth(mm.year, mm.month0)
      const x = (dayIndex(mm.year, mm.month0, 1) - startIdx) * dayWidth
      months.push({ year: mm.year, month0: mm.month0, x, width: dim * dayWidth })
    }
    return { startIdx, endIdx, dayWidth, months }
  }, [zoom, monthOffset])

  // Day-number ruler stride: every day when columns are wide, thinning as they
  // shrink; 0 = no day numbers (6M), leaving the month header as the only labels.
  const dayStride =
    win.dayWidth >= 22 ? 1 : win.dayWidth >= 14 ? 2 : win.dayWidth >= 8 ? 5 : 0

  const windowLabel = React.useMemo(() => {
    const first = win.months[0]
    const last = win.months[win.months.length - 1]
    const l = `${MONTH_NAMES[first.month0]} ${first.year}`
    const r = `${MONTH_NAMES[last.month0]} ${last.year}`
    return first === last ? l : `${l} – ${r}`
  }, [win])

  const todayX =
    todayIdx >= win.startIdx && todayIdx < win.endIdx
      ? (todayIdx - win.startIdx) * win.dayWidth
      : null

  // Per-day distinct-client density for the CURRENT window. Recomputed whenever
  // the window (zoom / scroll) or the data changes, using the exact same resolved
  // segments the grid draws (parsed event_dates, else the start→end fallback). A
  // client is counted at most once per day via a per-day Set of client keys.
  const density = React.useMemo(() => {
    const totalDays = win.endIdx - win.startIdx
    const daySets: Set<string>[] = Array.from({ length: totalDays }, () => new Set())
    for (const g of groups) {
      for (const row of g.rows) {
        for (const seg of eventSegments(row)) {
          const from = Math.max(seg.startIdx, win.startIdx)
          const to = Math.min(seg.endIdx, win.endIdx - 1)
          for (let d = from; d <= to; d++) daySets[d - win.startIdx].add(g.key)
        }
      }
    }
    const counts = daySets.map((s) => s.size)
    const max = counts.reduce((m, c) => (c > m ? c : m), 0)
    return { counts, max }
  }, [groups, win])

  return (
    <>
      {/* Floating list-title card (matches the Scheduler masthead usage/spacing). */}
      <div className="mb-4">
        <ListTitleCard
          title="Calendar"
          subtitle="When clients are marketing and planning NDRs — the next several months at a glance."
        />
      </div>

      <div className="flex flex-col gap-3">
        {/* Toolbar: legend + window controls (the page title lives in the masthead
            above). */}
      <div className={cn(CARD_CLASS, "flex flex-wrap items-center justify-between gap-3 px-4 py-3")}>
        {/* Event-state key */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {STATE_ORDER.map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-xs" style={{ color: TEXT_MUTED }}>
              <span
                aria-hidden
                className="inline-block size-3 rounded-[3px]"
                style={{ background: STATE_COLORS[s] }}
              />
              {s}
            </span>
          ))}
        </div>

        {/* Window + zoom controls */}
        <div className="flex items-center gap-2">
          <span className="min-w-[9rem] text-right text-xs font-medium" style={{ color: BRAND_NAVY }}>
            {windowLabel}
          </span>
          <div className="flex items-center rounded-md border border-[#E6E9EF] bg-white">
            <button
              type="button"
              aria-label="Previous"
              onClick={() => setMonthOffset((o) => o - 1)}
              className="flex size-7 items-center justify-center text-[#5B6472] hover:text-[#1E2858]"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setMonthOffset(0)}
              className="border-x border-[#E6E9EF] px-2 text-xs text-[#5B6472] hover:text-[#1E2858]"
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={() => setMonthOffset((o) => o + 1)}
              className="flex size-7 items-center justify-center text-[#5B6472] hover:text-[#1E2858]"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="flex items-center rounded-md border border-[#E6E9EF] bg-white p-0.5">
            {([1, 3, 6] as Zoom[]).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoom(z)}
                aria-pressed={zoom === z}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  zoom === z
                    ? "bg-[#EEF2FB] text-[#1E2858]"
                    : "text-[#5B6472] hover:text-[#1E2858]",
                )}
              >
                {z}M
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The Gantt grid */}
      <div className={cn(CARD_CLASS, "overflow-x-auto")}>
        <div style={{ width: LABEL_WIDTH + GRID_WIDTH }}>
          {/* Axis header (sticky) */}
          <div
            className="sticky top-0 z-10 flex border-b border-[#EDEFF3] bg-white"
            style={{ height: dayStride ? 46 : 30 }}
          >
            <div
              className="shrink-0 border-r border-[#EDEFF3]"
              style={{ width: LABEL_WIDTH }}
            />
            <div className="relative" style={{ width: GRID_WIDTH }}>
              {/* Month bands */}
              {win.months.map((m, i) => (
                <div
                  key={`${m.year}-${m.month0}`}
                  className="absolute top-0 flex h-6 items-center overflow-hidden px-1.5 text-[11px] font-medium"
                  style={{
                    left: m.x,
                    width: m.width,
                    color: BRAND_NAVY,
                    borderLeft: i > 0 ? "1px solid #EDEFF3" : undefined,
                  }}
                >
                  {MONTH_NAMES[m.month0]}
                  {win.dayWidth * daysInMonth(m.year, m.month0) > 70 ? ` ${m.year}` : ""}
                </div>
              ))}
              {/* Day-number ruler */}
              {dayStride > 0 &&
                win.months.map((m) => {
                  const dim = daysInMonth(m.year, m.month0)
                  const ticks: React.ReactNode[] = []
                  for (let d = 1; d <= dim; d += dayStride) {
                    const x =
                      (dayIndex(m.year, m.month0, d) - win.startIdx) * win.dayWidth
                    ticks.push(
                      <div
                        key={`${m.year}-${m.month0}-${d}`}
                        className="absolute top-6 text-center text-[9px] tabular-nums"
                        style={{
                          left: x,
                          width: win.dayWidth * dayStride,
                          color: TEXT_MUTED,
                        }}
                      >
                        {d}
                      </div>,
                    )
                  }
                  return ticks
                })}
            </div>
          </div>

          {/* "Clients marketing" density strip — distinct clients per day in the
              current window, aligned to the same day axis and label column. */}
          <div className="flex border-b border-[#EDEFF3] bg-white">
            <div
              className="flex shrink-0 flex-col justify-center border-r border-[#EDEFF3] px-3"
              style={{ width: LABEL_WIDTH }}
            >
              <span className="text-xs font-medium" style={{ color: BRAND_NAVY }}>
                Clients marketing
              </span>
              <span className="text-[11px]" style={{ color: TEXT_MUTED }}>
                · peak {density.max}
              </span>
            </div>
            <div
              className="relative"
              style={{ width: GRID_WIDTH, height: STRIP_BAR_MAX + (dayStride > 0 ? 18 : 8) }}
            >
              {density.max > 0 &&
                density.counts.map((count, d) => {
                  if (count <= 0) return null
                  const intensity = count / density.max
                  const barH = Math.max(2, intensity * STRIP_BAR_MAX)
                  const gap = Math.min(2, win.dayWidth * 0.25)
                  const left = d * win.dayWidth
                  const width = Math.max(1, win.dayWidth - gap)
                  const label = `${count} client${count === 1 ? "" : "s"} marketing`
                  return (
                    <React.Fragment key={d}>
                      {dayStride > 0 && (
                        <div
                          className="absolute text-center text-[9px] tabular-nums"
                          style={{
                            left,
                            width: win.dayWidth,
                            bottom: barH + 2,
                            color: TEXT_MUTED,
                          }}
                        >
                          {count}
                        </div>
                      )}
                      <div
                        title={label}
                        className="absolute bottom-0 rounded-t-[2px]"
                        style={{
                          left: left + gap / 2,
                          width,
                          height: barH,
                          background: DENSITY_ACCENT,
                          opacity: 0.4 + 0.6 * intensity,
                        }}
                      />
                    </React.Fragment>
                  )
                })}
            </div>
          </div>

          {/* Lanes */}
          <div className="relative">
            {/* Month separators spanning all lanes */}
            <div
              className="pointer-events-none absolute inset-y-0"
              style={{ left: LABEL_WIDTH, width: GRID_WIDTH }}
            >
              {win.months.map((m, i) =>
                i === 0 ? null : (
                  <div
                    key={`sep-${m.year}-${m.month0}`}
                    className="absolute inset-y-0 w-px bg-[#F0F2F6]"
                    style={{ left: m.x }}
                  />
                ),
              )}
              {/* Today line */}
              {todayX != null && (
                <div
                  className="absolute inset-y-0 w-px"
                  style={{ left: todayX, background: "#DC2626" }}
                />
              )}
            </div>

            {groups.length === 0 ? (
              <div className="px-4 py-16 text-center text-sm" style={{ color: TEXT_MUTED }}>
                No events in this window.
              </div>
            ) : (
              groups.map((g, gi) => (
                <div
                  key={g.key}
                  className={cn("flex", gi % 2 === 1 && "bg-[#FAFBFD]")}
                  style={{ height: LANE_HEIGHT }}
                >
                  {/* Label */}
                  <div
                    className="flex shrink-0 items-center gap-2 overflow-hidden border-r border-[#EDEFF3] px-3"
                    style={{ width: LABEL_WIDTH }}
                  >
                    {g.ticker ? (
                      <span
                        className="shrink-0 text-xs font-bold"
                        style={{ color: BRAND_NAVY }}
                      >
                        {g.ticker}
                      </span>
                    ) : null}
                    <span
                      className="truncate text-xs"
                      style={{ color: TEXT_MUTED }}
                      title={g.name ?? undefined}
                    >
                      {g.name ?? "—"}
                    </span>
                  </div>
                  {/* Track */}
                  <div className="relative" style={{ width: GRID_WIDTH }}>
                    {g.rows.map((row) =>
                      eventSegments(row).map((seg, si) => (
                        <Bar
                          key={`${row.event_id}-${si}`}
                          seg={seg}
                          row={row}
                          startIdx={win.startIdx}
                          endIdx={win.endIdx}
                          dayWidth={win.dayWidth}
                        />
                      )),
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      </div>
    </>
  )
}

// One event mark/bar, clipped to the visible window. Returns null when it falls
// entirely outside the window.
function Bar({
  seg,
  row,
  startIdx,
  endIdx,
  dayWidth,
}: {
  seg: Segment
  row: MarketingCalendarRow
  startIdx: number
  endIdx: number
  dayWidth: number
}) {
  const color = stateColor(row.event_state_label)
  const tip = `${row.event_name}${row.event_dates ? ` · ${row.event_dates}` : ""}${
    row.event_state_label ? ` · ${row.event_state_label}` : ""
  }`

  if (seg.kind === "day") {
    // Center a small mark on the day; skip if outside the window.
    if (seg.startIdx < startIdx || seg.startIdx >= endIdx) return null
    const center = (seg.startIdx + 0.5 - startIdx) * dayWidth
    return (
      <div
        title={tip}
        className="absolute top-1/2 rounded-[3px]"
        style={{
          left: center - MARK_SIZE / 2,
          width: MARK_SIZE,
          height: MARK_SIZE,
          transform: "translateY(-50%)",
          background: color,
        }}
      />
    )
  }

  // Range: inclusive of both ends → +1 day of width. Clip to the window.
  const rawLeft = (seg.startIdx - startIdx) * dayWidth
  const left = Math.max(0, rawLeft)
  const right = Math.min(endIdx - startIdx, seg.endIdx + 1 - startIdx) * dayWidth
  const width = right - left
  if (width <= 0) return null

  return (
    <div
      title={tip}
      className="absolute top-1/2 overflow-hidden rounded-[4px] px-1.5 text-[10px] font-medium leading-none text-white"
      style={{
        left,
        width,
        height: BAR_HEIGHT,
        transform: "translateY(-50%)",
        background: color,
        display: "flex",
        alignItems: "center",
      }}
    >
      {width > 44 ? <span className="truncate">{row.event_name}</span> : null}
    </div>
  )
}

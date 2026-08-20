"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { ListTitleCard } from "@/components/page-masthead"
import { CARD_CLASS, BRAND_NAVY, BRAND_BLUE, TEXT_MUTED } from "@/lib/design"
import type { MarketingCalendarRow } from "@/lib/types"

// -----------------------------------------------------------------------------
// Layout constants
// -----------------------------------------------------------------------------
const LABEL_WIDTH = 200 // left ticker/company column
const GRID_WIDTH = 1020 // fallback day-axis width before the container is measured
// Minimum per-day width (px), roughly the old fixed 6M day width (1020 / ~184
// days). Floors the responsive day width so a very narrow container falls back
// to horizontal scroll instead of squashing bars to nothing.
const MIN_DAY_WIDTH = 5.5
const LANE_HEIGHT = 30 // one client lane
// (The old multi-day range bar is gone: ranges are expanded into individual day
// boxes so both date sets are plain sets of days.)
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
// BOX SOURCE + STYLE BY STAGE
// -----------------------------------------------------------------------------
// Two date sets per event:
//   CONFIRMED — real meeting records (public.meetings, status Confirmed), keyed
//               by event_id and passed in from the server.
//   TITLE     — dates scraped out of the free-text event name.
//
// Which set is drawn, and how, depends on the event's workflow stage
// (`event_state_label`). Anything not in this map falls back to confirmed-only,
// which is the safe default: it can only ever show dates that really exist as
// meetings, never a hand-typed guess.
type BoxMode = "title" | "both" | "confirmed"

const STAGE_BOX_MODE: Record<string, BoxMode> = {
  // Nothing is booked yet, so the typed dates are all there is to show — drawn
  // hatched to read as "planned, not booked".
  "Pre-Launch": "title",
  // Mid-flight: solid for what is booked, hatch for typed dates still open.
  "Live Outreach": "both",
  // Past the booking window — the typed list is stale, so only real meetings.
  "Schedule Closed": "confirmed",
  "Preparing Feedback": "confirmed",
  Complete: "confirmed",
}
/** Stages with no explicit rule (today: "Meetings Ongoing") land here. */
const DEFAULT_BOX_MODE: BoxMode = "confirmed"

function boxMode(stage: string | null): BoxMode {
  if (!stage) return DEFAULT_BOX_MODE
  return STAGE_BOX_MODE[stage] ?? DEFAULT_BOX_MODE
}

// Diagonal cross-hatch for unbooked (title-only) dates. Same recipe as Planning
// V2's VIRTUAL_HATCH; duplicated rather than imported to keep this change inside
// /calendar, and paired with a visible outline so a hatched box still reads as a
// box on the pale lane background.
/**
 * Diagonal hatch for an availability box, TINTED TO THE EVENT'S STAGE.
 *
 * Hue always carries stage; fill carries confirmed-vs-availability. So the hatch
 * cannot be a fixed grey — it takes the same stage colour the solid box uses, at
 * ~35% alpha, with transparent gaps so the box still reads as unfilled. The 45°
 * geometry is the Planning V2 virtual-row treatment; the stripe period is tighter
 * (3px on / 3px off vs 5/10) because these boxes are only MARK_SIZE across and
 * the wider period showed barely one band.
 *
 * Every STATE_COLORS value and STATE_FALLBACK is a 6-digit hex, so the 8-digit
 * `#RRGGBBAA` form below is always valid.
 */
function hatchFill(color: string): string {
  return `repeating-linear-gradient(45deg, ${color}59 0, ${color}59 3px, transparent 3px, transparent 6px)`
}

// -----------------------------------------------------------------------------
// Title-date parser — defensive. Scrapes M/D, M/D/YY(YY) and M/D-M/D ranges out
// of the free-text event name, expanding ranges into their individual days so
// both date sets are plain sets of days. Never throws: a token that does not
// parse, or that names an impossible day, is skipped and the rest still render.
// -----------------------------------------------------------------------------
/** event_id → the ISO dates of that event's CONFIRMED meetings, loaded server-side. */
export type ConfirmedByEvent = Record<string, string[]>

/** Day index from an ISO timestamp string (its UTC calendar day), or null. */
function isoDayIndex(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_PER_DAY)
}

function isValidMD(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

/**
 * YEAR INFERENCE. The typed dates carry no year, so one is inferred from the
 * event's own context, in this order:
 *   1. the event EARLIEST confirmed meeting  (real data - the strongest signal)
 *   2. else event_start_actual                (the event own window)
 *   3. else the current year                  (last resort)
 *
 * The anchor only fixes a point in time; each token then picks whichever of
 * anchor-1 / anchor / anchor+1 lands it NEAREST that anchor. Nearest-year is
 * what makes both directions work: a "6/29" on an event whose first confirmed
 * meeting is 7/13 stays in the same year (a naive "month before the anchor
 * rolls forward" rule pushed it a year out), while a "1/2" on a December event
 * still rolls correctly into January.
 */
type YearAnchor = { year: number; month0: number }

function yearAnchor(row: MarketingCalendarRow, confirmedDays: number[]): YearAnchor {
  if (confirmedDays.length > 0) {
    const earliest = new Date(Math.min(...confirmedDays) * MS_PER_DAY)
    return { year: earliest.getUTCFullYear(), month0: earliest.getUTCMonth() }
  }
  const start = row.event_start_actual ? new Date(row.event_start_actual) : null
  if (start && !Number.isNaN(start.getTime())) {
    return { year: start.getUTCFullYear(), month0: start.getUTCMonth() }
  }
  const now = new Date()
  return { year: now.getUTCFullYear(), month0: now.getUTCMonth() }
}

/** The year, of the three candidates around the anchor, that lands month/day
 *  closest to it. */
function nearestYear(month0: number, day: number, anchor: YearAnchor): number {
  const anchorMs = Date.UTC(anchor.year, anchor.month0, 15)
  let best = anchor.year
  let bestDist = Number.POSITIVE_INFINITY
  for (const y of [anchor.year - 1, anchor.year, anchor.year + 1]) {
    const dist = Math.abs(Date.UTC(y, month0, day) - anchorMs)
    if (dist < bestDist) {
      bestDist = dist
      best = y
    }
  }
  return best
}

/** Day index for a month/day/year, or null when the calendar rejects it (e.g.
 *  "2/30", which would otherwise silently roll into March). */
function safeDayIndex(year: number, month0: number, day: number): number | null {
  const d = new Date(Date.UTC(year, month0, day))
  if (d.getUTCMonth() !== month0 || d.getUTCDate() !== day) return null
  return Math.floor(d.getTime() / MS_PER_DAY)
}

/**
 * One global scan over the event NAME. Each match is a date, optionally with an
 * explicit year, optionally followed by a range end:
 *
 *   6/23        single
 *   6/23/26     single, explicit 2-digit year
 *   6/23/2026   single, explicit 4-digit year
 *   6/29-7/1    range across months
 *   6/29-30     range within the month
 *
 * Scanning (rather than splitting on commas and anchoring each token) is what
 * lets this run against the whole title, which carries a prefix like
 * "4DX-AU -  Virtual - " before the list. Nothing else in a title matches the
 * shape: tickers and city names carry no slashed number pair.
 */
const TITLE_DATE_RE =
  /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*[-\u2013]\s*(?:(\d{1,2})\/)?(\d{1,2})(?:\/(\d{2,4}))?)?/g

function explicitYear(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return raw.length <= 2 ? 2000 + n : n
}

/**
 * Title dates as day indices. Ranges are expanded into their individual days so
 * the result is a plain SET of days, directly comparable with the confirmed set.
 * Never throws - a malformed or impossible token is skipped and the remaining
 * tokens still render.
 */
function parseTitleDays(title: string | null, anchor: YearAnchor): number[] {
  if (!title) return []
  const out = new Set<number>()
  try {
    for (const m of String(title).matchAll(TITLE_DATE_RE)) {
      const sMonth = Number(m[1])
      const sDay = Number(m[2])
      if (!isValidMD(sMonth, sDay)) continue
      const sYear = explicitYear(m[3], nearestYear(sMonth - 1, sDay, anchor))
      const sIdx = safeDayIndex(sYear, sMonth - 1, sDay)
      if (sIdx == null) continue

      // No range end: a single day.
      if (m[5] == null) {
        out.add(sIdx)
        continue
      }
      // Range end. A bare right side ("6/29-30") repeats the start month.
      const eMonth = m[4] != null ? Number(m[4]) : sMonth
      const eDay = Number(m[5])
      if (!isValidMD(eMonth, eDay)) {
        out.add(sIdx)
        continue
      }
      let eYear = explicitYear(m[6], nearestYear(eMonth - 1, eDay, anchor))
      let eIdx = safeDayIndex(eYear, eMonth - 1, eDay)
      // A range that ends before it starts is a year wrap ("12/30-1/2").
      if (eIdx != null && eIdx < sIdx) {
        eYear += 1
        eIdx = safeDayIndex(eYear, eMonth - 1, eDay)
      }
      if (eIdx == null || eIdx < sIdx) {
        out.add(sIdx)
        continue
      }
      for (let d = sIdx; d <= eIdx; d++) out.add(d)
    }
  } catch {
    // Never let one bad title blank a lane - keep whatever parsed.
  }
  return [...out]
}

/** Confirmed-meeting days for one event, as day indices. */
function confirmedDaysFor(eventId: string, confirmedByEvent: ConfirmedByEvent): number[] {
  const iso = confirmedByEvent[eventId]
  if (!iso || iso.length === 0) return []
  const out = new Set<number>()
  for (const s of iso) {
    const idx = isoDayIndex(s)
    if (idx != null) out.add(idx)
  }
  return [...out]
}

/** A single day to draw, and how. */
type Box = { dayIdx: number; style: "solid" | "hatch" }

/**
 * The boxes for one event, per its stage (see STAGE_BOX_MODE). Confirmed always
 * wins over a title date for the same day, so a day never draws twice.
 *
 * NB there is deliberately no fallback to event_start_actual..event_end_actual
 * any more: at a confirmed-only stage the whole point is that only real meetings
 * show, and inventing a bar from the event window would defeat that. An event
 * with nothing to draw renders an empty lane.
 */
function eventBoxes(row: MarketingCalendarRow, confirmedByEvent: ConfirmedByEvent): Box[] {
  const confirmed = confirmedDaysFor(row.event_id, confirmedByEvent)
  const mode = boxMode(row.event_state_label)
  if (mode === "confirmed") {
    return confirmed.map((dayIdx) => ({ dayIdx, style: "solid" as const }))
  }

  const anchor = yearAnchor(row, confirmed)
  const title = parseTitleDays(row.event_name, anchor)
  if (mode === "title") {
    return title.map((dayIdx) => ({ dayIdx, style: "hatch" as const }))
  }

  // "both": solid for booked days, hatch for typed days with nothing booked.
  const confirmedSet = new Set(confirmed)
  return [
    ...confirmed.map((dayIdx) => ({ dayIdx, style: "solid" as const })),
    ...title
      .filter((d) => !confirmedSet.has(d))
      .map((dayIdx) => ({ dayIdx, style: "hatch" as const })),
  ]
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
export function CalendarView({
  rows,
  confirmedByEvent,
}: {
  rows: MarketingCalendarRow[]
  confirmedByEvent: ConfirmedByEvent
}) {
  const [zoom, setZoom] = React.useState<Zoom>(3)
  // Month offset from the current month; ‹ › move the window one month at a time.
  const [monthOffset, setMonthOffset] = React.useState(0)

  // Live pixel width of the scrolling grid container. Seeded with the old fixed
  // width so the very first paint matches previous behavior; a ResizeObserver
  // then keeps it in sync with the real container (mount, window resize, sidebar
  // collapse). The observer's initial callback covers the mount measurement, so
  // we never call setState synchronously in the effect body.
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = React.useState(LABEL_WIDTH + GRID_WIDTH)
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setContainerWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
    // Timeline lane fills the measured container: available width = container
    // minus the fixed label column, split evenly across the days in the window.
    // Floored at MIN_DAY_WIDTH so a too-narrow container scrolls instead of
    // squashing. gridWidth is derived from the (possibly floored) day width so
    // everything downstream (xOf, separators, bars, today line) stays aligned.
    const available = Math.max(0, containerWidth - LABEL_WIDTH)
    const dayWidth = Math.max(MIN_DAY_WIDTH, available / totalDays)
    const gridWidth = Math.round(totalDays * dayWidth)

    // Months spanned, with their pixel offsets (for the header + separators).
    const months: { year: number; month0: number; x: number; width: number }[] = []
    for (let i = 0; i < zoom; i++) {
      const mm = addMonths(start.year, start.month0, i)
      const dim = daysInMonth(mm.year, mm.month0)
      const x = (dayIndex(mm.year, mm.month0, 1) - startIdx) * dayWidth
      months.push({ year: mm.year, month0: mm.month0, x, width: dim * dayWidth })
    }
    return { startIdx, endIdx, dayWidth, gridWidth, months }
  }, [zoom, monthOffset, containerWidth])

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
  // the window (zoom / scroll) or the data changes, from the exact same boxes the
  // grid draws — so the heat strip counts a day only when that day actually shows
  // a box, hatched or solid. A client is counted at most once per day.
  const density = React.useMemo(() => {
    const totalDays = win.endIdx - win.startIdx
    const daySets: Set<string>[] = Array.from({ length: totalDays }, () => new Set())
    for (const g of groups) {
      for (const row of g.rows) {
        for (const box of eventBoxes(row, confirmedByEvent)) {
          if (box.dayIdx < win.startIdx || box.dayIdx >= win.endIdx) continue
          daySets[box.dayIdx - win.startIdx].add(g.key)
        }
      }
    }
    const counts = daySets.map((s) => s.size)
    const max = counts.reduce((m, c) => (c > m ? c : m), 0)
    return { counts, max }
  }, [groups, win, confirmedByEvent])

  return (
    <>
      {/* Floating list-title card (matches the Scheduler masthead usage/spacing). */}
      <div className="mb-4">
        <ListTitleCard
          title="NDRS Calendar"
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
          {/* Fill key, boxed off from the stage swatches to its left — the two
              keys answer different questions (hue = stage, fill = booked or
              not), so the border stops them reading as one continuous list.
              Two sample boxes in a neutral grey, deliberately NOT a stage
              colour, since this key is about FILL, not hue. Same 45° hatch and
              1px outline the availability boxes use. */}
          <span className="flex items-center gap-x-3 gap-y-1 rounded-md border border-[#E6E9EF] px-2 py-1">
            <span className="flex items-center gap-1.5 text-xs" style={{ color: TEXT_MUTED }}>
              <span
                aria-hidden
                className="inline-block size-3 rounded-[3px]"
                style={{ background: TEXT_MUTED }}
              />
              Confirmed
            </span>
            <span className="flex items-center gap-1.5 text-xs" style={{ color: TEXT_MUTED }}>
              <span
                aria-hidden
                className="inline-block size-3 rounded-[3px]"
                style={{ backgroundImage: hatchFill(TEXT_MUTED), border: `1px solid ${TEXT_MUTED}` }}
              />
              Availability
            </span>
          </span>
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

      {/* What the two fills mean. Stated once, quietly — the swatches above show
          the difference but not what it signifies. */}
      <p
        className="-mt-1 flex items-center gap-1.5 text-[11px] italic"
        style={{ color: TEXT_MUTED }}
      >
        <Info className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Solid = confirmed meeting · Outlined = availability. Box color reflects
          the event&apos;s stage.
        </span>
      </p>

      {/* The Gantt grid */}
      <div ref={scrollRef} className={cn(CARD_CLASS, "overflow-x-auto")}>
        <div style={{ width: LABEL_WIDTH + win.gridWidth }}>
          {/* Axis header (sticky) */}
          <div
            className="sticky top-0 z-10 flex border-b border-[#EDEFF3] bg-white"
            style={{ height: dayStride ? 46 : 30 }}
          >
            <div
              className="shrink-0 border-r border-[#EDEFF3]"
              style={{ width: LABEL_WIDTH }}
            />
            <div className="relative" style={{ width: win.gridWidth }}>
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
              style={{ width: win.gridWidth, height: STRIP_BAR_MAX + (dayStride > 0 ? 18 : 8) }}
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
              style={{ left: LABEL_WIDTH, width: win.gridWidth }}
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
                  <div className="relative" style={{ width: win.gridWidth }}>
                    {g.rows.map((row) =>
                      eventBoxes(row, confirmedByEvent).map((box) => (
                        <DayBox
                          key={`${row.event_id}-${box.dayIdx}-${box.style}`}
                          box={box}
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

// One DAY box, clipped to the visible window. Returns null when the day falls
// outside it.
//
// SOLID  = a confirmed meeting on that day (the existing filled mark, coloured
//          by the event stage, unchanged).
// HATCH  = a date typed into the event title with nothing booked on it: the
//          same diagonal cross-hatch Planning V2 uses for virtual rows, plus a
//          stage-coloured outline so it still reads as this event box.
function DayBox({
  box,
  row,
  startIdx,
  endIdx,
  dayWidth,
}: {
  box: Box
  row: MarketingCalendarRow
  startIdx: number
  endIdx: number
  dayWidth: number
}) {
  if (box.dayIdx < startIdx || box.dayIdx >= endIdx) return null

  const color = stateColor(row.event_state_label)
  const kindLabel = box.style === "solid" ? "confirmed meeting" : "planned (no meeting booked)"
  const tip = `${row.event_name}${row.event_state_label ? ` · ${row.event_state_label}` : ""} · ${kindLabel}`

  const center = (box.dayIdx + 0.5 - startIdx) * dayWidth
  const common = {
    left: center - MARK_SIZE / 2,
    width: MARK_SIZE,
    height: MARK_SIZE,
    transform: "translateY(-50%)",
  } as const

  if (box.style === "solid") {
    return (
      <div
        title={tip}
        className="absolute top-1/2 rounded-[3px]"
        style={{ ...common, background: color }}
      />
    )
  }

  // Availability: outlined + hatched in the SAME stage colour as the solid box —
  // only the fill differs, never the hue.
  return (
    <div
      title={tip}
      className="absolute top-1/2 rounded-[3px]"
      style={{
        ...common,
        backgroundImage: hatchFill(color),
        border: `1px solid ${color}`,
      }}
    />
  )
}

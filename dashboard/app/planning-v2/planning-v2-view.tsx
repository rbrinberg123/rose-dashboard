"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Check, FileText, CalendarCheck, UserRound, Clock, ChevronDown, ChevronLeft, ChevronRight, Send, CheckCheck, Utensils, Car, StickyNote, Video, MapPin } from "lucide-react"
import { ListTitleCard } from "@/components/page-masthead"
import { SegmentedToggle } from "@/components/segmented-toggle"
import {
  BRAND_BLUE,
  BRAND_NAVY,
  CARD_CLASS,
  DAYS_LEFT_PILL,
  DEEP_TEAL,
  GROUP_RULE_HEIGHT,
  TEXT_SECONDARY,
} from "@/lib/design"
import type { PlanningEventRow } from "@/lib/types"

// ⚗️ EXPERIMENTAL SANDBOX COPY of app/planning/planning-view.tsx.
// The real Planning page (app/planning) is untouched and shares the same
// v_planning_events view. Modify this file freely; delete the whole
// app/planning-v2 folder + the "Planning Lab" nav entry to remove it.

const NAVY_DEEP = "#1E2858"
/**
 * THE teal for this page. Every teal-family accent derives from this one
 * constant so they cannot drift apart — a deep blue-teal, darker than both the
 * shared TEAL and TEAL_LIGHT tokens (TEAL_LIGHT is the Logistics account-team
 * avatar fill, so it could not simply be darkened in place). It now lives in
 * lib/design.ts as DEEP_TEAL, shared with the Portfolio group-header sweep so
 * the two big tables end on the identical teal.
 *
 * Drives, in this file:
 *   - the completed-step check circles (StageCell + BoolCell)
 *   - the green left border on a fully-ready row
 *   - pctColor, hence the completion ring and its "X / Y steps complete" readout
 *   - the "Live Meetings Only" band rule + its count-pill tint
 *   - the Now divider
 *   - the two filter checkbox accents
 *
 * Still deliberately NOT MONEY_GREEN (#0E7C56), which is reserved for money.
 */
const EMPTY_RING = "#D1D6DE"

// Hairline divider between the meeting-info columns and the four tracking columns.
const COL_DIVIDER = "#E6E9EF"
// Fainter hairline between individual stage columns (Calendars|Profiles|Hosts).
const STAGE_DIVIDER = "#EEF1F6"
// Top-tier grouping bands over the stage block ("All Meetings") and the logistics
// block ("Live Meetings Only").
//
// Both bands are UNFILLED — navy small-caps over the header strip — and are told
// apart by a thin gradient rule underneath rather than by a background colour.
// The previous treatment filled them (stone grey / soft green), and the green one
// sat in the same row as the pale green completion pills, so a category band and
// a "done" status read as the same kind of object. Removing the fills makes the
// group heading recede and the per-column pills the only coloured thing in the
// header, which is where the eye should go.
//
// The rules carry the blue = ALL / teal = LIVE signal. Both are composed from the
// brand tokens rather than written as hex, so a palette shift flows through.
const ALL_BAND_RULE = `linear-gradient(90deg, ${BRAND_NAVY}, ${BRAND_BLUE})`
const LIVE_BAND_RULE = `linear-gradient(90deg, ${BRAND_BLUE}, ${DEEP_TEAL})`
// Faint matching tints behind each band's group-count pill. Percentages differ
// because the two stops differ in weight; DEEP_TEAL is dark, so a smaller share
// lands at the same visual lightness the pale TEAL_LIGHT needed 22% to reach.
const ALL_BAND_TINT = `color-mix(in srgb, ${BRAND_BLUE} 10%, white)`
const LIVE_BAND_TINT = `color-mix(in srgb, ${DEEP_TEAL} 14%, white)`
// self-START, so the band and its rule stay pinned to the very top of the header
// even if row 1 grows (a spanning base label can push height into it).
const SECTION_BAND_CLASS =
  "flex flex-col items-center gap-1 self-start px-3 text-[10px] font-semibold uppercase tracking-wider"

// Virtual meetings don't use the 5 logistics fields, so their whole logistics
// block renders as ONE continuous grayed-out band (a subtle diagonal hatch) with
// no content and no internal dividers — see MeetingRow. Signals "not applicable"
// for the group at a glance. Kept light — a pale gray hatch over near-white — so it
// reads as a soft "off" band, not a heavy block.
const VIRTUAL_HATCH =
  "repeating-linear-gradient(45deg, #EBEEF3 0, #EBEEF3 5px, #F7F8FA 5px, #F7F8FA 10px)"

// Strip a ticker's exchange/country suffix for display (e.g. "SGO:FP" -> "SGO",
// "RIO-L" -> "RIO"); dotted class tickers like "BRK.B" are preserved. Same logic
// as the Feedback / Live Outreach email helpers of the same name.
function baseTicker(t: string): string {
  return t.trim().split(/[\s:]/)[0].replace(/-[A-Za-z]{1,4}$/, "")
}

const ALL = "__all__" // account-manager filter sentinel for "All"
// Small uppercase muted control label — matches the Profiles page filter labels.
const FILTER_LABEL = "text-[11px] font-medium uppercase tracking-wide text-[#9AA1AD]"

// A meeting has OCCURRED once the current time is >= 1 hour past its start. We
// seed from the server's is_past flag (whole-day, hydration-safe) and refine on
// the client with the real start time (`now` ticks every 60s post-mount), so a
// same-day meeting flips to "occurred" an hour after it starts without a reload.
// Times are treated as UTC instants, matching the app-wide wall-clock convention.
const OCCURRED_GRACE_MS = 60 * 60 * 1000
function isOccurred(row: PlanningEventRow, now: number | null): boolean {
  if (row.is_past) return true
  if (now == null) return false
  return now >= Date.parse(row.meeting_date) + OCCURRED_GRACE_MS
}

// ---- the three planning stages --------------------------------------------
// Each stage knows its header color/icon and how to decide a meeting's check
// from the raw value. Order here is the column order: Calendars, Profiles,
// Hosts.
type Stage = {
  key: "profiles" | "calendars" | "hosts"
  label: string
  color: string
  Icon: React.ComponentType<{ className?: string }>
  value: (r: PlanningEventRow) => string | null
  done: (r: PlanningEventRow) => boolean
}

const STAGES: Stage[] = [
  {
    key: "calendars",
    label: "Calendars",
    color: DEEP_TEAL,
    Icon: CalendarCheck,
    value: (r) => r.calendar_label,
    // ✓ when the calendar value CONTAINS the word "Sent" (Calendar Sent /
    // Management Sent / Investor Sent). Case-sensitive on "Sent" so the
    // near-miss "Send to Management" (contains "Send", not "Sent") does NOT check.
    done: (r) => !!r.calendar_label && r.calendar_label.includes("Sent"),
  },
  {
    key: "profiles",
    label: "Profiles",
    color: BRAND_BLUE, // blue
    Icon: FileText,
    value: (r) => r.profile_label,
    // ✓ when the profile is Sent or explicitly Not Needed.
    done: (r) => r.profile_label === "Sent" || r.profile_label === "Not Needed",
  },
  {
    key: "hosts",
    label: "Hosts",
    color: TEXT_SECONDARY, // slate
    Icon: UserRound,
    value: (r) => r.host_name,
    // ✓ when a host is assigned.
    done: (r) => !!r.host_name,
  },
]

// Singular labels for the "Missing:" filter checkboxes, keyed by stage. A checked
// box narrows the table to meetings where that stage is NOT done (the inverse of
// the column's checkmark), so the two can never drift.
const MISSING_LABELS: Record<Stage["key"], string> = {
  calendars: "Calendar",
  profiles: "Profile",
  hosts: "Host",
}

// meeting_date is a +00 wall clock read as-is (see the view), so format in UTC
// to show the stored local time, never shifting zones.
const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  hour: "numeric",
  minute: "2-digit",
})
const DAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
})
const SHORT_DAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
})
function fmtTime(iso: string): string {
  return TIME_FMT.format(new Date(iso))
}
// "Mon, Jun 23" from a YYYY-MM-DD day string (parsed as a UTC calendar date).
function fmtDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number)
  return DAY_FMT.format(new Date(Date.UTC(y, m - 1, d)))
}
function fmtShort(day: string): string {
  const [y, m, d] = day.split("-").map(Number)
  return SHORT_DAY_FMT.format(new Date(Date.UTC(y, m - 1, d)))
}
const LONG_DAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  month: "short",
  day: "numeric",
})
// "Monday, Jun 30" — long weekday, for the By Day header title.
function fmtDayLong(day: string): string {
  const [y, m, d] = day.split("-").map(Number)
  return LONG_DAY_FMT.format(new Date(Date.UTC(y, m - 1, d)))
}

// ---- week-window date math (By Week view) ---------------------------------
// All on YYYY-MM-DD strings, computed in UTC to match the wall-clock convention
// and stay hydration-safe (no Date.now()).
function ymdFromUTC(dt: Date): string {
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0")
  const d = String(dt.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return ymdFromUTC(dt)
}
// The Monday on/of the week containing `day`.
function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = dt.getUTCDay() // 0=Sun … 6=Sat
  return addDays(day, -((dow + 6) % 7))
}
// The viewer's LOCAL calendar day (used only for the By Day "today" default,
// which is computed client-side from the post-mount clock — never on the server).
function ymdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// ---- ONE shared table layout (identical across By Event / By Week / By Day) --
// Every view renders the same columns, in the same order, at the same widths:
//   Institution · Time · Client(ticker) · Type(pill) · Event(icon) · |divider| ·
//   3 stages · |divider| · Sent · Confirm · Food · Driver · Notes · spacer
// Client (a short ticker link) and Event (a single clickable icon) are both narrow
// (NARROW_W); the space reclaimed from the old wide event-name column is handed to
// the 8 tracking columns (wider TRACK_W).
//
// STRETCH-TO-FIT (same pattern as the Portfolio table): the grid fills the card at
// any width, with a min-width floor below which the wrapper scrolls rather than
// cramming. There is NO trailing spacer track — leftover width used to pool in an
// empty column at the far right, which is what left the card looking unfilled on a
// wide screen. Instead the two TEXT columns carry it: Institution and Time are
// `minmax(floor, Nfr)`, so leftover is shared 3:1 between them (Institution earns
// the larger share — it is the only column whose content is actually truncated).
// Every other track stays FIXED: Client/Type/Event hold their compact widths, and
// all 8 tracking columns keep TRACK_W, so the numeric block never balloons.
//
// Trade-off, inherited from the Portfolio pattern: the flexible tracks mean column
// geometry is no longer strictly WIDTH-INVARIANT — a window scrollbar in a tall
// view (By Week) narrows the card and nudges Institution/Time by a few px versus a
// short view. Only those two move; the tracking block keeps its exact widths.
// gap-2 sits between tracks; only the row
// grouping/scope/title differ per view. All EIGHT tracking columns (the 3 stages
// Profiles/Calendars/Hosts + the 5 logistics Sent/Confirm/Food/Driver/Notes) share
// ONE identical width (TRACK_W) so they read as a single aligned block. It's narrow
// but wide enough for the longest header label ("Calendars"); to fit content into
// it WITHOUT growing row height, Hosts shows initials (full name on hover) and every
// text field (stage labels, Food/Notes) truncates to one line with a hover title.
// There are a lot of columns, so the card scrolls horizontally rather than
// collapsing any track.
//
// The grid is applied via an inline `gridTemplateColumns` style built from TRACK_W
// (not a Tailwind `grid-cols-[…]` class): a dynamically-composed arbitrary class
// wouldn't be detected by Tailwind's JIT, and driving header + rows from one
// constant guarantees the shared width can't drift between them.
const TRACK_W = 103 // px — uniform width for all 8 tracking columns
const NARROW_W = 52 // px — the compact Client-ticker and Event-icon columns
const TYPE_W = 64 // px — the Live/Virtual pill
// The two flexible TEXT columns. Each number is a FLOOR, not a fixed width: above
// the min-width floor they share the leftover 3:1. Institution's floor is what the
// name needs before truncating; Time's is sized to its content
// ("Wed, Sep 30 · 12:00 PM" ≈ 116px + a safe buffer for the bold time).
const INSTITUTION_MIN_W = 260
const TIME_MIN_W = 132
const TABLE_GRID_COLS = `minmax(${INSTITUTION_MIN_W}px, 3fr) minmax(${TIME_MIN_W}px, 1fr) ${NARROW_W}px ${TYPE_W}px ${NARROW_W}px 1px ${TRACK_W}px 1px ${TRACK_W}px 1px ${TRACK_W}px 1px ${TRACK_W}px 1px ${TRACK_W}px 1px ${TRACK_W}px 1px ${TRACK_W}px 1px ${TRACK_W}px`

/**
 * No-squish floor for the horizontal-scroll area: the sum of every track at its
 * minimum, plus the gap-2 between them and the px-4 card padding. Wider than this
 * and the grid stretches to fill (no right-hand gap); narrower and the wrapper
 * scrolls horizontally instead of cramming.
 *
 * Derived rather than hardcoded so it can't drift when a track width changes.
 */
const TABLE_TRACK_COUNT = 21 // 5 identity + 8 tracking + 8 dividers
const TABLE_MIN_W =
  INSTITUTION_MIN_W +
  TIME_MIN_W +
  NARROW_W * 2 +
  TYPE_W +
  TRACK_W * 8 +
  8 * 1 + // the 1px column dividers
  (TABLE_TRACK_COUNT - 1) * 8 + // gap-2 between tracks
  16 * 2 // px-4 on the header/row grid containers

// ---- per-event aggregation -------------------------------------------------
type EventGroup = {
  eventId: string
  name: string
  meetings: PlanningEventRow[]
  firstDay: string
  lastDay: string
  firstFutureDay: string | null // earliest not-yet-past meeting; null if all past
  total: number
  upcoming: number
  doneCells: number
  totalCells: number
  pct: number // 0..1 completion across all meetings × 3 stages
  stageDone: Record<string, number> // per-stage count of meetings complete
}

function buildGroups(rows: PlanningEventRow[]): EventGroup[] {
  const byId = new Map<string, PlanningEventRow[]>()
  for (const r of rows) {
    const arr = byId.get(r.event_id)
    if (arr) arr.push(r)
    else byId.set(r.event_id, [r])
  }
  const groups: EventGroup[] = []
  for (const [eventId, mtgs] of byId) {
    const meetings = [...mtgs].sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))
    const days = meetings.map((m) => m.meeting_day)
    const futureDays = meetings.filter((m) => !m.is_past).map((m) => m.meeting_day)
    let doneCells = 0
    const stageDone: Record<string, number> = {}
    for (const s of STAGES) stageDone[s.key] = 0
    for (const m of meetings)
      for (const s of STAGES)
        if (s.done(m)) {
          doneCells++
          stageDone[s.key]++
        }
    const totalCells = meetings.length * STAGES.length
    groups.push({
      eventId,
      name: meetings[meetings.length - 1]?.event_name ?? "(Unnamed event)",
      meetings,
      firstDay: days[0],
      lastDay: days[days.length - 1],
      firstFutureDay: futureDays.length ? futureDays[0] : null,
      total: meetings.length,
      upcoming: futureDays.length,
      doneCells,
      totalCells,
      pct: totalCells ? doneCells / totalCells : 0,
      stageDone,
    })
  }
  // Sort by soonest upcoming meeting (events with no future meeting sink to the
  // bottom, ordered by their last day).
  groups.sort((a, b) => {
    if (a.firstFutureDay && b.firstFutureDay)
      return a.firstFutureDay.localeCompare(b.firstFutureDay)
    if (a.firstFutureDay) return -1
    if (b.firstFutureDay) return 1
    return a.lastDay.localeCompare(b.lastDay)
  })
  return groups
}

// Threshold color for a progress bar / ratio.
function pctColor(pct: number): string {
  if (pct >= 0.999) return DEEP_TEAL
  // 66-99% shares the 100% teal rather than carrying its own lighter one — the
  // ring's arc length and the percentage printed inside it already separate the
  // two states, and a second teal would reintroduce the lighter shade.
  if (pct >= 0.66) return DEEP_TEAL
  if (pct >= 0.33) return "#B7791F" // amber
  return "#C53030" // red
}

// All three stages complete for a single meeting → "fully ready".
function fullyReady(r: PlanningEventRow): boolean {
  return STAGES.every((s) => s.done(r))
}

// Softer green for the Planning V2 header ratio pills ONLY. The shared
// DAYS_LEFT_PILL.green (#C6F6D5/#2D7A2D) is intentionally left untouched so the
// days-left column and other pages keep their tone; only these header count pills
// use this lighter green.
const RATIO_PILL_GREEN = { bg: "#E7F3EC", fg: "#1F7A4F" }

// Red/amber/green pill colors for a stage's column completion ratio. Amber/red/gray
// reuse the app-wide Days-Left palette so the lagging stage pops; green uses the
// softer RATIO_PILL_GREEN above. Empty events → gray.
function ratioPill(done: number, total: number): { bg: string; fg: string } {
  if (total === 0) return DAYS_LEFT_PILL.gray
  const r = done / total
  if (r >= 0.8) return RATIO_PILL_GREEN
  if (r >= 0.4) return DAYS_LEFT_PILL.amber
  return DAYS_LEFT_PILL.red
}

function fmtRange(first: string, last: string): string {
  return first === last ? fmtShort(first) : `${fmtShort(first)} – ${fmtShort(last)}`
}

// Circular completion ring (feature #2): percentage in the center, sized to sit
// in the detail header. Colored by completion like the list-card bars.
function CompletionRing({ pct }: { pct: number }) {
  const size = 56
  const stroke = 6
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const color = pctColor(pct)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF0F4" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="14"
        fontWeight="700"
        fill={color}
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  )
}

// Aggregate completion across a set of meetings. Drives the header counter + ring,
// scoped to the meetings currently shown. Every meeting contributes its 3 stages
// (Profiles / Calendars / Hosts). LIVE meetings (is_in_person) additionally
// contribute the 3 Yes/No logistics fields — Sent, Confirm, Driver — each adding
// one to the denominator and one to the numerator when true. Virtual meetings
// exclude those (they show grey "n/a" dashes), and Food / Notes are free-text with
// no complete state, so neither counts here.
function tallyCells(meetings: PlanningEventRow[]): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const m of meetings) {
    for (const s of STAGES) {
      total++
      if (s.done(m)) done++
    }
    if (m.is_in_person) {
      for (const v of [m.sent, m.confirm, m.driver]) {
        total++
        if (v) done++
      }
    }
  }
  return { done, total }
}

// Shared framed header bar: view title (top-left) + "X / Y steps complete"
// counter and completion ring (top-right). Used by all three views so they read
// consistently.
function TableHeaderBar({
  title,
  subtitle,
  doneCells,
  totalCells,
}: {
  title: string
  subtitle?: React.ReactNode
  doneCells: number
  totalCells: number
}) {
  const pct = totalCells ? doneCells / totalCells : 0
  return (
    <div className="flex items-start justify-between gap-4 border-b px-4 py-3.5">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold leading-snug" style={{ color: NAVY_DEEP }}>
          {title}
        </div>
        {subtitle != null && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {subtitle}
          </div>
        )}
      </div>
      {/* Completion ring + "X / Y steps complete" */}
      <div className="flex shrink-0 items-center gap-2.5">
        <CompletionRing pct={pct} />
        <div className="leading-tight">
          <div className="text-sm font-semibold tabular-nums" style={{ color: NAVY_DEEP }}>
            {doneCells} / {totalCells}
          </div>
          <div className="text-[11px] text-muted-foreground">steps complete</div>
        </div>
      </div>
    </div>
  )
}

// Live / Virtual pill for the Type column. Matches the Live Outreach page's
// ModeTag exactly (same colors, icon+label shape, padding/radius) so the two pages
// read the same: Live = green tint + MapPin, Virtual = blue tint + Video. Mapped
// from the meeting's is_in_person.
const LIVE_VIRTUAL_STYLE = {
  Live: { bg: "#E7F5EE", text: "#0E7C56", Icon: MapPin },
  Virtual: { bg: "#EEF2FB", text: "#2D4A8A", Icon: Video },
} as const
function LiveVirtualPill({ isLive }: { isLive: boolean }) {
  const s = isLive ? LIVE_VIRTUAL_STYLE.Live : LIVE_VIRTUAL_STYLE.Virtual
  const Icon = s.Icon
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md font-medium"
      style={{ padding: "2px 8px", fontSize: 11, background: s.bg, color: s.text }}
    >
      <Icon className="size-3" />
      {isLive ? "Live" : "Virtual"}
    </span>
  )
}

// Full-height hairline used as a 1px grid column. Default (COL_DIVIDER) separates
// the meeting-info section from the tracking block; `faint` uses a lighter tone
// for the dividers BETWEEN the four stage columns. self-stretch makes it span the
// full row height regardless of the row's vertical alignment.
// `row` / `column` pin the divider to explicit grid lines. The header is one
// grid whose first five columns span BOTH rows, so its row-2 children must say
// which row they belong to or auto-placement would drop them into the gaps in
// row 1. The two SECTION dividers additionally take `row="1 / 3"` + an explicit
// column, so each primary block is bounded by a rule running the full header
// height; self-stretch makes the line span the row gap as well, so it reads as
// one continuous stroke rather than two segments. Body rows omit both props and
// place normally.
function ColDivider({
  faint,
  row,
  column,
}: {
  faint?: boolean
  row?: number | string
  column?: number
}) {
  return (
    <div
      aria-hidden
      className="h-full self-stretch"
      style={{
        backgroundColor: faint ? STAGE_DIVIDER : COL_DIVIDER,
        ...(row ? { gridRow: row } : null),
        ...(column ? { gridColumn: column } : null),
      }}
    />
  )
}

// OCCURRED indicator — meetings >= 1h past start. A single compact clock icon
// (hover for the label) instead of a text chip, to reclaim horizontal space.
function OccurredTag() {
  return (
    <span
      className="inline-flex shrink-0 items-center"
      title="Occurred"
      aria-label="Occurred"
    >
      <Clock className="size-3.5" style={{ color: NAVY_DEEP }} strokeWidth={2.5} />
    </span>
  )
}

// Compact boolean cell for the meeting-level logistics Yes/No columns (Sent /
// Confirm / Driver). Renders exactly like a StageCell's indicator so the eight
// tracking columns read as one system: a green check when done, an empty grey
// ring when not. Logistics apply to LIVE meetings only, so virtual meetings show
// a grey dash instead (these fields don't apply, matching the steps-complete
// tally which counts them for live meetings only).
function BoolCell({ value, live }: { value: boolean | null; live: boolean }) {
  if (!live) {
    return (
      <div className="flex min-w-0 items-center">
        <span className="text-[11px] leading-tight" style={{ color: "#9AA1AD" }}>
          —
        </span>
      </div>
    )
  }
  return (
    <div className="flex min-w-0 items-center">
      {value ? (
        <span
          className="flex size-[16px] shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: DEEP_TEAL }}
        >
          <Check className="size-[10px] text-white" strokeWidth={3} />
        </span>
      ) : (
        <span
          className="size-[16px] shrink-0 rounded-full border-2"
          style={{ borderColor: EMPTY_RING }}
        />
      )}
    </div>
  )
}

// Compact text cell for the logistics info columns (Food / Notes): single-line,
// with ellipsis truncation and the full text on hover — same text treatment as a
// StageCell's label, so the columns line up as one system.
function TextCell({ value }: { value: string | null }) {
  return (
    <div className="min-w-0">
      <span
        className="block truncate text-[11px] leading-tight"
        style={{ color: value ? "#4A5161" : "#9AA1AD" }}
        title={value || undefined}
      >
        {value || "—"}
      </span>
    </div>
  )
}

// Optional per-column completion ratio pill shown under a tracking column's
// header label.
type HeaderPill = { bg: string; fg: string; done: number; total: number; title: string }

// One tracking-column header cell: an icon + uppercase label, with an optional
// "done/total" ratio pill beneath. Used by ALL eight tracking columns (the 3
// stages + the 5 logistics) so they share one visual language. self-start pins
// every label to the same top line, whether or not the cell carries a pill.
function TrackingHeaderCell({
  Icon,
  label,
  pill,
  row,
}: {
  Icon: React.ComponentType<{ className?: string }>
  label: string
  pill?: HeaderPill
  /** Explicit grid row — see the note on ColDivider. */
  row?: number
}) {
  return (
    <div
      className="flex flex-col items-center gap-1 self-start"
      style={row ? { gridRow: row } : undefined}
    >
      <div
        className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: TEXT_SECONDARY }}
      >
        <Icon className="size-3.5" />
        {label}
      </div>
      {pill && (
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
          style={{ backgroundColor: pill.bg, color: pill.fg }}
          title={pill.title}
        >
          {pill.done}/{pill.total}
        </span>
      )}
    </div>
  )
}

// The 5 logistics columns, in order. Icon + label for the header; the three
// Yes/No columns carry a live-only ratio pill, Food/Notes (free text) don't.
const LOGISTICS_COLS = [
  { key: "sent", label: "Sent", Icon: Send, ratio: true },
  { key: "confirm", label: "Confirm", Icon: CheckCheck, ratio: true },
  { key: "food", label: "Food", Icon: Utensils, ratio: false },
  { key: "driver", label: "Driver", Icon: Car, ratio: true },
  { key: "notes", label: "Notes", Icon: StickyNote, ratio: false },
] as const
/** How many logistics columns carry a done/total ratio — drives the LIVE group
 *  tally. Derived, so adding a ratio column cannot leave the band out of step. */
const RATIO_LOGISTICS_COUNT = LOGISTICS_COLS.filter((c) => c.ratio).length

/**
 * One top-tier grouping band: navy small-caps label, a faint-tinted count pill,
 * and the gradient rule beneath. `gridColumn` spans the block's tracks so the
 * rule sits exactly over its columns; `px-3` on the wrapper is what insets the
 * rule from the block's edges so it reads as an accent, not a full-width border.
 *
 * The count is the group's whole cell tally — every tracked cell in the block —
 * so it answers "how much of this section is done" in one number, above the
 * per-column breakdown in the row below.
 */
function GroupBand({
  label,
  done,
  total,
  rule,
  tint,
  gridColumn,
  gridRow,
  title,
}: {
  label: string
  done: number
  total: number
  rule: string
  tint: string
  gridColumn: string
  gridRow: number
  title?: string
}) {
  return (
    <div className={SECTION_BAND_CLASS} style={{ gridColumn, gridRow }} title={title}>
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <span style={{ color: BRAND_NAVY }}>{label}</span>
        <span
          className="rounded-full px-1.5 py-px font-medium tabular-nums"
          style={{ backgroundColor: tint, color: BRAND_NAVY }}
        >
          {done}/{total}
        </span>
      </div>
      {/* Height comes from the shared GROUP_RULE_HEIGHT, not a local h-[2.5px],
          so this rule and the Portfolio header's sweep stay the same weight. */}
      <div
        aria-hidden="true"
        className="w-full rounded-full"
        style={{ height: GROUP_RULE_HEIGHT, backgroundImage: rule }}
      />
    </div>
  )
}

// Shared column header used by ALL three views. Two tiers: a top row of grouping
// bands ("All Meetings" over the 3 stages, "Live Meetings Only" over the 5
// logistics) and a label row where every tracking column shows an icon + label
// and a per-column "done/total" ratio pill. Stage ratios are scoped to all
// meetings in view; the Sent/Confirm/Driver ratios are scoped to LIVE meetings
// only (consistent with the steps-complete tally and the grey-dash rule). The 3px
// transparent left border matches the rows' ready accent so columns line up.
function MeetingTableHeader({ meetings }: { meetings: PlanningEventRow[] }) {
  const total = meetings.length
  const stageDone: Record<string, number> = {}
  for (const s of STAGES) stageDone[s.key] = 0
  for (const m of meetings) for (const s of STAGES) if (s.done(m)) stageDone[s.key]++
  // Live-only scope for the logistics ratios.
  const liveMeetings = meetings.filter((m) => m.is_in_person)
  const liveTotal = liveMeetings.length
  const boolDone: Record<string, number> = { sent: 0, confirm: 0, driver: 0 }
  for (const m of liveMeetings) {
    if (m.sent) boolDone.sent++
    if (m.confirm) boolDone.confirm++
    if (m.driver) boolDone.driver++
  }
  const label = "text-[11px] font-semibold uppercase tracking-wide text-[#9AA1AD]"
  return (
    /* ONE grid, two rows — not two stacked grids. The five ungrouped columns
       (Institution … Event) span BOTH rows, so they rise to the same ceiling as
       the group bands instead of floating in the lower row with dead space above
       them. That is only expressible as a rowspan within a single grid.
       Everything that belongs to the lower row therefore states gridRow={2}:
       with rows 1-2 of columns 1-5 already occupied by the spanning headers,
       auto-placement lays those children out from column 6 rightwards. */
    <div
      /* pt-2.5 = 10px of clear space above the group-band labels. This is the
         ONLY thing that sets that gap — there is no competing rule; the header
         previously read pt-0 deliberately, when the bands were asked to sit
         flush. Because row 2 follows row 1, restoring the space necessarily
         moves the gradient rule and the sub-column row down with it: the header
         grows by 10px rather than the label sliding down into the rule. */
      className="grid gap-x-2 gap-y-1 border-b border-l-[3px] border-l-transparent bg-[#FAFBFD] px-4 pb-2 pt-2.5"
      style={{ gridTemplateColumns: TABLE_GRID_COLS }}
    >
      {/* Ungrouped columns still SPAN the full header height, but sit at the
          BOTTOM of that span, so they share one baseline with the tracking
          block beside them instead of floating up level with the group bands.
          The span is what keeps the column reserved top-to-bottom; self-end is
          purely where the label sits inside it. */}
      <div className={`self-end ${label}`} style={{ gridColumn: 1, gridRow: "1 / 3" }}>
        Institution
      </div>
      <div className={`self-end ${label}`} style={{ gridColumn: 2, gridRow: "1 / 3" }}>
        Time
      </div>
      <div className={`self-end text-center ${label}`} style={{ gridColumn: 3, gridRow: "1 / 3" }}>
        Client
      </div>
      <div className={`self-end text-center ${label}`} style={{ gridColumn: 4, gridRow: "1 / 3" }}>
        Type
      </div>
      <div className={`self-end text-center ${label}`} style={{ gridColumn: 5, gridRow: "1 / 3" }}>
        Event
      </div>

      {/* Row 1: grouping bands, each spanning only its own sub-columns (the
          faint dividers included) so the rule sits exactly over its block.
          Group tallies count every tracked cell in the block — ALL = the 3
          stages across all meetings in view; LIVE = the 3 ratio-carrying
          logistics fields across LIVE meetings only (Food and Notes are free
          text, so they have nothing to be "done"). */}
      <GroupBand
        label="All Meetings"
        done={STAGES.reduce((n, s) => n + stageDone[s.key], 0)}
        total={STAGES.length * total}
        rule={ALL_BAND_RULE}
        tint={ALL_BAND_TINT}
        gridColumn="7 / 12"
        gridRow={1}
      />
      <GroupBand
        label="Live Meetings Only"
        done={boolDone.sent + boolDone.confirm + boolDone.driver}
        total={RATIO_LOGISTICS_COUNT * liveTotal}
        rule={LIVE_BAND_RULE}
        tint={LIVE_BAND_TINT}
        gridColumn="13 / 22"
        gridRow={1}
        title="These fields apply to in-person (Live) meetings only"
      />

      {/* SECTION divider: base columns | All Meetings. Spans the whole header
          height (track 6, both rows) so the primary block is bounded top to
          bottom, not just across the sub-column row. */}
      <ColDivider row="1 / 3" column={6} />

      {/* Row 2: the tracking columns — icon + label + ratio pill. The faint
          intra-block dividers stay in row 2, so only the two SECTION rules
          reach the top. */}
      {STAGES.map((s, i) => {
        const done = stageDone[s.key]
        const pill = ratioPill(done, total)
        return (
          <React.Fragment key={s.key}>
            {i > 0 && <ColDivider faint row={2} />}
            <TrackingHeaderCell
              Icon={s.Icon}
              label={s.label}
              row={2}
              pill={{
                ...pill,
                done,
                total,
                title: `${done} of ${total} meetings complete`,
              }}
            />
          </React.Fragment>
        )
      })}
      {/* SECTION divider: All Meetings | Live Meetings Only. Full header height,
          same as track 6 above. */}
      <ColDivider row="1 / 3" column={12} />
      {/* Meeting-level logistics columns, after the stage block. */}
      {LOGISTICS_COLS.map((c, i) => {
        const done = boolDone[c.key] ?? 0
        const pill = ratioPill(done, liveTotal)
        return (
          <React.Fragment key={c.key}>
            {i > 0 && <ColDivider faint row={2} />}
            <TrackingHeaderCell
              Icon={c.Icon}
              label={c.label}
              row={2}
              pill={
                c.ratio
                  ? {
                      ...pill,
                      done,
                      total: liveTotal,
                      title: `${done} of ${liveTotal} live meetings complete`,
                    }
                  : undefined
              }
            />
          </React.Fragment>
        )
      })}
    </div>
  )
}

type View = "event" | "week" | "day" | "client"

export function PlanningV2View({ rows }: { rows: PlanningEventRow[] }) {
  const groups = React.useMemo(() => buildGroups(rows), [rows])

  // Deep-link: /planning-v2?event=<event_id> opens By Event with that event
  // pre-selected (used by the Client Marketing Status "Current Event" link). Read
  // once for the initial pickedId below; if the id isn't among the (filtered)
  // events, the selection falls back to the first, as usual.
  const searchParams = useSearchParams()
  const deepLinkEventId = searchParams.get("event")
  // Deep-link: /planning-v2?client=<account_id> opens the By Client view scoped to
  // that client. Also the in-app target for clicking a row's Client ticker.
  const deepLinkClientId = searchParams.get("client")

  // View toggle. Defaults to By Day so the page lands on today's meetings. A
  // deep-link (?event=…) opens By Event; (?client=…) opens By Client, so the
  // "Current Event" link and a ticker deep-link each land on the right view.
  const [view, setView] = React.useState<View>(
    deepLinkEventId ? "event" : deepLinkClientId ? "client" : "day",
  )

  // Group-by toggle for the By Day / By Week views only. "day" keeps each view's
  // native chronological grouping (day bands in By Week; a single time-ordered
  // list in By Day); "client" regroups the SAME meetings into client bands. It is
  // meaningless for By Event / By Client (they already group by their own axis),
  // so the control is shown only when view is "day" or "week".
  const [groupBy, setGroupBy] = React.useState<"day" | "client">("day")

  // Client clock for the OCCURRED check (feature #1). Starts null so the first
  // render matches the server (no hydration mismatch); set on mount and ticked
  // every 60s so meetings flip to "occurred" an hour after they start.
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    // Every setNow comes from a timer callback (never synchronously in the
    // effect body): a 0ms first tick lands the clock right after mount, then a
    // 60s interval keeps it fresh.
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [])

  // Account-manager filters. Each event ties to one client, hence one primary
  // AM; the secondary AM is usually NULL. Options are built from the full row
  // set so a filtered-away manager never disappears from its own dropdown.
  const [primaryAM, setPrimaryAM] = React.useState<string>(ALL)
  const [secondaryAM, setSecondaryAM] = React.useState<string>(ALL)

  // "Missing:" stage filters — a set of stage keys whose checkmark must be EMPTY.
  // OR semantics: a meeting passes if it is missing ANY of the checked stages.
  // Reuses each stage's own done() (negated) so it can't drift from the columns.
  const [missing, setMissing] = React.useState<Set<string>>(() => new Set())
  const missingActive = missing.size > 0
  const passesMissing = React.useCallback(
    (r: PlanningEventRow) =>
      !missingActive || STAGES.some((s) => missing.has(s.key) && !s.done(r)),
    [missing, missingActive],
  )
  function toggleMissing(key: string) {
    setMissing((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const primaryOptions = React.useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.primary_manager_name).filter(Boolean) as string[]),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  )
  const secondaryOptions = React.useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.secondary_manager_name).filter(Boolean) as string[]),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  // An event passes a manager filter if any of its meetings carry that manager
  // (they all share one client, so this is just a robust uniform match).
  const filteredGroups = React.useMemo(() => {
    let gs = groups
    if (primaryAM !== ALL || secondaryAM !== ALL) {
      gs = gs.filter(
        (g) =>
          (primaryAM === ALL || g.meetings.some((m) => m.primary_manager_name === primaryAM)) &&
          (secondaryAM === ALL ||
            g.meetings.some((m) => m.secondary_manager_name === secondaryAM)),
      )
    }
    // By Event narrowing: only offer events that still have a meeting matching the
    // Missing filter, so the picker never lands on an event with nothing to show.
    if (missingActive) gs = gs.filter((g) => g.meetings.some(passesMissing))
    return gs
  }, [groups, primaryAM, secondaryAM, missingActive, passesMissing])

  // Only the user's explicit pick is stored. The EFFECTIVE selection is derived
  // during render from the FILTERED list: the picked event if it survives the
  // filters, else the first filtered event. No effect, no setState cascade.
  const [pickedId, setPickedId] = React.useState<string | null>(deepLinkEventId)
  const selected =
    filteredGroups.find((g) => g.eventId === pickedId) ??
    (filteredGroups.length ? filteredGroups[0] : null)
  const selectedId = selected?.eventId ?? null

  // In-person ("Live") only filter — applies to the By Week and By Day meeting
  // lists. By Event is left whole so its completion ring stays meaningful.
  const [inPersonOnly, setInPersonOnly] = React.useState(false)

  // Rows passing the AM filters (per-meeting; all meetings of an event share its
  // client, so this matches the event-level filter used by By Event).
  const amFilteredRows = React.useMemo(() => {
    if (primaryAM === ALL && secondaryAM === ALL) return rows
    return rows.filter(
      (r) =>
        (primaryAM === ALL || r.primary_manager_name === primaryAM) &&
        (secondaryAM === ALL || r.secondary_manager_name === secondaryAM),
    )
  }, [rows, primaryAM, secondaryAM])

  // The meeting rows visible in the Week/Day lists: AM-filtered, then optionally
  // narrowed to in-person only.
  const meetingRows = React.useMemo(() => {
    let rs = amFilteredRows
    if (inPersonOnly) rs = rs.filter((r) => r.is_in_person)
    if (missingActive) rs = rs.filter(passesMissing)
    return rs
  }, [amFilteredRows, inPersonOnly, missingActive, passesMissing])

  // ---- By Client state: pick a client, show its meetings chronologically. The
  // client list and shown meetings both derive from meetingRows, so By Client
  // combines with the AM / In-person / Missing filters just like By Week/Day. The
  // picked id is only a preference; the effective client is derived during render
  // (picked if it survives the filters, else the first) — no effect, no cascade.
  const [pickedClientId, setPickedClientId] = React.useState<string | null>(deepLinkClientId)
  const clientOptions = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const r of meetingRows) {
      if (r.client_account_id && r.client_account_name) {
        map.set(r.client_account_id, r.client_account_name)
      }
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [meetingRows])
  const selectedClient =
    clientOptions.find((c) => c.id === pickedClientId) ??
    (clientOptions.length ? clientOptions[0] : null)
  const selectedClientId = selectedClient?.id ?? null
  const clientMeetings = React.useMemo(() => {
    if (!selectedClientId) return []
    return meetingRows
      .filter((r) => r.client_account_id === selectedClientId)
      .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))
  }, [meetingRows, selectedClientId])

  // Earliest day in the data (preferring upcoming) — a stable, prop-derived
  // anchor used to default the Week and (as a last resort) the Day views with no
  // hydration mismatch.
  const earliestDay = React.useMemo(() => {
    if (rows.length === 0) return null
    const future = rows.filter((r) => !r.is_past).map((r) => r.meeting_day)
    const pool = future.length ? future : rows.map((r) => r.meeting_day)
    return pool.reduce((a, b) => (a < b ? a : b))
  }, [rows])

  // ---- By Week state: one Mon–Sun window with prev/next nav, default to the
  // week of the earliest upcoming meeting. ----
  const initialWeekStart = earliestDay ? mondayOf(earliestDay) : null
  const [weekStartPick, setWeekStartPick] = React.useState<string | null>(null)
  const weekStart = weekStartPick ?? initialWeekStart

  // Meetings inside the current week window, grouped by day. Only days with at
  // least one meeting get a section.
  const weekDays = React.useMemo(() => {
    if (!weekStart) return []
    const end = addDays(weekStart, 7) // exclusive upper bound
    const byDay = new Map<string, PlanningEventRow[]>()
    for (const r of meetingRows) {
      if (r.meeting_day >= weekStart && r.meeting_day < end) {
        const arr = byDay.get(r.meeting_day)
        if (arr) arr.push(r)
        else byDay.set(r.meeting_day, [r])
      }
    }
    return Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, meetings]) => ({
        day,
        meetings: meetings.sort((a, b) => a.meeting_date.localeCompare(b.meeting_date)),
      }))
  }, [meetingRows, weekStart])

  // ---- By Day state: a single day with a prev/next stepper, default today. ----
  // "today" comes from the post-mount clock; By Day only renders after the user
  // clicks into it (client-side), so this never runs during SSR. Falls back to
  // the earliest data day until the clock lands.
  const todayYmd = now != null ? ymdLocal(new Date(now)) : null
  const [dayPick, setDayPick] = React.useState<string | null>(null)
  const selectedDay = dayPick ?? todayYmd ?? earliestDay

  // Navigation floor: you cannot page earlier than the current (Monday-anchored)
  // week / today. The Week/Day controls only render after the user switches into
  // those views (client-side), so the clock-derived floor is available by then.
  const currentWeekStart = todayYmd ? mondayOf(todayYmd) : null
  const atFirstWeek = !!weekStart && !!currentWeekStart && weekStart <= currentWeekStart
  const atFirstDay = !!selectedDay && !!todayYmd && selectedDay <= todayYmd

  // The selected day's meetings, in the default By Day order: meeting time
  // ascending, then client ticker (suffix-stripped) A→Z as the tiebreaker.
  const dayMeetings = React.useMemo(() => {
    if (!selectedDay) return []
    return meetingRows
      .filter((r) => r.meeting_day === selectedDay)
      .sort((a, b) => {
        const t = a.meeting_date.localeCompare(b.meeting_date)
        if (t !== 0) return t
        const ta = a.client_ticker ? baseTicker(a.client_ticker) : ""
        const tb = b.client_ticker ? baseTicker(b.client_ticker) : ""
        return ta.localeCompare(tb)
      })
  }, [meetingRows, selectedDay])

  // Cross-link: clicking an event icon in By Week / By Day jumps to By Event.
  const openEvent = (id: string) => {
    setPickedId(id)
    setView("event")
  }

  // Cross-link: clicking a Client ticker switches to the By Client view scoped to
  // that client, showing all of its events/meetings.
  const openClient = (clientAccountId: string) => {
    setPickedClientId(clientAccountId)
    setView("client")
  }

  const amActive = primaryAM !== ALL || secondaryAM !== ALL

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          title="Planning"
          subtitle="Upcoming events and their meeting-by-meeting readiness across Profiles, Calendars and Hosts."
        />
      </div>

      {groups.length === 0 ? (
        <div className={`p-10 text-center text-sm text-muted-foreground ${CARD_CLASS}`}>
          No upcoming events. An event appears here once it has at least one
          confirmed meeting today or later.
        </div>
      ) : (
        <>
          {/* ---- Top control bar: view toggle + context control + AM filters ---- */}
          <div className="mb-4 flex flex-wrap items-end gap-3">
            {/* VIEW selector — label stacked above the control. */}
            <div className="flex flex-col gap-1">
              <span className={FILTER_LABEL}>View</span>
              <SegmentedToggle
                value={view}
                onChange={setView}
                options={[
                  { value: "day", label: "By Day" },
                  { value: "week", label: "By Week" },
                  { value: "event", label: "By Event" },
                  { value: "client", label: "By Client" },
                ]}
              />
            </div>

            {/* GROUP BY — same stacked label-above-control pattern as View/Day, so
                the three read as one row of controls. Only shown in By Day / By Week
                (it re-arranges those views). */}
            {(view === "day" || view === "week") && (
              <div className="flex flex-col gap-1">
                <span className={FILTER_LABEL}>Group by</span>
                <GroupByToggle value={groupBy} onChange={setGroupBy} />
              </div>
            )}

            {/* Context control: event dropdown (By Event), week nav (By Week),
                or day stepper (By Day) */}
            {view === "event" ? (
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor="planning-v2-event" className={FILTER_LABEL}>
                  Event
                </label>
                <select
                  id="planning-v2-event"
                  value={selectedId ?? ""}
                  onChange={(e) => setPickedId(e.target.value)}
                  className="h-9 w-full min-w-[240px] max-w-[420px] rounded-md border border-input bg-background px-2 text-sm"
                >
                  {filteredGroups.length === 0 ? (
                    <option value="">No events match these filters</option>
                  ) : (
                    filteredGroups.map((g) => (
                      <option key={g.eventId} value={g.eventId}>
                        {g.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            ) : view === "client" ? (
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor="planning-v2-client" className={FILTER_LABEL}>
                  Client
                </label>
                <select
                  id="planning-v2-client"
                  value={selectedClientId ?? ""}
                  onChange={(e) => setPickedClientId(e.target.value)}
                  className="h-9 w-full min-w-[240px] max-w-[420px] rounded-md border border-input bg-background px-2 text-sm"
                >
                  {clientOptions.length === 0 ? (
                    <option value="">No clients match these filters</option>
                  ) : (
                    clientOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            ) : view === "week" ? (
              <div className="flex flex-col gap-1">
                <span className={FILTER_LABEL}>Week</span>
                <div className="flex h-9 items-center gap-1 rounded-md border border-input bg-background px-1">
                  <button
                    type="button"
                    aria-label="Previous week"
                    disabled={atFirstWeek}
                    onClick={() =>
                      !atFirstWeek && weekStart && setWeekStartPick(addDays(weekStart, -7))
                    }
                    className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-slate-50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <span
                    className="min-w-[140px] text-center text-sm font-medium tabular-nums"
                    style={{ color: NAVY_DEEP }}
                  >
                    {weekStart
                      ? `${fmtShort(weekStart)} – ${fmtShort(addDays(weekStart, 6))}`
                      : "—"}
                  </span>
                  <button
                    type="button"
                    aria-label="Next week"
                    onClick={() => weekStart && setWeekStartPick(addDays(weekStart, 7))}
                    className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-slate-50 hover:text-foreground"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <span className={FILTER_LABEL}>Day</span>
                <div className="flex h-9 items-center gap-1 rounded-md border border-input bg-background px-1">
                  <button
                    type="button"
                    aria-label="Previous day"
                    disabled={atFirstDay}
                    onClick={() =>
                      !atFirstDay && selectedDay && setDayPick(addDays(selectedDay, -1))
                    }
                    className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-slate-50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <span
                    className="min-w-[150px] text-center text-sm font-medium tabular-nums"
                    style={{ color: NAVY_DEEP }}
                  >
                    {selectedDay ? fmtDay(selectedDay) : "—"}
                  </span>
                  <button
                    type="button"
                    aria-label="Next day"
                    onClick={() => selectedDay && setDayPick(addDays(selectedDay, 1))}
                    className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-slate-50 hover:text-foreground"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
            )}

            {/* In-person filter + account-manager filters, pushed to the right. */}
            <div className="ml-auto flex items-end gap-2">
              {/* In-person only — narrows the By Week / By Day lists to Live meetings. */}
              <label className="flex h-9 cursor-pointer items-center gap-1.5 whitespace-nowrap text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={inPersonOnly}
                  onChange={(e) => setInPersonOnly(e.target.checked)}
                  className="size-4 rounded border-input accent-[#0E8A7C]"
                />
                In-person only
              </label>
              <div className="flex flex-col gap-1">
                <label htmlFor="planning-v2-primary-am" className={FILTER_LABEL}>
                  Account Manager
                </label>
                <select
                  id="planning-v2-primary-am"
                  value={primaryAM}
                  onChange={(e) => setPrimaryAM(e.target.value)}
                  className="h-9 w-[160px] rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value={ALL}>All</option>
                  {primaryOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="planning-v2-secondary-am" className={FILTER_LABEL}>
                  Secondary AM
                </label>
                <select
                  id="planning-v2-secondary-am"
                  value={secondaryAM}
                  onChange={(e) => setSecondaryAM(e.target.value)}
                  className="h-9 w-[160px] rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value={ALL}>All</option>
                  {secondaryOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              {amActive && (
                <button
                  type="button"
                  onClick={() => {
                    setPrimaryAM(ALL)
                    setSecondaryAM(ALL)
                  }}
                  className="h-9 cursor-pointer rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* ---- "Missing:" stage filters — right-aligned, under the Account
              Manager filter. Checking a box narrows every view (By Event / By Week
              / By Day) to meetings missing that stage; OR across checked boxes. ---- */}
          <div className="mb-4 -mt-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            <span className={FILTER_LABEL}>Missing:</span>
            {STAGES.map((s) => (
              <label
                key={s.key}
                className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-sm text-foreground"
              >
                <input
                  type="checkbox"
                  checked={missing.has(s.key)}
                  onChange={() => toggleMissing(s.key)}
                  className="size-4 rounded border-input accent-[#0E8A7C]"
                />
                {MISSING_LABELS[s.key]}
              </label>
            ))}
          </div>

          {/* ---- Full-width content ---- */}
          {view === "event" ? (
            selected ? (
              <EventDetail
                group={selected}
                meetings={
                  missingActive ? selected.meetings.filter(passesMissing) : selected.meetings
                }
                now={now}
                onOpenEvent={openEvent}
                onOpenClient={openClient}
              />
            ) : (
              <div className={`p-10 text-center text-sm text-muted-foreground ${CARD_CLASS}`}>
                No events match these filters.
              </div>
            )
          ) : view === "client" ? (
            selectedClient ? (
              <div>
                {/* Scope note — caption only, no effect on which meetings show. */}
                <p className="mb-2 text-[11px] italic text-muted-foreground">
                  * Displays meetings for active events only (an event is active if it
                  has at least one upcoming meeting).
                </p>
                <ClientTable
                  title={selectedClient.name}
                  meetings={clientMeetings}
                  now={now}
                  onOpenEvent={openEvent}
                onOpenClient={openClient}
                />
              </div>
            ) : (
              <div className={`p-10 text-center text-sm text-muted-foreground ${CARD_CLASS}`}>
                No clients match these filters.
              </div>
            )
          ) : view === "week" ? (
            <WeekTable
              title={
                weekStart
                  ? `Week of ${fmtShort(weekStart)} – ${fmtShort(addDays(weekStart, 6))}`
                  : "Week"
              }
              days={weekDays}
              groupBy={groupBy}
              now={now}
              onOpenEvent={openEvent}
              onOpenClient={openClient}
            />
          ) : (
            <DayTable
              title={selectedDay ? fmtDayLong(selectedDay) : "Day"}
              meetings={dayMeetings}
              groupBy={groupBy}
              now={now}
              onOpenEvent={openEvent}
              onOpenClient={openClient}
            />
          )}
        </>
      )}
    </>
  )
}

// ---- By Event: one section (the event's meetings) + a Now divider. ----
function EventDetail({
  group,
  meetings,
  now,
  onOpenEvent,
  onOpenClient,
}: {
  group: EventGroup
  meetings: PlanningEventRow[]
  now: number | null
  onOpenEvent: (eventId: string) => void
  onOpenClient: (clientAccountId: string) => void
}) {
  // Counts / date range reflect the meetings actually shown, so they stay honest
  // when the Missing filter narrows this event to just its incomplete meetings.
  // meetings arrive sorted by date (buildGroups), so [0] / [last] give the range.
  const total = meetings.length
  const upcoming = meetings.filter((m) => !m.is_past).length
  const firstDay = meetings[0]?.meeting_day ?? group.firstDay
  const lastDay = meetings[meetings.length - 1]?.meeting_day ?? group.lastDay
  return (
    <MeetingTable
      title={group.name}
      subtitle={
        <>
          <span>{fmtRange(firstDay, lastDay)}</span>
          <span>·</span>
          <span>{total} meetings</span>
          <span>·</span>
          <span>{upcoming} upcoming</span>
        </>
      }
      meetings={meetings}
      sections={[{ key: group.eventId, meetings, showNowDivider: true }]}
      emptyMessage="No meetings match the Missing filter for this event."
      now={now}
      onOpenEvent={onOpenEvent}
      onOpenClient={onOpenClient}
    />
  )
}

// "Now" divider (feature #1): a bold teal dashed rule with a "▼ UPCOMING" label,
// separating occurred meetings (above) from present-onward (below).
function NowDivider() {
  return (
    <div className="flex items-center gap-2 px-4 py-2" aria-label="Upcoming meetings">
      <div className="h-0 flex-1 border-t-2 border-dashed" style={{ borderColor: DEEP_TEAL }} />
      <span
        className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide"
        style={{ color: DEEP_TEAL }}
      >
        <ChevronDown className="size-3" strokeWidth={3} />
        Upcoming
      </span>
      <div className="h-0 flex-1 border-t-2 border-dashed" style={{ borderColor: DEEP_TEAL }} />
    </div>
  )
}

// Shared meeting row used by ALL three views. Columns match TABLE_GRID_COLS
// exactly: Institution(+tags) · Time(day+time) · Client(ticker link) · Type(pill) ·
// Event(icon) · | · 3 stages · | · 5 logistics.
function MeetingRow({
  row,
  now,
  onOpenEvent,
  onOpenClient,
}: {
  row: PlanningEventRow
  now: number | null
  onOpenEvent: (eventId: string) => void
  onOpenClient: (clientAccountId: string) => void
}) {
  const occurred = isOccurred(row, now)
  const ready = fullyReady(row)
  const live = row.is_in_person
  const ticker = row.client_ticker ? baseTicker(row.client_ticker) : null
  return (
    <div
      className="grid items-center gap-2 border-b border-[#F0F2F6] px-4 py-1.5 last:border-b-0"
      // Green left-accent whenever every stage is complete, so fully-prepped
      // meetings recede; a transparent border keeps the grid aligned otherwise.
      // Occurred meetings are NOT colored/dimmed differently — the clock symbol
      // beside the institution is the sole occurred indicator.
      style={{
        gridTemplateColumns: TABLE_GRID_COLS,
        borderLeft: `3px solid ${ready ? DEEP_TEAL : "transparent"}`,
      }}
    >
      {/* Institution (+ status tags) */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="truncate text-[13px] font-medium leading-tight"
          style={{ color: NAVY_DEEP }}
          title={row.institution_name || undefined}
        >
          {row.institution_name || "—"}
        </span>
        {occurred && <OccurredTag />}
      </div>

      {/* Time — weekday+date prefix (regular, muted) then the meeting time (bold).
          Only the time is emphasized; the weekday stays non-bold in every view. */}
      <div className="truncate whitespace-nowrap text-[11px] text-muted-foreground tabular-nums">
        {fmtDay(row.meeting_day)} ·{" "}
        <span className="font-semibold text-foreground">{fmtTime(row.meeting_date)}</span>
      </div>

      {/* Client — short ticker (suffix stripped), a brand-blue link that opens the
          By Client view scoped to this client. Centered. */}
      <div className="flex min-w-0 justify-center">
        {ticker && row.client_account_id ? (
          <button
            type="button"
            onClick={() => onOpenClient(row.client_account_id!)}
            className="cursor-pointer truncate text-center text-[12px] font-semibold leading-tight text-[#0355A7] hover:underline"
            title={`Show ${row.client_account_name ?? ticker} in By Client`}
          >
            {ticker}
          </button>
        ) : (
          <span className="text-[12px] leading-tight text-muted-foreground">—</span>
        )}
      </div>

      {/* Type — Live/Virtual pill, centered */}
      <div className="flex min-w-0 justify-center">
        <LiveVirtualPill isLive={row.is_in_person} />
      </div>

      {/* Event — the 📅 calendar emoji (full-color graphic), full name on hover,
          opens By Event on click. Sized to fit the same 16px box as the stage
          indicators so it doesn't grow the row. Centered. */}
      <div className="flex min-w-0 justify-center">
        <button
          type="button"
          onClick={() => onOpenEvent(row.event_id)}
          className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm transition-colors hover:bg-[#0154a6]/15"
          title={`Open "${row.event_name}" in By Event`}
          aria-label={`Open "${row.event_name}" in By Event`}
        >
          <span aria-hidden="true" className="text-[12px] leading-none">
            📅
          </span>
        </button>
      </div>

      <ColDivider />

      {/* Three stage cells, with faint dividers between them. Hosts shows initials
          (full name via the cell's hover title) to fit the narrow shared width
          without wrapping; the stage's done() logic is unchanged. */}
      {STAGES.map((s, i) => {
        const raw = s.value(row)
        const isHost = s.key === "hosts"
        return (
          <React.Fragment key={s.key}>
            {i > 0 && <ColDivider faint />}
            <StageCell
              done={s.done(row)}
              value={isHost ? hostInitials(raw) : raw}
              title={isHost ? raw : undefined}
            />
          </React.Fragment>
        )
      })}

      {/* Meeting-level logistics: Sent · Confirm · Food · Driver · Notes. These
          apply to Live meetings only. For a Live meeting, the five cells render
          their check / ring / text content with faint dividers between. For a
          Virtual meeting, the whole block is one continuous grayed-out hatch band
          (spanning the five logistics tracks 13–21, dividers dropped) so it reads
          at a glance as "not applicable". */}
      <ColDivider />
      {live ? (
        <>
          <BoolCell value={row.sent} live={live} />
          <ColDivider faint />
          <BoolCell value={row.confirm} live={live} />
          <ColDivider faint />
          <TextCell value={row.food_order} />
          <ColDivider faint />
          <BoolCell value={row.driver} live={live} />
          <ColDivider faint />
          <TextCell value={row.logistics_notes} />
        </>
      ) : (
        <div
          className="h-full self-stretch rounded-[3px]"
          style={{ gridColumn: "13 / 22", background: VIRTUAL_HATCH }}
          title="Logistics apply to in-person (Live) meetings only"
          aria-label="Logistics not applicable — virtual meeting"
        />
      )}
    </div>
  )
}

function StageCell({
  done,
  value,
  title,
}: {
  done: boolean
  // `value` is the DISPLAYED text (e.g. host initials); `title` is the full text
  // shown on hover. When `title` is omitted it falls back to `value`, so text
  // shown verbatim (Profiles/Calendars labels) still gets its own hover tooltip.
  value: string | null
  title?: string | null
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {done ? (
        <span
          className="flex size-[16px] shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: DEEP_TEAL }}
        >
          <Check className="size-[10px] text-white" strokeWidth={3} />
        </span>
      ) : (
        <span
          className="size-[16px] shrink-0 rounded-full border-2"
          style={{ borderColor: EMPTY_RING }}
        />
      )}
      <span
        className="truncate text-[11px] leading-tight"
        style={{ color: done ? "#4A5161" : "#9AA1AD" }}
        title={title ?? value ?? undefined}
      >
        {value || "—"}
      </span>
    </div>
  )
}

// Host name → initials for the compact Hosts column (full name shown on hover via
// the cell's title). "Laura Jevons" → "LJ"; a 3+ word name uses first + last
// initial ("Mary Jane Watson" → "MW"); a single word uses its first two letters
// ("Reception" → "RE"). Null/blank passes through so the cell shows its em-dash.
function hostInitials(name: string | null): string | null {
  if (!name) return null
  const tokens = name.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase()
  const first = tokens[0][0]
  const last = tokens[tokens.length - 1][0]
  return (first + last).toUpperCase()
}

// ---- ONE shared table shell -----------------------------------------------
// Framed card: TableHeaderBar (title/subtitle + ring/counter) → shared column
// header → a sections body. A "section" is an optional day band followed by its
// rows. By Event passes one section (with the Now divider); By Week passes one
// section per day; By Day passes a single section. The chrome is identical in all
// three — only the sections/scope/title differ.
type TableSection = {
  key: string
  band?: { label: string; count: number }
  meetings: PlanningEventRow[]
  showNowDivider?: boolean
}

function MeetingTable({
  title,
  subtitle,
  meetings,
  sections,
  emptyMessage,
  now,
  onOpenEvent,
  onOpenClient,
}: {
  title: string
  subtitle?: React.ReactNode
  meetings: PlanningEventRow[]
  sections: TableSection[]
  emptyMessage?: string
  now: number | null
  onOpenEvent: (eventId: string) => void
  onOpenClient: (clientAccountId: string) => void
}) {
  const { done, total } = tallyCells(meetings)
  return (
    <div className={`overflow-hidden ${CARD_CLASS}`}>
      <TableHeaderBar title={title} subtitle={subtitle} doneCells={done} totalCells={total} />
      {meetings.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          {emptyMessage ?? "No meetings to show."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          {/* Same shape as the Portfolio table: an overflow-x:auto wrapper around
              content that is width:100% with a min-width floor. Above the floor
              the grid fills the card (no right-hand gap); below it this wrapper
              scrolls horizontally rather than squeezing the columns. */}
          <div className="w-full" style={{ minWidth: TABLE_MIN_W }}>
            <MeetingTableHeader meetings={meetings} />
            {sections.map((sec) => {
              // For By Event, insert the Now divider before the first upcoming row.
              const split = sec.showNowDivider
                ? sec.meetings.findIndex((m) => !isOccurred(m, now))
                : -1
              return (
                <React.Fragment key={sec.key}>
                  {sec.band && <DayBand label={sec.band.label} count={sec.band.count} />}
                  {sec.meetings.map((m, idx) => (
                    <React.Fragment key={m.meeting_id}>
                      {idx === split && split > 0 && <NowDivider />}
                      <MeetingRow row={m} now={now} onOpenEvent={onOpenEvent} onOpenClient={onOpenClient} />
                    </React.Fragment>
                  ))}
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// Day-band section header (By Week). 3px transparent left border matches rows.
function DayBand({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 border-b border-l-[3px] border-l-transparent bg-[#F4F6FB] px-4 py-1.5">
      <span className="text-[12px] font-semibold" style={{ color: NAVY_DEEP }}>
        {label}
      </span>
      <span className="text-[11px] text-muted-foreground">
        {count} mtg{count === 1 ? "" : "s"}
      </span>
    </div>
  )
}

// Brand-blue Group-by toggle (By Day / By Week only). Uses the Rose & Co BRAND_BLUE
// token for its active fill / accent so it aligns with the View selector; same
// segmented size, shape, and behavior as before.
function GroupByToggle({
  value,
  onChange,
}: {
  value: "day" | "client"
  onChange: (v: "day" | "client") => void
}) {
  const options: Array<{ value: "day" | "client"; label: string }> = [
    { value: "day", label: "Day of Week" },
    { value: "client", label: "By Client" },
  ]
  return (
    <div className="flex h-9 items-center rounded-md border border-[rgba(3,85,167,0.35)] bg-[rgba(3,85,167,0.06)] p-0.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
              (active ? "text-white" : "hover:bg-[rgba(3,85,167,0.12)]")
            }
            style={active ? { backgroundColor: BRAND_BLUE } : { color: BRAND_BLUE }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// Regroup a flat meeting list into one section per client (client bands), sorted
// by client name; meetings within a band are ordered by date/time. Meetings with
// no client fall into a trailing "(No client)" band. Used by By Day / By Week
// when Group by = By Client, reusing the same band chrome as the day bands.
function clientSections(meetings: PlanningEventRow[]): TableSection[] {
  const byClient = new Map<string, PlanningEventRow[]>()
  for (const r of meetings) {
    const key = r.client_account_id ?? "__none__"
    const arr = byClient.get(key)
    if (arr) arr.push(r)
    else byClient.set(key, [r])
  }
  return Array.from(byClient.entries())
    .map(([key, ms]) => {
      const sorted = [...ms].sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))
      return {
        key,
        name: sorted[0]?.client_account_name || "(No client)",
        meetings: sorted,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      key: s.key,
      band: { label: s.name, count: s.meetings.length },
      meetings: s.meetings,
    }))
}

// ---- By Week: day bands (Group by = Day of Week) or client bands (By Client). ----
function WeekTable({
  title,
  days,
  groupBy,
  now,
  onOpenEvent,
  onOpenClient,
}: {
  title: string
  days: Array<{ day: string; meetings: PlanningEventRow[] }>
  groupBy: "day" | "client"
  now: number | null
  onOpenEvent: (eventId: string) => void
  onOpenClient: (clientAccountId: string) => void
}) {
  const meetings = days.flatMap((d) => d.meetings)
  const sections: TableSection[] =
    groupBy === "client"
      ? clientSections(meetings)
      : days.map((d) => ({
          key: d.day,
          band: { label: fmtDay(d.day), count: d.meetings.length },
          meetings: d.meetings,
        }))
  return (
    <MeetingTable
      title={title}
      subtitle={`${meetings.length} meeting${meetings.length === 1 ? "" : "s"}`}
      meetings={meetings}
      sections={sections}
      emptyMessage="No meetings scheduled in this week. Use the arrows above to move to another week."
      now={now}
      onOpenEvent={onOpenEvent}
      onOpenClient={onOpenClient}
    />
  )
}

// ---- By Day: a single flat section (Group by = Day of Week) or client bands. ----
function DayTable({
  title,
  meetings,
  groupBy,
  now,
  onOpenEvent,
  onOpenClient,
}: {
  title: string
  meetings: PlanningEventRow[]
  groupBy: "day" | "client"
  now: number | null
  onOpenEvent: (eventId: string) => void
  onOpenClient: (clientAccountId: string) => void
}) {
  const sections: TableSection[] = !meetings.length
    ? []
    : groupBy === "client"
      ? clientSections(meetings)
      : [{ key: "day", meetings }]
  return (
    <MeetingTable
      title={title}
      subtitle={`${meetings.length} meeting${meetings.length === 1 ? "" : "s"}`}
      meetings={meetings}
      sections={sections}
      emptyMessage="No meetings on this day. Use the arrows above to move to another day."
      now={now}
      onOpenEvent={onOpenEvent}
      onOpenClient={onOpenClient}
    />
  )
}

// ---- By Client: one section (the chosen client's meetings), chronological, with
// the same Now divider as By Event since a client's meetings span past + future. ----
function ClientTable({
  title,
  meetings,
  now,
  onOpenEvent,
  onOpenClient,
}: {
  title: string
  meetings: PlanningEventRow[]
  now: number | null
  onOpenEvent: (eventId: string) => void
  onOpenClient: (clientAccountId: string) => void
}) {
  const upcoming = meetings.filter((m) => !m.is_past).length
  return (
    <MeetingTable
      title={title}
      subtitle={`${meetings.length} meeting${meetings.length === 1 ? "" : "s"} · ${upcoming} upcoming`}
      meetings={meetings}
      sections={meetings.length ? [{ key: "client", meetings, showNowDivider: true }] : []}
      emptyMessage="No meetings for this client match the current filters."
      now={now}
      onOpenEvent={onOpenEvent}
      onOpenClient={onOpenClient}
    />
  )
}

"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Check, FileText, CalendarCheck, UserRound, MessageSquare, Clock, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { ListTitleCard } from "@/components/page-masthead"
import { SegmentedToggle } from "@/components/segmented-toggle"
import { BRAND_BLUE, CARD_CLASS, DAYS_LEFT_PILL, TEAL, TEXT_SECONDARY } from "@/lib/design"
import type { PlanningEventRow } from "@/lib/types"

// ⚗️ EXPERIMENTAL SANDBOX COPY of app/planning/planning-view.tsx.
// The real Planning page (app/planning) is untouched and shares the same
// v_planning_events view. Modify this file freely; delete the whole
// app/planning-v2 folder + the "Planning Lab" nav entry to remove it.

const NAVY_DEEP = "#1E2858"
// The done-green for checkmarks and full progress bars. Deliberately NOT
// MONEY_GREEN (reserved for money) — this reuses the "Stable" pill green.
const DONE_GREEN = "#2D7A2D"
const EMPTY_RING = "#D1D6DE"

// Established Live / Virtual colors — the darker tone, shared app-wide
// (profiles-view & people-statistics alias TEAL/BRAND_BLUE the same way). Pills
// use these uniformly for every meeting, occurred or upcoming.
const LIVE_COLOR = TEAL // #1C8C9C
const VIRTUAL_COLOR = BRAND_BLUE // #0355A7
// Hairline divider between the meeting-info columns and the four tracking columns.
const COL_DIVIDER = "#E6E9EF"
// Fainter hairline between individual stage columns (Calendars|Profiles|Hosts|Feedback).
const STAGE_DIVIDER = "#EEF1F6"

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

// ---- the four planning stages ---------------------------------------------
// Each stage knows its header color/icon and how to decide a meeting's check
// from the raw value. Order here is the column order: Calendars, Profiles,
// Hosts, Feedback.
type Stage = {
  key: "profiles" | "calendars" | "hosts" | "feedback"
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
    color: TEAL, // teal
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
  {
    key: "feedback",
    label: "Feedback",
    color: DONE_GREEN, // green
    Icon: MessageSquare,
    value: (r) => r.feedback_status_label,
    // ✓ when feedback reached a Closed status (Closed - All in / Closed - No
    // Feedback). Blank / Awaiting Additional → no check.
    done: (r) => !!r.feedback_status_label && r.feedback_status_label.startsWith("Closed"),
  },
]

// Singular labels for the "Missing:" filter checkboxes, keyed by stage. A checked
// box narrows the table to meetings where that stage is NOT done (the inverse of
// the column's checkmark), so the two can never drift.
const MISSING_LABELS: Record<Stage["key"], string> = {
  calendars: "Calendar",
  profiles: "Profile",
  hosts: "Host",
  feedback: "Feedback",
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
//   Institution · Time · Type(pill) · Event · |1px divider| · 4 stages · spacer
// ALL real columns are FIXED-width; a trailing 1fr spacer soaks up leftover width
// on the right (it also keeps the header background + row borders spanning the
// full card, since those live on the grid container). Fixed tracks make the column
// geometry WIDTH-INVARIANT, so the columns land in the exact same place in every
// view — even when By Week is tall enough to show a vertical scrollbar. (With the
// old flex columns, that scrollbar shrank the content width and shifted By Week's
// columns vs By Event/By Day.) gap-2 sits between tracks; only the row
// grouping/scope/title differ per view.
const TABLE_COLS =
  "grid-cols-[260px_160px_64px_180px_1px_140px_1px_140px_1px_140px_1px_140px_1fr]"
// Floor for the horizontal-scroll area (the fixed tracks define the real width).
const TABLE_MIN_W = "min-w-[1220px]"

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
  pct: number // 0..1 completion across all meetings × 4 stages
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
  if (pct >= 0.999) return DONE_GREEN
  if (pct >= 0.66) return TEAL
  if (pct >= 0.33) return "#B7791F" // amber
  return "#C53030" // red
}

// All four stages complete for a single meeting → "fully ready".
function fullyReady(r: PlanningEventRow): boolean {
  return STAGES.every((s) => s.done(r))
}

// Red/amber/green pill colors for a stage's column completion ratio, reusing the
// app-wide Days-Left palette so the lagging stage pops. Empty events → gray.
function ratioPill(done: number, total: number): { bg: string; fg: string } {
  if (total === 0) return DAYS_LEFT_PILL.gray
  const r = done / total
  if (r >= 0.8) return DAYS_LEFT_PILL.green
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

// Aggregate stage-cell completion across a set of meetings: total = meetings × 4
// stages, done = how many of those cells are complete. Drives the header counter
// + ring for the Week/Day views, scoped to the meetings currently shown.
function tallyCells(meetings: PlanningEventRow[]): { done: number; total: number } {
  let done = 0
  for (const m of meetings) for (const s of STAGES) if (s.done(m)) done++
  return { done, total: meetings.length * STAGES.length }
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

// Live / Virtual pill, shown after the institution in every meeting row. Solid
// darker teal for in-person ("Live"), solid darker blue for virtual ("Virtual").
// Always the full dark tone — never dimmed for occurred meetings (it must sit
// OUTSIDE any opacity-dimmed wrapper, since CSS opacity multiplies onto children).
function LiveVirtualPill({ isLive }: { isLive: boolean }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
      style={{ backgroundColor: isLive ? LIVE_COLOR : VIRTUAL_COLOR }}
    >
      {isLive ? "Live" : "Virtual"}
    </span>
  )
}

// Full-height hairline used as a 1px grid column. Default (COL_DIVIDER) separates
// the meeting-info section from the tracking block; `faint` uses a lighter tone
// for the dividers BETWEEN the four stage columns. self-stretch makes it span the
// full row height regardless of the row's vertical alignment.
function ColDivider({ faint }: { faint?: boolean }) {
  return (
    <div
      aria-hidden
      className="h-full self-stretch"
      style={{ backgroundColor: faint ? STAGE_DIVIDER : COL_DIVIDER }}
    />
  )
}

// OCCURRED tag — meetings >= 1h past start. Bold navy in a bordered chip.
function OccurredTag() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded-[5px] border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
      style={{ color: NAVY_DEEP, borderColor: "#C3CBDA", backgroundColor: "#FBFCFE" }}
    >
      <Clock className="size-2.5" strokeWidth={2.5} />
      Occurred
    </span>
  )
}

// Shared column-header row used by ALL three views. Single-tier, left-aligned,
// with a per-stage "done/total" ratio pill scoped to the meetings in view, so
// every view shows per-stage progress for its scope. The 3px transparent left
// border matches the rows' ready/occurred accent so columns line up exactly.
function MeetingTableHeader({ meetings }: { meetings: PlanningEventRow[] }) {
  const total = meetings.length
  const stageDone: Record<string, number> = {}
  for (const s of STAGES) stageDone[s.key] = 0
  for (const m of meetings) for (const s of STAGES) if (s.done(m)) stageDone[s.key]++
  const label = "text-[11px] font-semibold uppercase tracking-wide text-[#9AA1AD]"
  return (
    <div
      className={`grid ${TABLE_COLS} items-center gap-2 border-b border-l-[3px] border-l-transparent bg-[#FAFBFD] px-4 py-2`}
    >
      <div className={`self-center ${label}`}>Institution</div>
      <div className={`self-center ${label}`}>Time</div>
      <div className={`self-center ${label}`}>Type</div>
      <div className={`self-center ${label}`}>Event</div>
      <ColDivider />
      {STAGES.map((s, i) => {
        const done = stageDone[s.key]
        const pill = ratioPill(done, total)
        return (
          <React.Fragment key={s.key}>
            {i > 0 && <ColDivider faint />}
            <div className="flex flex-col items-start gap-1">
              <div
                className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: TEXT_SECONDARY }}
              >
                <s.Icon className="size-3.5" />
                {s.label}
              </div>
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                style={{ backgroundColor: pill.bg, color: pill.fg }}
                title={`${done} of ${total} meetings complete`}
              >
                {done}/{total}
              </span>
            </div>
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

  // By Event / By Week toggle. Defaults to By Event, so a deep-link lands here.
  const [view, setView] = React.useState<View>("event")

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
  const [pickedClientId, setPickedClientId] = React.useState<string | null>(null)
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

  // The selected day's meetings, sorted by client then time.
  const dayMeetings = React.useMemo(() => {
    if (!selectedDay) return []
    return meetingRows
      .filter((r) => r.meeting_day === selectedDay)
      .sort((a, b) => {
        const c = (a.institution_name || "").localeCompare(b.institution_name || "")
        return c !== 0 ? c : a.meeting_date.localeCompare(b.meeting_date)
      })
  }, [meetingRows, selectedDay])

  // Cross-link: clicking an event name in By Week / By Day jumps to By Event.
  const openEvent = (id: string) => {
    setPickedId(id)
    setView("event")
  }

  const amActive = primaryAM !== ALL || secondaryAM !== ALL

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          title="Planning"
          subtitle="Upcoming events and their meeting-by-meeting readiness across Profiles, Calendars, Hosts and Feedback."
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
                  className="size-4 rounded border-input accent-[#1C8C9C]"
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
                  className="size-4 rounded border-input accent-[#1C8C9C]"
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
              now={now}
              onOpenEvent={openEvent}
            />
          ) : (
            <DayTable
              title={selectedDay ? fmtDayLong(selectedDay) : "Day"}
              meetings={dayMeetings}
              now={now}
              onOpenEvent={openEvent}
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
}: {
  group: EventGroup
  meetings: PlanningEventRow[]
  now: number | null
  onOpenEvent: (eventId: string) => void
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
    />
  )
}

// "Now" divider (feature #1): a bold teal dashed rule with a "▼ UPCOMING" label,
// separating occurred meetings (above) from present-onward (below).
function NowDivider() {
  return (
    <div className="flex items-center gap-2 px-4 py-2" aria-label="Upcoming meetings">
      <div className="h-0 flex-1 border-t-2 border-dashed" style={{ borderColor: TEAL }} />
      <span
        className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide"
        style={{ color: TEAL }}
      >
        <ChevronDown className="size-3" strokeWidth={3} />
        Upcoming
      </span>
      <div className="h-0 flex-1 border-t-2 border-dashed" style={{ borderColor: TEAL }} />
    </div>
  )
}

// Shared meeting row used by ALL three views. Columns match TABLE_COLS exactly:
// Institution(+tags) · Time(day+time) · Type(pill) · Event(clickable) · | · stages.
function MeetingRow({
  row,
  now,
  onOpenEvent,
}: {
  row: PlanningEventRow
  now: number | null
  onOpenEvent: (eventId: string) => void
}) {
  const occurred = isOccurred(row, now)
  const ready = fullyReady(row)
  return (
    <div
      className={`grid ${TABLE_COLS} items-center gap-2 border-b border-[#F0F2F6] px-4 py-1.5 last:border-b-0`}
      // Green left-accent whenever every stage is complete, so fully-prepped
      // meetings recede; a transparent border keeps the grid aligned otherwise.
      style={{ borderLeft: `3px solid ${ready ? DONE_GREEN : "transparent"}` }}
    >
      {/* Institution (+ status tags) */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={`truncate text-[13px] font-medium leading-tight ${occurred ? "opacity-65" : ""}`}
          style={{ color: NAVY_DEEP }}
          title={row.institution_name || undefined}
        >
          {row.institution_name || "—"}
        </span>
        {occurred && <OccurredTag />}
      </div>

      {/* Time — day + time everywhere */}
      <div
        className={`truncate whitespace-nowrap text-[11px] text-muted-foreground tabular-nums ${occurred ? "opacity-65" : ""}`}
      >
        {fmtDay(row.meeting_day)} · {fmtTime(row.meeting_date)}
      </div>

      {/* Type — Live/Virtual pill (full dark tone, never dimmed) */}
      <div className="flex min-w-0">
        <LiveVirtualPill isLive={row.is_in_person} />
      </div>

      {/* Event — clickable cross-link into By Event */}
      <div className={`min-w-0 ${occurred ? "opacity-65" : ""}`}>
        <button
          type="button"
          onClick={() => onOpenEvent(row.event_id)}
          className="max-w-full cursor-pointer truncate text-left text-[13px] font-medium leading-tight text-[#0355A7] hover:underline"
          title={`Open "${row.event_name}" in By Event`}
        >
          {row.event_name}
        </button>
      </div>

      <ColDivider />

      {/* Four stage cells, with faint dividers between them */}
      {STAGES.map((s, i) => (
        <React.Fragment key={s.key}>
          {i > 0 && <ColDivider faint />}
          <StageCell done={s.done(row)} value={s.value(row)} dim={occurred} />
        </React.Fragment>
      ))}
    </div>
  )
}

function StageCell({
  done,
  value,
  dim,
}: {
  done: boolean
  value: string | null
  dim: boolean
}) {
  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${dim ? "opacity-70" : ""}`}>
      {done ? (
        <span
          className="flex size-[16px] shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: DONE_GREEN }}
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
        title={value || undefined}
      >
        {value || "—"}
      </span>
    </div>
  )
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
}: {
  title: string
  subtitle?: React.ReactNode
  meetings: PlanningEventRow[]
  sections: TableSection[]
  emptyMessage?: string
  now: number | null
  onOpenEvent: (eventId: string) => void
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
          <div className={TABLE_MIN_W}>
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
                      <MeetingRow row={m} now={now} onOpenEvent={onOpenEvent} />
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

// ---- By Week: one section per day (day bands). ----
function WeekTable({
  title,
  days,
  now,
  onOpenEvent,
}: {
  title: string
  days: Array<{ day: string; meetings: PlanningEventRow[] }>
  now: number | null
  onOpenEvent: (eventId: string) => void
}) {
  const meetings = days.flatMap((d) => d.meetings)
  return (
    <MeetingTable
      title={title}
      subtitle={`${meetings.length} meeting${meetings.length === 1 ? "" : "s"}`}
      meetings={meetings}
      sections={days.map((d) => ({
        key: d.day,
        band: { label: fmtDay(d.day), count: d.meetings.length },
        meetings: d.meetings,
      }))}
      emptyMessage="No meetings scheduled in this week. Use the arrows above to move to another week."
      now={now}
      onOpenEvent={onOpenEvent}
    />
  )
}

// ---- By Day: a single section, no band. ----
function DayTable({
  title,
  meetings,
  now,
  onOpenEvent,
}: {
  title: string
  meetings: PlanningEventRow[]
  now: number | null
  onOpenEvent: (eventId: string) => void
}) {
  return (
    <MeetingTable
      title={title}
      subtitle={`${meetings.length} meeting${meetings.length === 1 ? "" : "s"}`}
      meetings={meetings}
      sections={meetings.length ? [{ key: "day", meetings }] : []}
      emptyMessage="No meetings on this day. Use the arrows above to move to another day."
      now={now}
      onOpenEvent={onOpenEvent}
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
}: {
  title: string
  meetings: PlanningEventRow[]
  now: number | null
  onOpenEvent: (eventId: string) => void
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
    />
  )
}

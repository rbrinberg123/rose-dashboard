"use client"

import * as React from "react"
import { Check, FileText, CalendarCheck, UserRound, MessageSquare, MapPin, Video, Clock, ChevronDown } from "lucide-react"
import { ListTitleCard } from "@/components/page-masthead"
import { BRAND_BLUE, CARD_CLASS, DAYS_LEFT_PILL, TEAL, TEXT_SECONDARY } from "@/lib/design"
import type { PlanningEventRow } from "@/lib/types"

const NAVY_DEEP = "#1E2858"
// The done-green for checkmarks and full progress bars. Deliberately NOT
// MONEY_GREEN (reserved for money) — this reuses the "Stable" pill green.
const DONE_GREEN = "#2D7A2D"
const EMPTY_RING = "#D1D6DE"

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
// from the raw value. Order here is the column order: Profiles, Calendars,
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
    key: "profiles",
    label: "Profiles",
    color: BRAND_BLUE, // blue
    Icon: FileText,
    value: (r) => r.profile_label,
    // ✓ when the profile is Sent or explicitly Not Needed.
    done: (r) => r.profile_label === "Sent" || r.profile_label === "Not Needed",
  },
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

export function PlanningView({ rows }: { rows: PlanningEventRow[] }) {
  const groups = React.useMemo(() => buildGroups(rows), [rows])

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
    if (primaryAM === ALL && secondaryAM === ALL) return groups
    return groups.filter(
      (g) =>
        (primaryAM === ALL || g.meetings.some((m) => m.primary_manager_name === primaryAM)) &&
        (secondaryAM === ALL ||
          g.meetings.some((m) => m.secondary_manager_name === secondaryAM)),
    )
  }, [groups, primaryAM, secondaryAM])

  // Only the user's explicit pick is stored. The EFFECTIVE selection is derived
  // during render from the FILTERED list: the picked event if it survives the
  // filters, else the first filtered event. No effect, no setState cascade.
  const [pickedId, setPickedId] = React.useState<string | null>(null)
  const selected =
    filteredGroups.find((g) => g.eventId === pickedId) ??
    (filteredGroups.length ? filteredGroups[0] : null)
  const selectedId = selected?.eventId ?? null

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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
          {/* Left column: filters pinned at the top, then the scrollable event
              list beneath them. The whole column is sticky and viewport-capped, so
              the filters stay put while only the list scrolls internally. */}
          <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)]">
            {/* Account-manager filters: both on one row, each taking half the
                narrow column width so they fit side by side. */}
            <div className="flex shrink-0 flex-col gap-2">
              <div className="flex items-end gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label htmlFor="planning-primary-am" className={FILTER_LABEL}>
                    Account Manager
                  </label>
                  <select
                    id="planning-primary-am"
                    value={primaryAM}
                    onChange={(e) => setPrimaryAM(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value={ALL}>All</option>
                    {primaryOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label htmlFor="planning-secondary-am" className={FILTER_LABEL}>
                    Secondary AM
                  </label>
                  <select
                    id="planning-secondary-am"
                    value={secondaryAM}
                    onChange={(e) => setSecondaryAM(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value={ALL}>All</option>
                    {secondaryOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {(primaryAM !== ALL || secondaryAM !== ALL) && (
                <button
                  type="button"
                  onClick={() => {
                    setPrimaryAM(ALL)
                    setSecondaryAM(ALL)
                  }}
                  className="h-8 cursor-pointer self-start rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Scrollable event list (takes the remaining column height). */}
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {filteredGroups.length === 0 ? (
                <div className={`p-6 text-center text-xs text-muted-foreground ${CARD_CLASS}`}>
                  No events match these filters.
                </div>
              ) : (
                filteredGroups.map((g) => (
                  <EventListCard
                    key={g.eventId}
                    group={g}
                    selected={g.eventId === selectedId}
                    onSelect={() => setPickedId(g.eventId)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right column: detail table, top-aligned with the filters (no gap above). */}
          <div>{selected && <EventDetail group={selected} now={now} />}</div>
        </div>
      )}
    </>
  )
}

// ---- left list card --------------------------------------------------------
function EventListCard({
  group,
  selected,
  onSelect,
}: {
  group: EventGroup
  selected: boolean
  onSelect: () => void
}) {
  const pct = Math.round(group.pct * 100)
  const bar = pctColor(group.pct)
  const complete = group.pct >= 0.999
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-[12px] border bg-white p-3 text-left transition-colors ${
        selected ? "border-[#1E2858]" : "border-[rgba(16,24,40,0.08)] hover:border-[#C3CBDA]"
      }`}
      style={
        selected
          ? { boxShadow: "0 0 0 1px #1E2858, 0 6px 18px rgba(16,24,40,0.08)" }
          : undefined
      }
    >
      {/* Name on the left, prominent completion % (and COMPLETE flag) on the right. */}
      <div className="flex items-start justify-between gap-2">
        <div
          className="line-clamp-2 min-w-0 text-[13px] font-semibold leading-snug"
          style={{ color: NAVY_DEEP }}
          title={group.name}
        >
          {group.name}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[20px] font-bold leading-none tabular-nums" style={{ color: bar }}>
            {pct}%
          </span>
          {/* Event-level COMPLETE flag (feature #4) when every step is done. */}
          {complete && (
            <span
              className="inline-flex items-center gap-0.5 rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{ color: DONE_GREEN, backgroundColor: "#E7F5EE" }}
            >
              <Check className="size-2.5" strokeWidth={3} />
              Complete
            </span>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{fmtRange(group.firstDay, group.lastDay)}</span>
        <span>·</span>
        <span>
          {group.total} mtg{group.total === 1 ? "" : "s"}
        </span>
        {group.upcoming > 0 && (
          <>
            <span>·</span>
            <span className="font-medium text-[#5B6472]">{group.upcoming} upcoming</span>
          </>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EEF0F4]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: bar }}
        />
      </div>
    </button>
  )
}

// ---- right detail panel ----------------------------------------------------
function EventDetail({ group, now }: { group: EventGroup; now: number | null }) {
  return (
    <div className={`overflow-hidden ${CARD_CLASS}`}>
      {/* Detail header: title + summary on the left, completion ring on the right. */}
      <div className="flex items-start justify-between gap-4 border-b px-4 py-3.5">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-snug" style={{ color: NAVY_DEEP }}>
            {group.name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{fmtRange(group.firstDay, group.lastDay)}</span>
            <span>·</span>
            <span>{group.total} meetings</span>
            <span>·</span>
            <span>{group.upcoming} upcoming</span>
          </div>
        </div>
        {/* Completion ring (feature #2): ring + "X / Y steps complete". */}
        <div className="flex shrink-0 items-center gap-2.5">
          <CompletionRing pct={group.pct} />
          <div className="leading-tight">
            <div className="text-sm font-semibold tabular-nums" style={{ color: NAVY_DEEP }}>
              {group.doneCells} / {group.totalCells}
            </div>
            <div className="text-[11px] text-muted-foreground">steps complete</div>
          </div>
        </div>
      </div>

      {/* Column header row, with per-stage completion mini-counts (feature #3). */}
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[minmax(180px,1.6fr)_repeat(4,minmax(96px,1fr))] items-start gap-2 border-b border-l-[3px] border-l-transparent bg-[#FAFBFD] px-4 py-2">
            <div className="self-center text-[11px] font-semibold uppercase tracking-wide text-[#9AA1AD]">
              Meeting
            </div>
            {STAGES.map((s) => {
              const done = group.stageDone[s.key]
              const pill = ratioPill(done, group.total)
              return (
                <div key={s.key} className="flex flex-col items-center gap-1">
                  {/* Uniform title color across all four stages (TEXT_SECONDARY);
                      the per-stage tint lives only in the completion pill below. */}
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
                    title={`${done} of ${group.total} meetings complete`}
                  >
                    {done}/{group.total}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Meeting rows, with a "Now" divider inserted before the first
              still-upcoming meeting (feature #1). Occurred meetings sort first
              (they are the earliest), so the first non-occurred index is a clean
              split; we only draw the divider when occurred meetings sit above it. */}
          {(() => {
            const splitIndex = group.meetings.findIndex((m) => !isOccurred(m, now))
            return group.meetings.map((m, idx) => (
              <React.Fragment key={m.meeting_id}>
                {idx === splitIndex && splitIndex > 0 && <NowDivider />}
                <MeetingRow row={m} now={now} />
              </React.Fragment>
            ))
          })()}
        </div>
      </div>
    </div>
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

function MeetingRow({ row, now }: { row: PlanningEventRow; now: number | null }) {
  const isLive = row.is_in_person
  const occurred = isOccurred(row, now)
  const ready = fullyReady(row)
  return (
    <div
      className={`grid grid-cols-[minmax(180px,1.6fr)_repeat(4,minmax(96px,1fr))] items-center gap-2 border-b border-[#F0F2F6] px-4 py-2.5 last:border-b-0 ${
        occurred ? "bg-[#F6F7F9]" : ""
      }`}
      // Green left-accent (feature #4) whenever every stage is complete, so
      // fully-prepped meetings recede; a transparent border keeps the grid aligned otherwise.
      style={{ borderLeft: `3px solid ${ready ? DONE_GREEN : "transparent"}` }}
    >
      {/* Meeting identity */}
      <div className={`min-w-0 ${occurred ? "opacity-65" : ""}`}>
        <div className="flex items-center gap-1.5">
          <span
            className="truncate text-[13px] font-medium leading-tight"
            style={{ color: NAVY_DEEP }}
            title={row.institution_name || undefined}
          >
            {row.institution_name || "—"}
          </span>
          {/* OCCURRED tag (feature #1): bold navy in a bordered chip. */}
          {occurred && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-[5px] border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{ color: NAVY_DEEP, borderColor: "#C3CBDA", backgroundColor: "#FBFCFE" }}
            >
              <Clock className="size-2.5" strokeWidth={2.5} />
              Occurred
            </span>
          )}
          {/* READY pill (feature #4): on every fully-prepped meeting. Pairs with
              OCCURRED on past rows (when it happened + that it was fully ready)
              and stands alone on upcoming rows. */}
          {ready && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{ color: DONE_GREEN, backgroundColor: "#E7F5EE" }}
            >
              <Check className="size-2.5" strokeWidth={3} />
              Ready
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          {isLive ? (
            <MapPin className="size-3" style={{ color: TEAL }} />
          ) : (
            <Video className="size-3" style={{ color: BRAND_BLUE }} />
          )}
          <span className="tabular-nums">{fmtDay(row.meeting_day)}</span>
          <span>·</span>
          <span className="tabular-nums">{fmtTime(row.meeting_date)}</span>
        </div>
      </div>

      {/* Four stage cells */}
      {STAGES.map((s) => (
        <StageCell key={s.key} done={s.done(row)} value={s.value(row)} dim={occurred} />
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
    <div className={`flex flex-col items-center gap-1 text-center ${dim ? "opacity-70" : ""}`}>
      {done ? (
        <span
          className="flex size-[18px] shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: DONE_GREEN }}
        >
          <Check className="size-3 text-white" strokeWidth={3} />
        </span>
      ) : (
        <span
          className="size-[18px] shrink-0 rounded-full border-2"
          style={{ borderColor: EMPTY_RING }}
        />
      )}
      <span
        className="max-w-full truncate text-[10.5px] leading-tight"
        style={{ color: done ? "#4A5161" : "#9AA1AD" }}
        title={value || undefined}
      >
        {value || "—"}
      </span>
    </div>
  )
}

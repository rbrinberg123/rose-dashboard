"use client"

import * as React from "react"
import { MapPin, Video } from "lucide-react"
import { ListTitleCard } from "@/components/page-masthead"
import {
  BRAND_BLUE,
  CARD_CLASS,
  DAYS_LEFT_PILL,
  PROFILE_STAGE,
  PROFILE_STAGE_FALLBACK,
  TEAL,
} from "@/lib/design"
import type { ProfileUpcomingRow } from "@/lib/types"

const NAVY_DEEP = "#1E2858"
const ALL = "__all__"
const NO_EVENT = "__no_event__" // event dropdown sentinel for meetings with no event

// Small uppercase muted control label — matches the weekday subheaders used on
// this page, applied to every filter control so they read consistently.
const FILTER_LABEL = "text-[11px] font-medium uppercase tracking-wide text-[#9AA1AD]"

// Live / Virtual accent colors — reused from the design-system constants, not
// hardcoded: Live = teal, Virtual = brand blue.
const LIVE_COLOR = TEAL // #1C8C9C
const VIRTUAL_COLOR = BRAND_BLUE // #0355A7

function stageStyle(stage: string) {
  return PROFILE_STAGE[stage] ?? PROFILE_STAGE_FALLBACK
}

// Known stages in pipeline order (New → … → Not Needed).
const STAGE_ORDER = Object.keys(PROFILE_STAGE).sort(
  (a, b) => PROFILE_STAGE[a].order - PROFILE_STAGE[b].order,
)

// meeting_date is stored as a +00 wall clock we read as-is (see the view), so we
// format in UTC to show the stored local time, never shifting zones.
const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  hour: "numeric",
  minute: "2-digit",
})
const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
})
function fmtTime(iso: string): string {
  return TIME_FMT.format(new Date(iso))
}
// "Mon, Jun 23" from a YYYY-MM-DD day string (parsed as a UTC calendar date).
function fmtWeekday(day: string): string {
  const [y, m, d] = day.split("-").map(Number)
  return WEEKDAY_FMT.format(new Date(Date.UTC(y, m - 1, d)))
}
// "Week of 6/23" from a YYYY-MM-DD Monday string.
function fmtWeekOf(monday: string): string {
  const [, m, d] = monday.split("-").map(Number)
  return `Week of ${m}/${String(d).padStart(2, "0")}`
}

// Whole days from `today` to a meeting day, both YYYY-MM-DD UTC calendar dates
// (the board's basis). Clamped at 0 — the board is forward-only, so a meeting is
// never in the past; this just guards the midnight boundary.
function daysUntil(meetingDay: string, today: string): number {
  const ms = Date.parse(meetingDay + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")
  return Math.max(0, Math.round(ms / 86_400_000))
}
// Urgency colors reuse the Portfolio Days-Left palette (DAYS_LEFT_PILL) — one
// source of truth. Meeting thresholds: ≤2d red, 3–6d amber, 7d+ green.
function daysPillStyle(days: number): { bg: string; fg: string } {
  if (days <= 2) return DAYS_LEFT_PILL.red
  if (days <= 6) return DAYS_LEFT_PILL.amber
  return DAYS_LEFT_PILL.green
}

export function ProfilesView({
  rows,
  weekMondays,
  today,
}: {
  rows: ProfileUpcomingRow[]
  weekMondays: string[]
  today: string
}) {
  // Every known stage always gets a toggle (in pipeline order), even when no
  // meeting in the window currently has that stage — so Approved and Not Needed
  // are always visible. Any unexpected stage value in the data is appended last.
  const toggleStages = React.useMemo(() => {
    const present = new Set(rows.map((r) => r.profile_label))
    const extras = Array.from(present).filter((s) => !STAGE_ORDER.includes(s))
    return [...STAGE_ORDER, ...extras]
  }, [rows])

  // Default: every stage ON except "Sent" and "Not Needed" (the two hidden by
  // default).
  const STAGE_OFF_BY_DEFAULT = React.useMemo(() => new Set(["Sent", "Not Needed"]), [])
  const defaultStages = React.useCallback(
    () => new Set(toggleStages.filter((s) => !STAGE_OFF_BY_DEFAULT.has(s))),
    [toggleStages, STAGE_OFF_BY_DEFAULT],
  )

  const [activeStages, setActiveStages] = React.useState<Set<string>>(defaultStages)
  const [client, setClient] = React.useState<string>(ALL)
  const [event, setEvent] = React.useState<string>(ALL)
  const [primaryAM, setPrimaryAM] = React.useState<string>(ALL)
  const [secondaryAM, setSecondaryAM] = React.useState<string>(ALL)

  // Re-seed stage defaults if the present-stage set changes (e.g. data refresh).
  React.useEffect(() => {
    setActiveStages(defaultStages())
  }, [defaultStages])

  // Dropdown option lists — built from the full window so a filtered-away value
  // never disappears from its own control. Clients: only those with a meeting in
  // the window (the view already guarantees that).
  const clientOptions = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) {
      if (r.client_account_id && r.client_account_name) {
        map.set(r.client_account_id, r.client_account_name)
      }
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [rows])

  // Distinct event names present in the window (deduped, sorted). Event names
  // are messy free text, so dedup on the exact value.
  const eventOptions = React.useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.event_name).filter(Boolean) as string[]),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  )
  // Whether any meeting in the window has no event — gates the "No event" option.
  const hasNoEventRows = React.useMemo(() => rows.some((r) => !r.event_name), [rows])

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

  const filtered = React.useMemo(
    () =>
      rows.filter((r) => {
        if (!activeStages.has(r.profile_label)) return false
        if (client !== ALL && r.client_account_id !== client) return false
        if (event === NO_EVENT && r.event_name) return false
        if (event !== ALL && event !== NO_EVENT && r.event_name !== event) return false
        if (primaryAM !== ALL && r.primary_manager_name !== primaryAM) return false
        if (secondaryAM !== ALL && r.secondary_manager_name !== secondaryAM) return false
        return true
      }),
    [rows, activeStages, client, event, primaryAM, secondaryAM],
  )

  // Dormant: this fed the top KPI cards (Upcoming / per-week / Clients) and the
  // distinct-counts caption, both removed from the layout for now. Kept here so
  // the cards are trivial to restore later — re-enable this and the JSX block
  // marked "KPI strip (removed)" below.
  // const summary = React.useMemo(() => {
  //   const weekCounts = [0, 0, 0]
  //   const clients = new Set<string>()
  //   const institutions = new Set<string>()
  //   for (const r of filtered) {
  //     if (r.week_index >= 0 && r.week_index <= 2) weekCounts[r.week_index]++
  //     if (r.client_account_id) clients.add(r.client_account_id)
  //     if (r.institution_name) institutions.add(r.institution_name)
  //   }
  //   return {
  //     total: filtered.length,
  //     weekCounts,
  //     clients: clients.size,
  //     institutions: institutions.size,
  //   }
  // }, [filtered])

  // Is the current filter state different from defaults?
  const defaultActive = defaultStages()
  const stagesAtDefault =
    activeStages.size === defaultActive.size &&
    [...activeStages].every((s) => defaultActive.has(s))
  const hasFilters =
    !stagesAtDefault ||
    client !== ALL ||
    event !== ALL ||
    primaryAM !== ALL ||
    secondaryAM !== ALL

  function toggleStage(stage: string) {
    setActiveStages((prev) => {
      const next = new Set(prev)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return next
    })
  }
  function clearAll() {
    setActiveStages(defaultStages())
    setClient(ALL)
    setEvent(ALL)
    setPrimaryAM(ALL)
    setSecondaryAM(ALL)
  }

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          title="Profiles"
          subtitle="Upcoming meetings by profile pipeline stage — the next three business weeks."
        />
      </div>

      {/* KPI strip (removed) — the Upcoming / per-week / Clients cards and the
          distinct-counts caption were here. See the dormant `summary` memo above
          to restore them. */}

      {/* Top filters: client + both account managers, Clear pinned right. */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="profiles-client" className={FILTER_LABEL}>
            Client
          </label>
          <select
            id="profiles-client"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            className="h-9 max-w-[260px] rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value={ALL}>All</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="profiles-event" className={FILTER_LABEL}>
            Event
          </label>
          <select
            id="profiles-event"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            className="h-9 max-w-[260px] rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value={ALL}>All</option>
            {eventOptions.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
            {hasNoEventRows && <option value={NO_EVENT}>No event</option>}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="profiles-primary-am" className={FILTER_LABEL}>
            Primary AM
          </label>
          <select
            id="profiles-primary-am"
            value={primaryAM}
            onChange={(e) => setPrimaryAM(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
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
          <label htmlFor="profiles-secondary-am" className={FILTER_LABEL}>
            Secondary AM
          </label>
          <select
            id="profiles-secondary-am"
            value={secondaryAM}
            onChange={(e) => setSecondaryAM(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value={ALL}>All</option>
            {secondaryOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto h-9 cursor-pointer rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Stage multi-select — pill-in-tray segmented control matching the
          Account Management filter exactly (navy-filled active pills), but
          multi-select: several pills can be navy at once. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={FILTER_LABEL}>Stages</span>
        <div
          className="flex h-9 items-center rounded-md bg-card p-0.5"
          style={{ border: "0.5px solid var(--border)" }}
        >
          {toggleStages.map((stage) => {
            const active = activeStages.has(stage)
            return (
              <button
                key={stage}
                type="button"
                onClick={() => toggleStage(stage)}
                aria-pressed={active}
                className={
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
                  (active ? "bg-[#1E2858] text-white" : "text-foreground hover:bg-slate-50")
                }
              >
                {stage}
              </button>
            )
          })}
        </div>
      </div>

      <Legend />

      {/* Board: three fixed business-week columns. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {weekMondays.map((monday, wi) => {
          const items = filtered.filter((r) => r.week_index === wi)
          return <WeekColumn key={monday} monday={monday} items={items} today={today} />
        })}
      </div>
    </>
  )
}

// One business-week column: header + day-grouped cards.
function WeekColumn({
  monday,
  items,
  today,
}: {
  monday: string
  items: ProfileUpcomingRow[]
  today: string
}) {
  // Group by calendar day, ordered; cards within a day sorted by time.
  const days = React.useMemo(() => {
    const map = new Map<string, ProfileUpcomingRow[]>()
    for (const r of items) {
      const arr = map.get(r.meeting_day)
      if (arr) arr.push(r)
      else map.set(r.meeting_day, [r])
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, rs]) => ({
        day,
        rows: rs.sort((a, b) => a.meeting_date.localeCompare(b.meeting_date)),
      }))
  }, [items])

  return (
    <div className={`flex flex-col overflow-hidden ${CARD_CLASS}`}>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <span className="text-sm font-semibold" style={{ color: NAVY_DEEP }}>
          {fmtWeekOf(monday)}
        </span>
        <span className="inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full bg-[#1E2858] px-2 text-[13px] font-semibold tabular-nums text-white">
          {items.length}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-2">
        {days.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-muted-foreground">
            No meetings
          </div>
        ) : (
          days.map(({ day, rows }) => (
            <div key={day}>
              <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-[#9AA1AD]">
                {fmtWeekday(day)}
              </div>
              <div className="flex flex-col gap-1.5">
                {rows.map((r) => (
                  <MeetingCard key={r.meeting_id} row={r} today={today} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// One meeting card. Three independent signals, kept visually separate:
//   • mode    — Live/Virtual left border accent (teal/blue)
//   • urgency — days-to-meeting pill, top-right (red/amber/green)
//   • stage   — profile-stage tag, bottom-right
function MeetingCard({ row, today }: { row: ProfileUpcomingRow; today: string }) {
  const sty = stageStyle(row.profile_label)
  const isLive = row.is_in_person
  const accent = isLive ? LIVE_COLOR : VIRTUAL_COLOR
  const days = daysUntil(row.meeting_day, today)
  const daysPill = daysPillStyle(days)
  return (
    <div
      className="rounded-md border border-[#EDEFF3] bg-white px-2.5 py-1.5 shadow-sm"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="min-w-0 flex-1 truncate text-sm font-medium leading-tight"
          style={{ color: NAVY_DEEP }}
          title={row.institution_name || undefined}
        >
          {row.institution_name || "—"}
        </div>
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums"
          style={{ backgroundColor: daysPill.bg, color: daysPill.fg }}
          title={`${days} day${days === 1 ? "" : "s"} until meeting`}
        >
          {days}d
        </span>
      </div>
      <div className="mt-0.5 truncate text-xs leading-tight text-muted-foreground" title={row.client_account_name || undefined}>
        {row.client_account_name || "—"}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs tabular-nums text-[#5B6472]">
          {isLive ? (
            <MapPin className="size-3" style={{ color: accent }} />
          ) : (
            <Video className="size-3" style={{ color: accent }} />
          )}
          {fmtTime(row.meeting_date)}
          <span style={{ color: accent }}>· {isLive ? "Live" : "Virtual"}</span>
        </span>
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: sty.bg, color: sty.text }}
        >
          {row.profile_label}
        </span>
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className={`mb-3 p-3 ${CARD_CLASS}`}>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        {STAGE_ORDER.map((stage) => {
          const sty = stageStyle(stage)
          return (
            <span key={stage} className="flex items-center gap-1.5">
              <span
                className="inline-block size-3 rounded-full"
                style={{ backgroundColor: sty.bg, border: `1px solid ${sty.text}` }}
              />
              {stage}
            </span>
          )
        })}
        <span className="flex items-center gap-1.5" style={{ color: LIVE_COLOR }}>
          <MapPin className="size-4" />
          Live
        </span>
        <span className="flex items-center gap-1.5" style={{ color: VIRTUAL_COLOR }}>
          <Video className="size-4" />
          Virtual
        </span>
      </div>
    </div>
  )
}

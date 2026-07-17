"use client"

import * as React from "react"
import Link from "next/link"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { ListTitleCard } from "@/components/page-masthead"
import { initialsOf } from "@/components/account-team-avatars"
import { CARD_CLASS } from "@/lib/design"
import type { RelationshipPerson, RelationshipRow } from "@/lib/types"

// Brand palette (same tokens the Institution Summary page draws from).
const NAVY_DEEP = "#1E2858"
const SOFT_BG = "#F8F9FB"
// Uppercase micro-label above each control — same treatment as Planning V2.
const FILTER_LABEL = "text-[11px] font-medium uppercase tracking-wide text-[#9AA1AD]"

// Hosts vs bookers are visually distinguished by color: hosts read blue,
// bookers read teal. Each role has a soft pill fill + text color, a solid
// avatar-dot color, and the verb used in the tooltip.
const HOST = { verb: "hosted", pillBg: "#E9F0FA", pillFg: "#0355A7", dotBg: "#0355A7" }
const BOOKER = { verb: "booked", pillBg: "#E2F2F4", pillFg: "#146575", dotBg: "#1C8C9C" }
type RoleStyle = typeof HOST

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")

type WindowKey = "ltm" | "all"

// First-letter bucket for the A-Z grouping. Anything not A-Z falls under "#".
function bucketOf(name: string): string {
  const c = name.trim()[0]?.toUpperCase()
  return c && c >= "A" && c <= "Z" ? c : "#"
}

// --- Week helpers (Monday-anchored, matching Planning V2 / Scheduler) --------
// Work in 'YYYY-MM-DD' strings so comparisons line up with meeting_weeks (the
// Monday dates the view emits). Dates are built in local time to avoid UTC
// off-by-one when parsing a bare date string.
function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const da = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${da}`
}
function mondayOfToday(): string {
  const d = new Date()
  const dow = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow)
  return ymd(d)
}
function addDaysYmd(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number)
  return ymd(new Date(y, m - 1, d + n))
}
// Compact "M/D/YY" for the Next Meeting Date column.
function fmtMDY(s: string): string {
  const [y, m, d] = s.split("-").map(Number)
  return `${m}/${d}/${String(y).slice(2)}`
}
// "Jul 13 – Jul 19" — the Mon–Sun range for a Monday-anchored week, matching the
// Planning V2 week stepper's display.
function fmtRangeShort(mondayYmd: string): string {
  const f = (s: string) => {
    const [y, m, d] = s.split("-").map(Number)
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }
  return `${f(mondayYmd)} – ${f(addDaysYmd(mondayYmd, 6))}`
}

// One person as a rounded pill: small initials avatar + their %. Hovering shows
// the full name and the underlying counts via the native title tooltip, e.g.
// "Brian Smith — hosted 6 of 12 (50%)". `total` is the institution's meeting
// count in the SAME window as `person.count`, so the "X of Y" always matches
// the displayed %.
function Pill({
  person,
  total,
  role,
}: {
  person: RelationshipPerson
  total: number
  role: RoleStyle
}) {
  const tip = `${person.name} — ${role.verb} ${person.count.toLocaleString()} of ${total.toLocaleString()} (${person.pct}%)`
  return (
    <span
      title={tip}
      className="inline-flex cursor-default items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2"
      style={{ backgroundColor: role.pillBg, color: role.pillFg }}
    >
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded-full text-white"
        style={{
          width: 18,
          height: 18,
          fontSize: "8px",
          fontWeight: 700,
          lineHeight: 1,
          backgroundColor: role.dotBg,
        }}
      >
        {initialsOf(person.name)}
      </span>
      <span className="text-xs font-semibold tabular-nums">{person.pct}%</span>
    </span>
  )
}

// A "Top hosts" or "Top bookers" cell — up to 4 wrapping pills, or an em-dash.
function PeopleColumn({
  people,
  total,
  role,
}: {
  people: RelationshipPerson[]
  total: number
  role: RoleStyle
}) {
  if (!people || people.length === 0) {
    return <div className="text-xs text-muted-foreground">—</div>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {people.map((p) => (
        <Pill key={p.name} person={p} total={total} role={role} />
      ))}
    </div>
  )
}

export function RelationshipsView({ rows }: { rows: RelationshipRow[] }) {
  const [win, setWin] = React.useState<WindowKey>("all")
  const [search, setSearch] = React.useState("")
  // "Week of X" row filter — off by default; when on, only institutions with a
  // confirmed meeting in the selected Monday-anchored week show. It narrows the
  // visible rows only; the host/booker percentages stay on the LTM/All-time
  // basis (win) above.
  const [weekOn, setWeekOn] = React.useState(false)
  const [weekMonday, setWeekMonday] = React.useState<string>(() => mondayOfToday())

  // Filter pipeline: window (LTM hides institutions with no recent meetings) →
  // week → search. Rows arrive already sorted by institution_name from the view.
  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (win === "ltm" && r.total_meetings_ltm <= 0) return false
      if (weekOn && !(r.meeting_weeks ?? []).includes(weekMonday)) return false
      if (term && !r.institution_name.toLowerCase().includes(term)) return false
      return true
    })
  }, [rows, win, search, weekOn, weekMonday])

  // Group the filtered rows into A-Z (and "#") buckets, preserving name order.
  const groups = React.useMemo(() => {
    const map = new Map<string, RelationshipRow[]>()
    for (const r of filtered) {
      const b = bucketOf(r.institution_name)
      const arr = map.get(b)
      if (arr) arr.push(r)
      else map.set(b, [r])
    }
    return map
  }, [filtered])

  const hasHash = groups.has("#")
  const railKeys = hasHash ? [...LETTERS, "#"] : LETTERS

  const jumpTo = (key: string) => {
    const el = document.getElementById(`rel-${key}`)
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const total = rows.length
  // Next-meeting emphasis: highlight if it falls in the current week (today
  // through this Sunday). ISO 'YYYY-MM-DD' strings compare lexicographically.
  const thisSunday = addDaysYmd(mondayOfToday(), 6)

  return (
    <>
      {/* Masthead */}
      <div className="mb-4">
        <ListTitleCard
          title="Relationships"
          subtitle={`Strongest hosting & booking coverage per institution · ${filtered.length.toLocaleString()} of ${total.toLocaleString()} shown`}
        />
      </div>

      {/* Unified controls bar: time window · week filter · search. Each control
          is labelled above with the same cap as the Planning V2 filter bar. */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        {/* Time window (LTM / All-time) */}
        <div className="flex flex-col gap-1">
          <span className={FILTER_LABEL}>Time window</span>
          <div
            className="inline-flex h-9 items-center rounded-md border border-input bg-background p-0.5"
            role="group"
            aria-label="Time window"
          >
            {([
              { key: "ltm", label: "Last 12 mo" },
              { key: "all", label: "All-time" },
            ] as const).map(({ key, label }) => {
              const active = win === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setWin(key)}
                  className={
                    "h-8 rounded px-3 text-sm font-medium transition-colors " +
                    (active ? "text-white" : "text-[#5B6472] hover:text-[#1E2858]")
                  }
                  style={active ? { backgroundColor: NAVY_DEEP } : undefined}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Week filter — off by default; narrows to institutions with a confirmed
            meeting that Monday-anchored week. Percentages stay on the window
            basis above. Stepper matches the Planning V2 treatment. */}
        <div className="flex flex-col gap-1">
          <span className={FILTER_LABEL}>Week</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWeekOn((v) => !v)}
              aria-pressed={weekOn}
              className={
                "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors " +
                (weekOn
                  ? "border-[#1E2858] bg-[#1E2858] text-white"
                  : "border-input bg-background text-foreground hover:bg-slate-50")
              }
            >
              <CalendarDays className="size-4" />
              {weekOn ? "Week filter on" : "Filter by week"}
            </button>
            {weekOn && (
              <>
                <div className="flex h-9 items-center gap-1 rounded-md border border-input bg-background px-1">
                  <button
                    type="button"
                    aria-label="Previous week"
                    onClick={() => setWeekMonday((w) => addDaysYmd(w, -7))}
                    className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-slate-50 hover:text-foreground"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <span
                    className="min-w-[140px] text-center text-sm font-medium tabular-nums"
                    style={{ color: NAVY_DEEP }}
                  >
                    {fmtRangeShort(weekMonday)}
                  </span>
                  <button
                    type="button"
                    aria-label="Next week"
                    onClick={() => setWeekMonday((w) => addDaysYmd(w, 7))}
                    className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-slate-50 hover:text-foreground"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
                {weekMonday !== mondayOfToday() && (
                  <button
                    type="button"
                    onClick={() => setWeekMonday(mondayOfToday())}
                    className="text-sm font-medium text-[#0355A7] hover:underline"
                  >
                    This week
                  </button>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {filtered.length.toLocaleString()}{" "}
                  {filtered.length === 1 ? "institution" : "institutions"}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="ml-auto flex flex-col gap-1">
          <span className={FILTER_LABEL}>Search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search institutions..."
            className="h-9 w-56 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#1E2858]"
            aria-label="Search institutions"
          />
        </div>
      </div>

      {/* Legend */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: HOST.dotBg }} />
          Hosts
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BOOKER.dotBg }} />
          Bookers
        </span>
        <span className="text-xs text-muted-foreground">
          % = share of the institution&apos;s meetings
        </span>
      </div>

      {/* A-Z jump index — click a letter to scroll to it; empty letters disabled */}
      <div
        className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-1 rounded-md p-2"
        style={{ backgroundColor: SOFT_BG }}
      >
        {railKeys.map((L) => {
          const available = groups.has(L)
          if (!available) {
            return (
              <span
                key={L}
                aria-disabled="true"
                className="cursor-not-allowed rounded px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {L}
              </span>
            )
          }
          return (
            <button
              key={L}
              type="button"
              onClick={() => jumpTo(L)}
              className="rounded bg-transparent px-2 py-0.5 text-xs font-medium hover:bg-white"
              style={{ color: NAVY_DEEP }}
            >
              {L}
            </button>
          )
        })}
      </div>

      {/* Grouped list */}
      <div className={CARD_CLASS}>
        {/* Column header row */}
        <div className="hidden items-center gap-4 border-b bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[minmax(180px,1fr)_1fr_1fr_minmax(84px,auto)]">
          {/* Two-part header: "Meetings" right-aligns above the inline count. */}
          <div className="flex items-baseline justify-between gap-3">
            <span>Institution</span>
            <span>Meetings</span>
          </div>
          <div>Top hosts</div>
          <div>Top bookers</div>
          <div className="text-right">Next Mtg</div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No institutions match your search.
          </div>
        ) : (
          railKeys
            .filter((L) => groups.has(L))
            .map((L) => (
              <section key={L} id={`rel-${L}`} style={{ scrollMarginTop: 56 }}>
                {/* Sticky letter header */}
                <div
                  className="sticky top-12 z-[5] border-y bg-slate-50/95 px-4 py-1 text-xs font-bold backdrop-blur"
                  style={{ color: NAVY_DEEP }}
                >
                  {L}
                </div>
                {groups.get(L)!.map((r) => {
                  const totalMeetings =
                    win === "ltm" ? r.total_meetings_ltm : r.total_meetings_all
                  const hosts = win === "ltm" ? r.top_hosts_ltm : r.top_hosts_all
                  const bookers = win === "ltm" ? r.top_bookers_ltm : r.top_bookers_all
                  // Pill % denominators exclude system accounts (per-role), so the
                  // tooltip "X of Y" matches the displayed %. This differs from the
                  // "N mtgs" count above, which is the institution's total meetings.
                  const hostDenom = win === "ltm" ? r.host_denom_ltm : r.host_denom_all
                  const bookerDenom = win === "ltm" ? r.booker_denom_ltm : r.booker_denom_all
                  const detailHref = r.institution_id
                    ? `/institution-detail?institution_id=${r.institution_id}`
                    : "/institution-detail"
                  return (
                    <div
                      key={r.institution_name}
                      className="grid grid-cols-1 gap-3 border-b px-4 py-3 last:border-0 md:grid-cols-[minmax(180px,1fr)_1fr_1fr_minmax(84px,auto)] md:gap-4"
                    >
                      {/* Institution name + meeting count on one line — name
                          truncates, count sits right-aligned. Window is conveyed
                          by the toggle (and the pill tooltips). */}
                      <div className="flex min-w-0 items-baseline justify-between gap-3">
                        <Link
                          href={detailHref}
                          className="truncate font-medium hover:underline"
                          style={{ color: NAVY_DEEP }}
                        >
                          {r.institution_name}
                        </Link>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {totalMeetings.toLocaleString()}{" "}
                          {totalMeetings === 1 ? "mtg" : "mtgs"}
                        </span>
                      </div>
                      {/* Top hosts */}
                      <div>
                        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground md:hidden">
                          Top hosts
                        </div>
                        <PeopleColumn people={hosts} total={hostDenom} role={HOST} />
                      </div>
                      {/* Top bookers */}
                      <div>
                        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground md:hidden">
                          Top bookers
                        </div>
                        <PeopleColumn people={bookers} total={bookerDenom} role={BOOKER} />
                      </div>
                      {/* Next meeting date — forward-looking, unaffected by the
                          LTM/All-time window. Highlighted if it's this week. */}
                      <div className="md:text-right">
                        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground md:hidden">
                          Next meeting
                        </div>
                        {r.next_meeting_date ? (
                          r.next_meeting_date <= thisSunday ? (
                            <span
                              title="Meeting this week"
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
                              style={{ backgroundColor: "#EEF2FB", color: "#2D4A8A" }}
                            >
                              {fmtMDY(r.next_meeting_date)}
                            </span>
                          ) : (
                            <span className="text-xs tabular-nums text-foreground">
                              {fmtMDY(r.next_meeting_date)}
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </section>
            ))
        )}
      </div>
    </>
  )
}

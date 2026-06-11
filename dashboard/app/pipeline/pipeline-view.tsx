"use client"

import * as React from "react"
import { ArrowUp, Users } from "lucide-react"
import { GradientHero } from "@/components/gradient-hero"
import { StatCard } from "@/components/stat-card"
import { PIPELINE_CARD_GRADIENTS } from "@/lib/gradients"
import type { Pipeline30dRow, SchedulerMeetingRow } from "@/lib/types"

// Type-pill palette. Metric-card accents reuse the same hues inline below.
const TYPE_PILL = {
  virtual: { bg: "#E6F1FB", text: "#185FA5" },
  inperson: { bg: "#EAF3DE", text: "#3B6D11" },
  call: { bg: "#F1EFE8", text: "#5F5E5A" },
} as const

// Faint warm tint so unassigned (host-less) rows stand out in the table.
const UNASSIGNED_TINT = "#FCF8F2"

// ---------------------------------------------------------------------------
// Duration / occupied-interval model — identical to the Scheduler. Every
// meeting's core is 1h from start; in-person adds a 45m travel buffer each side.
// Used to detect host conflicts when suggesting a host for an unassigned
// pipeline meeting.
// ---------------------------------------------------------------------------
const BUFFER = 45
const CORE = 60

type Interval = { start: number; end: number }

function occFrom(startMinutes: number, isInPerson: boolean): Interval {
  if (isInPerson) {
    return { start: startMinutes - BUFFER, end: startMinutes + CORE + BUFFER }
  }
  return { start: startMinutes, end: startMinutes + CORE }
}
function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

// 840 -> "2pm", 870 -> "2:30pm". Matches the Scheduler's formatting.
function fmtTime(min: number): string {
  const h = (((Math.floor(min / 60) % 24) + 24) % 24)
  const m = ((min % 60) + 60) % 60
  const period = h < 12 ? "am" : "pm"
  let h12 = h % 12
  if (h12 === 0) h12 = 12
  const mm = m === 0 ? "" : ":" + String(m).padStart(2, "0")
  return `${h12}${mm}${period}`
}

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// A pipeline meeting's start time + calendar day on the SAME stored-wall-clock
// basis as v_scheduler_meetings (read via AT TIME ZONE 'UTC'), so occupied
// intervals line up with hosted meetings for the conflict check. We therefore
// read the UTC components of the timestamp rather than the browser's local zone.
function startMinutesOf(iso: string): number {
  const d = new Date(iso)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}
function meetingDayOf(iso: string): string {
  const d = new Date(iso)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// Wall-clock date for display ("Mon D, YYYY"), read in UTC to match the stored
// digits and the time we derive above.
const WALL_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
})
function fmtWallDate(iso: string): string {
  return WALL_DATE_FMT.format(new Date(iso))
}

// ---------------------------------------------------------------------------
// Host suggestion for one unassigned pipeline meeting — same approach and exact
// wording as the Scheduler's unassigned-meetings section.
// ---------------------------------------------------------------------------
type Suggestion = {
  noPrior: boolean
  suggestedName: string | null
  rationale: string | null
  bumpNote: string | null
}

type Affinity = {
  hostName: Map<string, string>
  instHost: Map<string, Map<string, number>>
  clientHost: Map<string, Map<string, number>>
  instTotal: Map<string, number>
  clientTotal: Map<string, number>
  hostDay: Map<string, Map<string, Interval[]>>
}

function buildAffinity(meetings: SchedulerMeetingRow[]): Affinity {
  const hostName = new Map<string, string>()
  const instHost = new Map<string, Map<string, number>>()
  const clientHost = new Map<string, Map<string, number>>()
  const instTotal = new Map<string, number>()
  const clientTotal = new Map<string, number>()
  const hostDay = new Map<string, Map<string, Interval[]>>()

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
    if (arr) arr.push(occFrom(m.start_minutes, m.is_in_person))
    else days.set(m.meeting_day, [occFrom(m.start_minutes, m.is_in_person)])
  }
  return { hostName, instHost, clientHost, instTotal, clientTotal, hostDay }
}

function suggestHost(
  row: Pipeline30dRow,
  affinity: Affinity,
  l12mByHost: Map<string, number>,
): Suggestion {
  const startMinutes = startMinutesOf(row.meeting_date)
  const day = meetingDayOf(row.meeting_date)
  const occ = occFrom(startMinutes, row.is_in_person === true)
  const inst = row.institution_name
  const client = row.client_account_name
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
    const ivs = affinity.hostDay.get(id)?.get(day)
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

  const bumpNote =
    top && (!suggested || suggested.id !== top.id)
      ? `${top.name} usually hosts (${topPrimaryN}) but is busy at ${fmtTime(startMinutes)}`
      : null

  return {
    noPrior: candidates.length === 0,
    suggestedName: suggested ? suggested.name : null,
    rationale: suggested ? rationaleFor(suggested) : null,
    bumpNote,
  }
}

// ---------------------------------------------------------------------------
// Type pill: friendly in-person / virtual wording driven by is_in_person, with
// a gray "Call" for phone/call meeting types. (Swap to the raw
// meeting_type_label here if you'd rather show the CRM's exact label.)
// ---------------------------------------------------------------------------
function isCallType(label: string | null): boolean {
  if (!label) return false
  return /call|phone|dial/i.test(label)
}
function TypePill({ row }: { row: Pipeline30dRow }) {
  let style: { bg: string; text: string } = TYPE_PILL.virtual
  let text = "Virtual"
  if (row.is_in_person === true) {
    style = TYPE_PILL.inperson
    text = "In-person"
  } else if (isCallType(row.meeting_type_label)) {
    style = TYPE_PILL.call
    text = "Call"
  }
  return (
    <span
      className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: style.bg, color: style.text }}
      title={row.meeting_type_label || undefined}
    >
      {text}
    </span>
  )
}

// Shared, fixed column geometry so every row lines up; the container scrolls
// horizontally on narrow widths rather than cramming.
const TABLE_COLS = [
  "150px", // When
  "64px", // Days
  "190px", // Client
  "190px", // Institution
  "190px", // Investor
  "104px", // Type
  "140px", // Booker
  "280px", // Host
]
const TABLE_MIN_WIDTH = TABLE_COLS.reduce((s, w) => s + parseInt(w, 10), 0)

const ALL_TYPES = "__all__"

export function PipelineView({
  rows,
  hosted,
}: {
  rows: Pipeline30dRow[]
  hosted: SchedulerMeetingRow[]
}) {
  // ---- Firm-wide summary (static, over all loaded rows) -------------------
  const summary = React.useMemo(() => {
    let unassigned = 0
    let virtual = 0
    let inPerson = 0
    let next7 = 0
    const clients = new Set<string>()
    const institutions = new Set<string>()
    for (const r of rows) {
      if (!r.host_id) unassigned++
      if (r.is_in_person === false) virtual++
      if (r.is_in_person === true) inPerson++
      if (r.days_until <= 7) next7++
      if (r.client_account_id) clients.add(r.client_account_id)
      if (r.institution_name) institutions.add(r.institution_name)
    }
    return {
      total: rows.length,
      unassigned,
      virtual,
      inPerson,
      next7,
      clients: clients.size,
      institutions: institutions.size,
    }
  }, [rows])

  // ---- Host-suggestion inputs (built once from hosted meetings) -----------
  const affinity = React.useMemo(() => buildAffinity(hosted), [hosted])
  const l12mByHost = React.useMemo(() => {
    const today = new Date()
    const cutoff = ymd(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()))
    const map = new Map<string, number>()
    for (const m of hosted) {
      if (m.meeting_day >= cutoff) map.set(m.host_id, (map.get(m.host_id) ?? 0) + 1)
    }
    return map
  }, [hosted])

  // One suggestion per unassigned pipeline meeting, keyed by meeting_id.
  const suggestions = React.useMemo(() => {
    const map = new Map<string, Suggestion>()
    for (const r of rows) {
      if (!r.host_id) map.set(r.meeting_id, suggestHost(r, affinity, l12mByHost))
    }
    return map
  }, [rows, affinity, l12mByHost])

  // ---- Filters ------------------------------------------------------------
  const [search, setSearch] = React.useState("")
  const [type, setType] = React.useState(ALL_TYPES)
  const [unassignedOnly, setUnassignedOnly] = React.useState(false)

  // Meeting-type options, derived from the data (never hardcoded).
  const typeOptions = React.useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.meeting_type_label) set.add(r.meeting_type_label)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (unassignedOnly && r.host_id) return false
      if (type !== ALL_TYPES && r.meeting_type_label !== type) return false
      if (q) {
        const hay = `${r.client_account_name ?? ""} ${r.institution_name ?? ""} ${r.investor_text ?? ""} ${r.host_name ?? ""} ${r.booker_name ?? ""}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, type, unassignedOnly])

  const selectClass = "h-9 rounded-md border border-border bg-card px-2 text-sm"

  return (
    <>
      {/* Gradient hero band — title only (firm-wide list page) */}
      <div className="mb-4">
        <GradientHero title="Upcoming Meetings" subtitle="Next 30 days" />
      </div>

      {/* Summary strip — firm-wide, static across filters. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Upcoming"
          value={summary.total}
          gradient={PIPELINE_CARD_GRADIENTS.upcoming}
        />
        <StatCard
          label="Unassigned"
          value={summary.unassigned}
          valueColor="#854F0B"
          gradient={PIPELINE_CARD_GRADIENTS.unassigned}
        />
        <StatCard
          label="Virtual"
          value={summary.virtual}
          valueColor="#185FA5"
          gradient={PIPELINE_CARD_GRADIENTS.virtual}
        />
        <StatCard
          label="In-person"
          value={summary.inPerson}
          valueColor="#3B6D11"
          gradient={PIPELINE_CARD_GRADIENTS.inPerson}
        />
        <StatCard
          label="Next 7 days"
          value={summary.next7}
          gradient={PIPELINE_CARD_GRADIENTS.next7}
        />
      </div>

      <p className="mb-5 text-xs text-muted-foreground">
        Across {summary.clients} {summary.clients === 1 ? "client" : "clients"} ·{" "}
        {summary.institutions} {summary.institutions === 1 ? "institution" : "institutions"}
      </p>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search client, investor, host, booker"
          className={selectClass + " min-w-56 flex-1 sm:max-w-xs"}
          aria-label="Search"
        />

        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className={selectClass}
          aria-label="Meeting type"
        >
          <option value={ALL_TYPES}>All meeting types</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <label className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm">
          <input
            type="checkbox"
            checked={unassignedOnly}
            onChange={(e) => setUnassignedOnly(e.target.checked)}
            className="size-4"
          />
          Unassigned only
        </label>

        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} meetings
        </span>
      </div>

      <Legend />

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full table-fixed text-sm" style={{ minWidth: TABLE_MIN_WIDTH }}>
          <colgroup>
            {TABLE_COLS.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">When</th>
              <th className="px-3 py-2 text-right font-medium">Days</th>
              <th className="px-3 py-2 text-left font-medium">Client</th>
              <th className="px-3 py-2 text-left font-medium">Institution</th>
              <th className="px-3 py-2 text-left font-medium">Investor</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Booker</th>
              <th className="px-3 py-2 text-left font-medium">Host</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={TABLE_COLS.length} className="h-32 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "No meetings scheduled in the next 30 days."
                    : "No meetings match the current filters."}
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const unassigned = !r.host_id
                return (
                  <tr
                    key={r.meeting_id}
                    className="border-b last:border-0 align-top"
                    style={unassigned ? { backgroundColor: UNASSIGNED_TINT } : undefined}
                  >
                    {/* When */}
                    <td className="px-3 py-2.5">
                      <div className="tabular-nums">{fmtWallDate(r.meeting_date)}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {fmtTime(startMinutesOf(r.meeting_date))}
                      </div>
                    </td>
                    {/* Days */}
                    <td className="px-3 py-2.5 text-right">
                      <DaysCell days={r.days_until} />
                    </td>
                    {/* Client (+ group-meeting flag) */}
                    <td className="truncate px-3 py-2.5" title={r.client_account_name || undefined}>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-foreground">
                          {r.client_account_name || "—"}
                        </span>
                        {r.group_meeting && (
                          <span
                            title="Group meeting"
                            aria-label="Group meeting"
                            className="inline-flex shrink-0 text-muted-foreground"
                          >
                            <Users className="size-4" />
                          </span>
                        )}
                      </span>
                    </td>
                    {/* Institution */}
                    <td className="truncate px-3 py-2.5" title={r.institution_name || undefined}>
                      {r.institution_name || "—"}
                    </td>
                    {/* Investor */}
                    <td className="truncate px-3 py-2.5" title={r.investor_text || undefined}>
                      {r.investor_text || "—"}
                    </td>
                    {/* Type */}
                    <td className="px-3 py-2.5">
                      <TypePill row={r} />
                    </td>
                    {/* Booker */}
                    <td className="truncate px-3 py-2.5" title={r.booker_name || undefined}>
                      {r.booker_name || "—"}
                    </td>
                    {/* Host (or suggestion for unassigned) */}
                    <td className="px-3 py-2.5">
                      {unassigned ? (
                        <HostSuggestionCell suggestion={suggestions.get(r.meeting_id)} />
                      ) : (
                        <span className="truncate">{r.host_name || "—"}</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

// Days until the meeting: "today" highlighted at 0, amber at 1–3, muted beyond.
function DaysCell({ days }: { days: number }) {
  if (days === 0) {
    return <span className="font-medium text-foreground">today</span>
  }
  const cls = days <= 3 ? "text-amber-700" : "text-muted-foreground"
  return <span className={"tabular-nums " + cls}>{days}</span>
}

// The Host cell for an unassigned meeting — suggested host + "free" pill +
// rationale, with the amber "usually hosts… but is busy" note, plus a
// non-functional "Assign host" placeholder button. Mirrors the Scheduler.
function HostSuggestionCell({ suggestion }: { suggestion: Suggestion | undefined }) {
  return (
    <div className="flex flex-col gap-1.5">
      {!suggestion || suggestion.noPrior ? (
        <span className="text-sm italic text-muted-foreground">
          No prior host — assign manually.
        </span>
      ) : suggestion.suggestedName ? (
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{suggestion.suggestedName}</span>
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              free
            </span>
          </div>
          {suggestion.rationale && (
            <div className="text-xs text-muted-foreground">{suggestion.rationale}</div>
          )}
          {suggestion.bumpNote && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-600">
              <ArrowUp className="size-3 shrink-0" />
              {suggestion.bumpNote}
            </div>
          )}
        </div>
      ) : (
        <div>
          <span className="text-sm italic text-muted-foreground">
            No free usual host — assign manually.
          </span>
          {suggestion.bumpNote && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-600">
              <ArrowUp className="size-3 shrink-0" />
              {suggestion.bumpNote}
            </div>
          )}
        </div>
      )}

      {/* Placeholder only — this dashboard is read-only against the mirrored
          CRM, so this does not write a host back to Dynamics yet. */}
      <button
        type="button"
        className="w-fit rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground hover:bg-slate-50"
      >
        Assign host
      </button>
    </div>
  )
}

function Legend() {
  return (
    <div className="mb-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-full"
            style={{ backgroundColor: TYPE_PILL.virtual.bg, border: `1px solid ${TYPE_PILL.virtual.text}` }}
          />
          Virtual
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-full"
            style={{ backgroundColor: TYPE_PILL.inperson.bg, border: `1px solid ${TYPE_PILL.inperson.text}` }}
          />
          In-person
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="size-4" />
          Group meeting
        </span>
      </div>
    </div>
  )
}


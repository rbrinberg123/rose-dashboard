"use client"

import * as React from "react"
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Search, Star, Users } from "lucide-react"
import { GradientHero } from "@/components/gradient-hero"
import { StatCard } from "@/components/stat-card"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { PIPELINE_CARD_GRADIENTS } from "@/lib/gradients"
import { cn } from "@/lib/utils"
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
// One ranked host option for an unassigned meeting.
type Candidate = {
  id: string
  name: string
  instCount: number
  clientCount: number
  l12m: number
  free: boolean
  rationale: string | null
}

// The full analysis for one unassigned meeting: every history candidate ranked
// free-first, the smart-default id (top of that list), and the bump note shown
// when the single most-historical host was skipped for being busy.
type HostPick = {
  noPrior: boolean
  candidates: Candidate[]
  defaultId: string | null
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

// Is `hostId` busy at this meeting's date/time? Same occupied-interval model as
// the Scheduler, evaluated against the already-loaded hosted meetings. Works for
// any host (history candidate or an arbitrary roster pick from search).
function isHostBusy(
  affinity: Affinity,
  row: Pipeline30dRow,
  hostId: string,
): boolean {
  const day = meetingDayOf(row.meeting_date)
  const occ = occFrom(startMinutesOf(row.meeting_date), row.is_in_person === true)
  const ivs = affinity.hostDay.get(hostId)?.get(day)
  return ivs ? ivs.some((iv) => intervalsOverlap(iv, occ)) : false
}

function analyzeHost(
  row: Pipeline30dRow,
  affinity: Affinity,
  l12mByHost: Map<string, number>,
): HostPick {
  const startMinutes = startMinutesOf(row.meeting_date)
  const inst = row.institution_name
  const client = row.client_account_name
  const instMap = inst ? affinity.instHost.get(inst) : undefined
  const clientMap = client ? affinity.clientHost.get(client) : undefined

  // Candidate pool = any host who has hosted this institution OR this client.
  const candidateIds = new Set<string>()
  if (instMap) for (const id of instMap.keys()) candidateIds.add(id)
  if (clientMap) for (const id of clientMap.keys()) candidateIds.add(id)

  const rationaleFor = (instCount: number, clientCount: number): string | null => {
    if (instCount > 0 && inst) {
      return `hosts ${instCount} of ${affinity.instTotal.get(inst) ?? instCount} ${inst} meetings`
    }
    if (clientCount > 0 && client) {
      return `hosts ${clientCount} of ${affinity.clientTotal.get(client) ?? clientCount} ${client} meetings`
    }
    return null
  }

  const base: Candidate[] = Array.from(candidateIds).map((id) => {
    const instCount = instMap?.get(id) ?? 0
    const clientCount = clientMap?.get(id) ?? 0
    return {
      id,
      name: affinity.hostName.get(id) ?? "—",
      instCount,
      clientCount,
      l12m: l12mByHost.get(id) ?? 0,
      free: !isHostBusy(affinity, row, id),
      rationale: rationaleFor(instCount, clientCount),
    }
  })

  // History-only order — institution desc, client desc, L12M desc, name. Used to
  // find the single most-historical host for the bump note.
  const byHistory = [...base].sort(
    (a, b) =>
      b.instCount - a.instCount ||
      b.clientCount - a.clientCount ||
      b.l12m - a.l12m ||
      a.name.localeCompare(b.name),
  )

  // Free-first order — bookable hosts on top, then the same history ranking.
  // This is the dropdown order; candidates[0] is the smart default.
  const candidates = [...base].sort(
    (a, b) =>
      Number(b.free) - Number(a.free) ||
      b.instCount - a.instCount ||
      b.clientCount - a.clientCount ||
      b.l12m - a.l12m ||
      a.name.localeCompare(b.name),
  )

  const defaultId = candidates[0]?.id ?? null
  const top = byHistory[0]
  const topPrimaryN = top ? (top.instCount > 0 ? top.instCount : top.clientCount) : 0
  // Bump note only when the most-historical host is busy AND a free host took the
  // default slot instead (i.e. it was genuinely skipped, not just shown busy).
  const bumpNote =
    top && !top.free && defaultId !== top.id
      ? `${top.name} usually hosts (${topPrimaryN}) but is busy at ${fmtTime(startMinutes)}`
      : null

  return { noPrior: base.length === 0, candidates, defaultId, bumpNote }
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

// ---------------------------------------------------------------------------
// Sorting — one entry per table column, in display order. Each column maps to a
// comparison value below. `align` mirrors the cell alignment (Days is numeric /
// right-aligned). Default sort is When ascending (chronological).
// ---------------------------------------------------------------------------
type SortKey =
  | "when"
  | "days"
  | "client"
  | "institution"
  | "investor"
  | "type"
  | "booker"
  | "host"

const SORT_COLS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "when", label: "When", align: "left" },
  { key: "days", label: "Days", align: "right" },
  { key: "client", label: "Client", align: "left" },
  { key: "institution", label: "Institution", align: "left" },
  { key: "investor", label: "Investor", align: "left" },
  { key: "type", label: "Type", align: "left" },
  { key: "booker", label: "Booker", align: "left" },
  { key: "host", label: "Host", align: "left" },
]

// The visible Type pill text, used so the Type column sorts by what's shown.
function typeLabel(row: Pipeline30dRow): string {
  if (row.is_in_person === true) return "In-person"
  if (isCallType(row.meeting_type_label)) return "Call"
  return "Virtual"
}

const cmpStr = (a: string | null, b: string | null) =>
  (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" })

// Ascending comparison for a single column. Direction is applied by the caller.
function compareRows(a: Pipeline30dRow, b: Pipeline30dRow, key: SortKey): number {
  switch (key) {
    case "when":
      // Underlying datetime, not the "Today/Tomorrow"-style display string.
      return new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime()
    case "days":
      return a.days_until - b.days_until
    case "client":
      return cmpStr(a.client_account_name, b.client_account_name)
    case "institution":
      return cmpStr(a.institution_name, b.institution_name)
    case "investor":
      return cmpStr(a.investor_text, b.investor_text)
    case "type":
      return cmpStr(typeLabel(a), typeLabel(b))
    case "booker":
      return cmpStr(a.booker_name, b.booker_name)
    case "host": {
      // Group unassigned (no host) rows together ahead of named hosts in the
      // ascending direction, then sort the rest A–Z. Descending flips both.
      const aUn = !a.host_id
      const bUn = !b.host_id
      if (aUn !== bUn) return aUn ? -1 : 1
      return cmpStr(a.host_name, b.host_name)
    }
  }
}

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

  // One ranked analysis per unassigned pipeline meeting, keyed by meeting_id.
  const picks = React.useMemo(() => {
    const map = new Map<string, HostPick>()
    for (const r of rows) {
      if (!r.host_id) map.set(r.meeting_id, analyzeHost(r, affinity, l12mByHost))
    }
    return map
  }, [rows, affinity, l12mByHost])

  // Full host roster for "Search all hosts…" — every distinct host present in the
  // loaded hosted meetings, alphabetical.
  const roster = React.useMemo(() => {
    const arr = Array.from(affinity.hostName.entries()).map(([id, name]) => ({ id, name }))
    arr.sort((a, b) => a.name.localeCompare(b.name))
    return arr
  }, [affinity])

  // Free/busy for an arbitrary host (e.g. a search pick) against a meeting.
  const hostFreeFor = React.useCallback(
    (row: Pipeline30dRow, hostId: string) => !isHostBusy(affinity, row, hostId),
    [affinity],
  )

  // User overrides of the smart default, keyed by meeting_id. Placeholder only —
  // this does not write a host back to the CRM.
  const [chosenHost, setChosenHost] = React.useState<Map<string, string>>(new Map())
  const selectHost = React.useCallback((meetingId: string, hostId: string) => {
    setChosenHost((prev) => {
      const next = new Map(prev)
      next.set(meetingId, hostId)
      return next
    })
  }, [])

  // ---- Filters ------------------------------------------------------------
  const [search, setSearch] = React.useState("")
  const [type, setType] = React.useState(ALL_TYPES)
  const [unassignedOnly, setUnassignedOnly] = React.useState(false)
  // Multi-select client filter — set of selected client names. Empty = show all.
  const [clientSel, setClientSel] = React.useState<Set<string>>(new Set())

  // Meeting-type options, derived from the data (never hardcoded).
  const typeOptions = React.useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.meeting_type_label) set.add(r.meeting_type_label)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [rows])

  // Distinct client names present in the loaded rows, deduped + alphabetical.
  // These are the only choices the client dropdown offers (not a full roster).
  const clientOptions = React.useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.client_account_name) set.add(r.client_account_name)
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    )
  }, [rows])

  const toggleClient = React.useCallback((name: string) => {
    setClientSel((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])
  const clearClients = React.useCallback(() => setClientSel(new Set()), [])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (unassignedOnly && r.host_id) return false
      if (type !== ALL_TYPES && r.meeting_type_label !== type) return false
      // OR logic: keep rows whose client is in the selected set. Empty = show all.
      if (clientSel.size > 0 && !(r.client_account_name && clientSel.has(r.client_account_name)))
        return false
      if (q) {
        const hay = `${r.client_account_name ?? ""} ${r.institution_name ?? ""} ${r.investor_text ?? ""} ${r.host_name ?? ""} ${r.booker_name ?? ""}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, type, unassignedOnly, clientSel])

  // ---- Sorting ------------------------------------------------------------
  // Default: When ascending (chronological), matching the prior row order.
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "when",
    dir: "asc",
  })
  const onSort = React.useCallback((key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    )
  }, [])

  // Sort applies to the currently filtered rows. Array.sort is stable, so equal
  // keys keep their filtered order.
  const sorted = React.useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => dir * compareRows(a, b, sort.key))
  }, [filtered, sort])

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

        <ClientFilter
          options={clientOptions}
          selected={clientSel}
          onToggle={toggleClient}
          onClear={clearClients}
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
              {SORT_COLS.map((col) => (
                <SortHeader
                  key={col.key}
                  col={col}
                  active={sort.key === col.key}
                  dir={sort.dir}
                  onSort={onSort}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={TABLE_COLS.length} className="h-32 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "No meetings scheduled in the next 30 days."
                    : "No meetings match the current filters."}
                </td>
              </tr>
            ) : (
              sorted.map((r) => {
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
                    {/* Host (or selector for unassigned) */}
                    <td className="px-3 py-2.5">
                      {unassigned ? (
                        <HostSelectCell
                          row={r}
                          pick={picks.get(r.meeting_id)}
                          selectedId={
                            chosenHost.get(r.meeting_id) ??
                            picks.get(r.meeting_id)?.defaultId ??
                            null
                          }
                          roster={roster}
                          hostFreeFor={hostFreeFor}
                          onSelect={(hostId) => selectHost(r.meeting_id, hostId)}
                        />
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

// Small free / busy pill.
function FreeBusyPill({ free }: { free: boolean }) {
  return free ? (
    <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
      free
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
      busy
    </span>
  )
}

// The Host cell for an unassigned meeting. Collapsed, it shows the smart default
// (top free candidate) — name + free/busy pill + rationale + the amber bump
// note. The name is a dropdown: top-5 ranked candidates (free-first, ★ on the
// default, ✓ on the selection) plus "Search all hosts…" over the full roster.
// The "Assign {name}" button reflects the current selection (placeholder — no
// CRM write-back).
function HostSelectCell({
  row,
  pick,
  selectedId,
  roster,
  hostFreeFor,
  onSelect,
}: {
  row: Pipeline30dRow
  pick: HostPick | undefined
  selectedId: string | null
  roster: { id: string; name: string }[]
  hostFreeFor: (row: Pipeline30dRow, hostId: string) => boolean
  onSelect: (hostId: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [searchMode, setSearchMode] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const candidates = React.useMemo(() => pick?.candidates ?? [], [pick])
  const candidateById = React.useMemo(() => {
    const m = new Map<string, Candidate>()
    for (const c of candidates) m.set(c.id, c)
    return m
  }, [candidates])
  const rosterNameById = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const h of roster) m.set(h.id, h.name)
    return m
  }, [roster])

  // Resolve the selected host's display info — from the candidate pool when it
  // has history, otherwise from the roster (no rationale; live availability).
  const selected: Candidate | null = selectedId
    ? candidateById.get(selectedId) ?? {
        id: selectedId,
        name: rosterNameById.get(selectedId) ?? "—",
        instCount: 0,
        clientCount: 0,
        l12m: 0,
        free: hostFreeFor(row, selectedId),
        rationale: null,
      }
    : null

  const top5 = candidates.slice(0, 5)

  const reset = () => {
    setSearchMode(false)
    setQuery("")
  }
  const pickHost = (id: string) => {
    onSelect(id)
    setOpen(false)
    reset()
  }

  const q = query.trim().toLowerCase()
  const filteredRoster = q
    ? roster.filter((h) => h.name.toLowerCase().includes(q))
    : roster

  return (
    <div className="flex flex-col gap-1.5">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Select host"
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-left text-sm hover:bg-slate-50"
            />
          }
        >
          {selected ? (
            <>
              <span className="truncate font-medium">{selected.name}</span>
              <FreeBusyPill free={selected.free} />
            </>
          ) : (
            <span className="truncate italic text-muted-foreground">
              No prior host — assign manually.
            </span>
          )}
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </PopoverTrigger>

        <PopoverContent align="start" className="w-80 p-1.5">
          {!searchMode ? (
            <>
              {top5.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No suggested hosts — search all hosts.
                </p>
              ) : (
                <ul className="grid">
                  {top5.map((c, idx) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => pickHost(c.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted",
                          selectedId === c.id && "bg-muted",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1">
                            {idx === 0 && (
                              <Star
                                className="size-3 shrink-0 fill-amber-400 text-amber-400"
                                aria-label="Smart default"
                              />
                            )}
                            <span className="truncate text-sm font-medium">{c.name}</span>
                          </span>
                          {c.rationale && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {c.rationale}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <FreeBusyPill free={c.free} />
                          {selectedId === c.id && <Check className="size-4" />}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => setSearchMode(true)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
              >
                <Search className="size-3.5 shrink-0" />
                Search all hosts…
              </button>
            </>
          ) : (
            <>
              <div className="relative mb-1.5">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name"
                  className="pl-8"
                  autoFocus
                />
              </div>
              <div className="max-h-72 overflow-y-auto">
                {filteredRoster.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No matches
                  </p>
                ) : (
                  <ul className="grid">
                    {filteredRoster.map((h) => {
                      const cand = candidateById.get(h.id)
                      const free = cand ? cand.free : hostFreeFor(row, h.id)
                      return (
                        <li key={h.id}>
                          <button
                            type="button"
                            onClick={() => pickHost(h.id)}
                            className={cn(
                              "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted",
                              selectedId === h.id && "bg-muted",
                            )}
                          >
                            <span className="min-w-0">
                              <span className="truncate text-sm">{h.name}</span>
                              {cand?.rationale && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {cand.rationale}
                                </span>
                              )}
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <FreeBusyPill free={free} />
                              {selectedId === h.id && <Check className="size-4" />}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>

      {selected?.rationale && (
        <div className="text-xs text-muted-foreground">{selected.rationale}</div>
      )}
      {pick?.bumpNote && (
        <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-600">
          <ArrowUp className="size-3 shrink-0" />
          {pick.bumpNote}
        </div>
      )}

      {/* Placeholder only — this dashboard is read-only against the mirrored
          CRM, so this does not write a host back to Dynamics yet. */}
      <button
        type="button"
        className="w-fit rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground hover:bg-slate-50"
      >
        {selected ? `Assign ${selected.name}` : "Assign host"}
      </button>
    </div>
  )
}

// Multi-select client filter. Collapsed trigger shows "All clients" or
// "N clients selected". Open reveals a searchable checklist limited to the
// clients present in the loaded rows, with a live count and a Clear action.
// Reuses the Base UI Popover, which closes on outside-click and stays open
// while you interact inside.
function ClientFilter({
  options,
  selected,
  onToggle,
  onClear,
}: {
  options: string[]
  selected: Set<string>
  onToggle: (name: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const q = query.trim().toLowerCase()
  const visible = q ? options.filter((n) => n.toLowerCase().includes(q)) : options

  const label =
    selected.size === 0
      ? "All clients"
      : `${selected.size} client${selected.size === 1 ? "" : "s"} selected`

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQuery("")
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Filter by client"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-sm hover:bg-slate-50"
          />
        }
      >
        <span className={cn(selected.size === 0 && "text-muted-foreground")}>{label}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-1.5">
        <div className="relative mb-1.5">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients"
            className="pl-8"
            autoFocus
          />
        </div>
        <div className="mb-1 flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span>
            {visible.length} {visible.length === 1 ? "client" : "clients"}
          </span>
          <button
            type="button"
            onClick={onClear}
            disabled={selected.size === 0}
            className="font-medium text-foreground hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline"
          >
            Clear
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches</p>
          ) : (
            <ul className="grid">
              {visible.map((name) => (
                <li key={name}>
                  <label className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={selected.has(name)}
                      onChange={() => onToggle(name)}
                      className="size-4 shrink-0"
                    />
                    <span className="truncate text-sm">{name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// A clickable column header. Shows an up arrow when this column is the active
// ascending sort, a down arrow when descending, and a faint neutral icon when
// inactive. The active header's text is darkened for emphasis.
function SortHeader({
  col,
  active,
  dir,
  onSort,
}: {
  col: { key: SortKey; label: string; align: "left" | "right" }
  active: boolean
  dir: "asc" | "desc"
  onSort: (key: SortKey) => void
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown
  return (
    <th className={cn("px-3 py-2 font-medium", col.align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => onSort(col.key)}
        aria-label={`Sort by ${col.label}`}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span>{col.label}</span>
        <Icon className={cn("size-3 shrink-0", !active && "opacity-40")} />
      </button>
    </th>
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


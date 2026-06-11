"use client"

import * as React from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, Users } from "lucide-react"
import { GradientHero } from "@/components/gradient-hero"
import { HostSelectCell } from "@/components/host-select-cell"
import { StatCard } from "@/components/stat-card"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { PIPELINE_CARD_GRADIENTS } from "@/lib/gradients"
import { analyzeHost, buildAffinity, isHostBusy } from "@/lib/host-suggestion"
import type { HostPick, HostSlot } from "@/lib/host-suggestion"
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

// Normalize one unassigned pipeline row into the shared host-suggestion shape.
// The hosted-meeting basis stores wall-clock digits read as UTC, so we derive
// start minutes / calendar day the same way for the conflict check to line up.
function slotOf(row: Pipeline30dRow): HostSlot {
  return {
    start_minutes: startMinutesOf(row.meeting_date),
    meeting_day: meetingDayOf(row.meeting_date),
    is_in_person: row.is_in_person === true,
    institution_name: row.institution_name,
    client_account_name: row.client_account_name,
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
      if (!r.host_id) map.set(r.meeting_id, analyzeHost(slotOf(r), affinity, l12mByHost))
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
    (row: Pipeline30dRow, hostId: string) => !isHostBusy(affinity, slotOf(row), hostId),
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
                          pick={picks.get(r.meeting_id)}
                          selectedId={
                            chosenHost.get(r.meeting_id) ??
                            picks.get(r.meeting_id)?.defaultId ??
                            null
                          }
                          roster={roster}
                          isHostFree={(hostId) => hostFreeFor(r, hostId)}
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


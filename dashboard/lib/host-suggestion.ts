// ---------------------------------------------------------------------------
// Shared host-suggestion logic for unassigned meetings. This is the ONE source
// of truth used by both the Pipeline page (upcoming-meetings table) and the
// Scheduler page (Day-view unassigned section), so the smart-default
// suggestion, the ranking, and the availability model stay identical on both.
//
// Duration / occupied-interval model: every meeting's core is 1h from start;
// in-person adds a 45m travel buffer each side. Used to detect host conflicts
// when suggesting a host for an unassigned meeting, evaluated against the
// already-loaded hosted meetings from v_scheduler_meetings.
// ---------------------------------------------------------------------------
import type { SchedulerMeetingRow, SchedulerTimeOffRow } from "@/lib/types"

const BUFFER = 45
const CORE = 60

export type Interval = { start: number; end: number }

function occFrom(startMinutes: number, isInPerson: boolean): Interval {
  if (isInPerson) {
    return { start: startMinutes - BUFFER, end: startMinutes + CORE + BUFFER }
  }
  return { start: startMinutes, end: startMinutes + CORE }
}
function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

// 840 -> "2pm", 870 -> "2:30pm". Matches the page-level formatting.
function fmtTime(min: number): string {
  const h = (((Math.floor(min / 60) % 24) + 24) % 24)
  const m = ((min % 60) + 60) % 60
  const period = h < 12 ? "am" : "pm"
  let h12 = h % 12
  if (h12 === 0) h12 = 12
  const mm = m === 0 ? "" : ":" + String(m).padStart(2, "0")
  return `${h12}${mm}${period}`
}

// The normalized fields analyzeHost / isHostBusy need from one unassigned
// meeting, regardless of which page's row type it came from. SchedulerUnassignedRow
// already exposes exactly these; the Pipeline page derives them from its ISO
// meeting_date before calling.
export type HostSlot = {
  start_minutes: number
  meeting_day: string
  is_in_person: boolean
  institution_name: string | null
  client_account_name: string | null
}

// One ranked host option for an unassigned meeting.
export type Candidate = {
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
export type HostPick = {
  noPrior: boolean
  candidates: Candidate[]
  defaultId: string | null
  bumpNote: string | null
}

export type Affinity = {
  hostName: Map<string, string>
  instHost: Map<string, Map<string, number>>
  clientHost: Map<string, Map<string, number>>
  instTotal: Map<string, number>
  clientTotal: Map<string, number>
  hostDay: Map<string, Map<string, Interval[]>>
}

// Lifetime frequency maps + per-host/day occupied intervals, derived once from
// hosted meetings. Hosted meetings expose client_account_name (not id), so client
// affinity is matched by name; institution affinity is matched by institution_name.
export function buildAffinity(meetings: SchedulerMeetingRow[]): Affinity {
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
// the Scheduler grid, evaluated against the already-loaded hosted meetings. Works
// for any host (history candidate or an arbitrary roster pick from search).
export function isHostBusy(affinity: Affinity, slot: HostSlot, hostId: string): boolean {
  const occ = occFrom(slot.start_minutes, slot.is_in_person)
  const ivs = affinity.hostDay.get(hostId)?.get(slot.meeting_day)
  return ivs ? ivs.some((iv) => intervalsOverlap(iv, occ)) : false
}

// Time-off status for a host on a given calendar day ('YYYY-MM-DD'). Joined by
// host_id (the Dynamics systemuser GUID), never by name. Ranges are inclusive on
// both ends; ISO day strings compare correctly as text. OOO wins if a host
// somehow has both on one day. Reads the same v_scheduler_time_off rows as the
// Host Calendar / Time Off page (Approved-only, OOO/Remote already bucketed in
// the SQL view) so the three features can't drift.
export type TimeOffType = "OOO" | "Remote"
export function timeOffOn(
  entries: SchedulerTimeOffRow[],
  hostId: string,
  dayYmd: string,
): TimeOffType | null {
  let result: TimeOffType | null = null
  for (const e of entries) {
    if (e.host_id !== hostId) continue
    if (e.start_date <= dayYmd && dayYmd <= e.end_date) {
      if (e.time_off_type === "OOO") return "OOO"
      result = "Remote"
    }
  }
  return result
}

// Rank candidate hosts for one unassigned meeting and pick a smart default.
// Hosts on approved time off are excluded up front: OOO on the meeting's day is
// never suggestable (any type); Remote is excluded only for a LIVE (in-person)
// meeting, since a remote person can still take a virtual one.
export function analyzeHost(
  slot: HostSlot,
  affinity: Affinity,
  l12mByHost: Map<string, number>,
  timeOff: SchedulerTimeOffRow[] = [],
): HostPick {
  const inst = slot.institution_name
  const client = slot.client_account_name
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
      free: !isHostBusy(affinity, slot, id),
      rationale: rationaleFor(instCount, clientCount),
    }
  })

  // Time-off exclusion, joined by host id via the shared resolver: OOO removes a
  // host from every meeting; Remote removes them only from a LIVE meeting.
  const timeOffFor = (id: string) => timeOffOn(timeOff, id, slot.meeting_day)
  const excludedByTimeOff = (id: string): boolean => {
    const t = timeOffFor(id)
    return t === "OOO" || (t === "Remote" && slot.is_in_person)
  }
  const available = base.filter((c) => !excludedByTimeOff(c.id))

  // History-only order — institution desc, client desc, L12M desc, name. Over the
  // FULL pool so the bump note can still name the most-historical host even when
  // time off has excluded them from the suggestions below.
  const byHistory = [...base].sort(
    (a, b) =>
      b.instCount - a.instCount ||
      b.clientCount - a.clientCount ||
      b.l12m - a.l12m ||
      a.name.localeCompare(b.name),
  )

  // Free-first order — bookable hosts on top, then the same history ranking. Only
  // time-off-eligible hosts. This is the dropdown order; candidates[0] is the
  // smart default.
  const candidates = [...available].sort(
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
  // Explain why the most-historical host isn't the default: out of office, remote
  // (can't attend in person), or simply busy at that time. Only when they aren't
  // the default (i.e. genuinely skipped, not just shown as-is).
  let bumpNote: string | null = null
  if (top && defaultId !== top.id) {
    const t = timeOffFor(top.id)
    if (t === "OOO") {
      bumpNote = `${top.name} usually hosts (${topPrimaryN}) but is out of office`
    } else if (t === "Remote" && slot.is_in_person) {
      bumpNote = `${top.name} usually hosts (${topPrimaryN}) but is remote (can't attend in person)`
    } else if (!top.free) {
      bumpNote = `${top.name} usually hosts (${topPrimaryN}) but is busy at ${fmtTime(slot.start_minutes)}`
    }
  }

  return { noPrior: base.length === 0, candidates, defaultId, bumpNote }
}

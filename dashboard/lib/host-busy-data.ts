/**
 * Host busy-time data layer (server-only).
 *
 * Given an Eastern day range and a set of Scheduler host ids, resolves each host
 * to its mailbox through lib/graph (getHostSchedules — which applies the
 * canonical-id fold and the explicit multi-address overrides, and skips hosts
 * with no mailbox), then returns each host's Outlook busy blocks keyed by
 * host_id and split per Eastern day so the Scheduler can shade them directly.
 *
 * Reuses lib/graph — no direct Graph/token plumbing here. Every failure mode is
 * non-fatal: an unresolvable host, or a per-mailbox Graph error, drops that host
 * to `skipped` and the rest still render.
 */

import { getHostSchedules } from "@/lib/graph"
import {
  BUSY_STATUSES,
  HOST_BUSY_TIME_ZONE,
  SCHEDULE_CALLER_MAILBOX,
  type HostBusyBlock,
  type HostBusyResponse,
  type HostBusySkip,
} from "@/lib/host-busy"

/** 'YYYY-MM-DD' date part of a Graph dateTime. */
const datePart = (dateTime: string) => dateTime.split("T")[0] ?? ""

/**
 * Minutes from midnight for a Graph dateTime string. The value is already
 * Eastern wall-clock (graphFetch sends `Prefer: outlook.timezone`), so we read
 * the clock time directly — no timezone math. "2026-07-20T08:30:00…" → 510.
 */
function toMinutes(dateTime: string): number {
  const time = dateTime.split("T")[1] ?? "00:00"
  const [h, m] = time.split(":")
  return Number(h) * 60 + Number(m)
}

/** Next calendar day for a 'YYYY-MM-DD' string, computed in UTC to stay
 *  DST-agnostic (we only ever manipulate the date part). */
function nextYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Split one Graph scheduleItem into per-day busy blocks clipped to
 * [startDate, endDate] (inclusive). Handles same-day timed events and
 * multi-day / all-day events (e.g. multi-day OOF) by emitting one block per
 * covered day. An event ending exactly at midnight does not occupy that final
 * day (zero width → dropped). String date comparison is valid for 'YYYY-MM-DD'.
 */
function splitItemIntoDays(
  startDT: string,
  endDT: string,
  status: string,
  startDate: string,
  endDate: string,
): HostBusyBlock[] {
  const sDay = datePart(startDT)
  const eDay = datePart(endDT)
  const sMin = toMinutes(startDT)
  const eMin = toMinutes(endDT)
  const out: HostBusyBlock[] = []

  let day = sDay
  // Guard the loop against any pathological range (max ~1 week + slack).
  for (let i = 0; i < 31 && day <= eDay; i++, day = nextYmd(day)) {
    if (day < startDate || day > endDate) continue
    const dayStart = day === sDay ? sMin : 0
    const dayEnd = day === eDay ? eMin : 1440
    if (dayEnd > dayStart) {
      out.push({ day, startMinutes: dayStart, endMinutes: dayEnd, status })
    }
  }
  return out
}

/**
 * Fetch Outlook busy blocks for `hostIds` across [startDate, endDate] (inclusive
 * Eastern days). Returns blocks keyed by the host_id that was passed in, plus a
 * `skipped` list of hosts with no usable calendar.
 */
export async function getHostBusy(
  hostIds: string[],
  startDate: string,
  endDate: string,
): Promise<HostBusyResponse> {
  const busyByHost: Record<string, HostBusyBlock[]> = {}
  const skipped: HostBusySkip[] = []

  const uniqueIds = [...new Set(hostIds.filter(Boolean))]
  if (uniqueIds.length === 0) {
    return { startDate, endDate, timeZone: HOST_BUSY_TIME_ZONE, busyByHost, skipped }
  }

  const results = await getHostSchedules({
    hostIds: uniqueIds,
    callerMailbox: SCHEDULE_CALLER_MAILBOX,
    // Whole days, Eastern. getSchedule returns scheduleItems' exact times, so the
    // packed availabilityView isn't used (interval is a required-but-inert 30).
    startTime: { dateTime: `${startDate}T00:00:00`, timeZone: HOST_BUSY_TIME_ZONE },
    endTime: { dateTime: `${endDate}T23:59:59`, timeZone: HOST_BUSY_TIME_ZONE },
    availabilityViewInterval: 30,
  })

  for (const r of results) {
    if (r.status === "no-calendar") {
      skipped.push({ hostId: r.hostId, reason: r.reason })
      continue
    }
    // Resolved to a mailbox but Graph couldn't read that specific one.
    if (r.schedule.error) {
      skipped.push({ hostId: r.hostId, reason: "graph-error" })
      continue
    }
    const blocks: HostBusyBlock[] = []
    for (const item of r.schedule.scheduleItems ?? []) {
      if (!BUSY_STATUSES.has(item.status)) continue // free / workingElsewhere → not a commitment
      blocks.push(
        ...splitItemIntoDays(item.start.dateTime, item.end.dateTime, item.status, startDate, endDate),
      )
    }
    busyByHost[r.hostId] = blocks
  }

  return { startDate, endDate, timeZone: HOST_BUSY_TIME_ZONE, busyByHost, skipped }
}

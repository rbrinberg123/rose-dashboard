/**
 * Conference Rooms data layer (server-only).
 *
 * Given a date, queries Microsoft Graph getSchedule for the four room resource
 * mailboxes (lookup addresses) over the 7am–6pm Eastern window and returns each
 * room's occupied blocks. Reuses lib/graph (getSchedule) — no direct Graph
 * plumbing here.
 *
 * Stage 1 established these are room resource mailboxes read via
 * `Calendars.ReadBasic.All`, which returns FREE/BUSY ONLY — no subject/location.
 * So blocks carry times + status, never a subject.
 */

import { getSchedule } from "@/lib/graph"
import {
  CONFERENCE_ROOMS,
  ROOMS_CALLER_MAILBOX,
  ROOMS_END_HOUR,
  ROOMS_START_HOUR,
  ROOMS_TIME_ZONE,
  type ConferenceRoomsResponse,
  type RoomBlock,
} from "@/lib/conference-rooms"

/** Two digit-pad. */
const pad = (n: number) => String(n).padStart(2, "0")

/**
 * Minutes from midnight for a Graph dateTime string. The value is already
 * Eastern wall-clock (we send `Prefer: outlook.timezone` in graphFetch), so we
 * read the clock time directly — no timezone math.
 * e.g. "2026-07-20T08:30:00.0000000" → 510.
 */
function toMinutes(dateTime: string): number {
  const time = dateTime.split("T")[1] ?? "00:00"
  const [h, m] = time.split(":")
  return Number(h) * 60 + Number(m)
}

/**
 * Fetch the four rooms' occupied blocks for `date` ('YYYY-MM-DD', Eastern).
 * Rooms are returned in config order, each with its display alias.
 */
export async function getConferenceRoomSchedules(
  date: string,
): Promise<ConferenceRoomsResponse> {
  const startTime = {
    dateTime: `${date}T${pad(ROOMS_START_HOUR)}:00:00`,
    timeZone: ROOMS_TIME_ZONE,
  }
  const endTime = {
    dateTime: `${date}T${pad(ROOMS_END_HOUR)}:00:00`,
    timeZone: ROOMS_TIME_ZONE,
  }

  const infos = await getSchedule({
    callerMailbox: ROOMS_CALLER_MAILBOX,
    schedules: CONFERENCE_ROOMS.map((r) => r.lookupEmail),
    startTime,
    endTime,
    // Required by Graph (5–1440); we render from scheduleItems' exact times, so
    // the packed availabilityView isn't used — 30 is a harmless value.
    availabilityViewInterval: 30,
  })

  // Match results back to rooms by mailbox (case-insensitive; Graph echoes the
  // requested address as scheduleId).
  const byMailbox = new Map(infos.map((i) => [i.scheduleId.toLowerCase(), i]))

  const rooms = CONFERENCE_ROOMS.map((room) => {
    const info = byMailbox.get(room.lookupEmail.toLowerCase())
    if (!info || info.error) {
      return {
        label: room.label,
        displayEmail: room.displayEmail,
        blocks: [] as RoomBlock[],
        error: info?.error?.message ?? (info ? null : "No schedule returned"),
      }
    }
    const blocks: RoomBlock[] = (info.scheduleItems ?? []).map((item) => ({
      startMinutes: toMinutes(item.start.dateTime),
      endMinutes: toMinutes(item.end.dateTime),
      status: item.status,
    }))
    return { label: room.label, displayEmail: room.displayEmail, blocks, error: null }
  })

  return {
    date,
    timeZone: ROOMS_TIME_ZONE,
    startHour: ROOMS_START_HOUR,
    endHour: ROOMS_END_HOUR,
    rooms,
  }
}

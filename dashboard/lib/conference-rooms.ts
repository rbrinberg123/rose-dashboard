/**
 * Conference Rooms — config + shared types for the Logistics → Conference
 * Rooms page and its API route (app/api/conference-rooms).
 *
 * Each room has TWO addresses on purpose:
 *   - lookupEmail  (@rosecoglobal.com): the real resource mailbox we query
 *     Microsoft Graph getSchedule against.
 *   - displayEmail (@roseandco.com):   the alias shown in the UI.
 * The lookup uses rosecoglobal; the page shows roseandco. See CONFERENCE_ROOMS.
 *
 * NOTE: the CONFERENCE_ROOMS value (which carries the lookup addresses) is only
 * imported server-side (the API route). The client view renders from the API
 * response and type-only imports from this file, so lookup addresses never ship
 * to the browser.
 *
 * To add/edit a room: change CONFERENCE_ROOMS below — nothing else needs to
 * change (the route and view are both data-driven from it / the response).
 */

import { SCHEDULE_CALLER_MAILBOX } from "@/lib/host-busy"

export type ConferenceRoom = {
  /** Column label, e.g. "Conf Room 1". */
  label: string
  /** Real resource mailbox queried against Graph (@rosecoglobal.com). */
  lookupEmail: string
  /** Alias shown under the label in the UI (@roseandco.com). */
  displayEmail: string
}

export const CONFERENCE_ROOMS: ConferenceRoom[] = [
  { label: "Conf Room 1", lookupEmail: "parkroom1@rosecoglobal.com", displayEmail: "parkroom1@roseandco.com" },
  { label: "Conf Room 2", lookupEmail: "parkroom2@rosecoglobal.com", displayEmail: "parkroom2@roseandco.com" },
  { label: "Conf Room 3", lookupEmail: "parkroom3@rosecoglobal.com", displayEmail: "parkroom3@roseandco.com" },
  { label: "Conf Room 4", lookupEmail: "parkroom4@rosecoglobal.com", displayEmail: "parkroom4@roseandco.com" },
]

/** Everything is presented in US Eastern wall-clock. */
export const ROOMS_TIME_ZONE = "America/New_York"

/** Visible day window: 7am–6pm Eastern (24h clock). */
export const ROOMS_START_HOUR = 7
export const ROOMS_END_HOUR = 18

/**
 * Mailbox getSchedule runs "as" (app-only; the caller is just the identity
 * context, NOT whose calendar we read — the rooms below are still what's read).
 *
 * Shares the Scheduler's SCHEDULE_CALLER_MAILBOX (dashboards@roseandco.com by
 * default) so both calendar features use ONE caller and can't drift apart. This
 * matters because the Graph app is scoped by an Exchange Application Access
 * Policy (RestrictAccess) to the dashboards@ group — calling as any mailbox
 * outside it (e.g. the old parkroom1@rosecoglobal.com) returns 403 [RAOP] and
 * surfaces as a 502 on the page. dashboards@ is inside the policy and reads all
 * four parkrooms' free/busy fine.
 */
export const ROOMS_CALLER_MAILBOX = SCHEDULE_CALLER_MAILBOX

// ---------------------------------------------------------------------------
// API response shape (shared by the route and the client view).
// ---------------------------------------------------------------------------

/** One occupied interval in a room's day. Times are minutes from midnight
 *  Eastern (e.g. 8:30am = 510), so the view can position blocks directly.
 *  `status` is Graph's raw status ("busy" | "tentative" | "oof" | …); the UI
 *  treats every block as "Booked" (rooms never return "free" here). */
export type RoomBlock = {
  startMinutes: number
  endMinutes: number
  status: string
}

/** One room's result for the requested day. `error` is set (blocks empty) when
 *  Graph couldn't read that specific mailbox. */
export type RoomSchedule = {
  label: string
  displayEmail: string
  blocks: RoomBlock[]
  error: string | null
}

export type ConferenceRoomsResponse = {
  /** Requested day, 'YYYY-MM-DD' (Eastern). */
  date: string
  timeZone: string
  startHour: number
  endHour: number
  rooms: RoomSchedule[]
}

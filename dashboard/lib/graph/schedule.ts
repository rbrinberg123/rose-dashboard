/**
 * getSchedule — calendar free/busy for a set of mailboxes.
 *
 * Wraps `POST /users/{caller}/calendar/getSchedule`. In app-only mode the
 * `{caller}` mailbox is simply the identity the request runs AS; it does not
 * have to be one of the people whose availability we're reading. Each queried
 * mailbox comes back with:
 *   - `availabilityView`: a packed free/busy string, one digit per
 *     `availabilityViewInterval`-minute slot (0 free, 1 tentative, 2 busy,
 *     3 out-of-office, 4 working-elsewhere).
 *   - `scheduleItems`: the individual busy blocks (status + start/end, and
 *     subject/location when the mailbox shares them).
 *
 * Graph limits we enforce/relay:
 *   - at most 20 mailboxes per call (`schedules`),
 *   - `availabilityViewInterval` between 5 and 1440 minutes.
 * Throttling (429) is handled upstream in graphFetch (respects Retry-After).
 *
 * `Calendars.ReadBasic.All` is sufficient for this call.
 */

import { graphFetch } from "./request"

/** Max mailboxes Graph accepts in a single getSchedule call. */
export const MAX_SCHEDULES_PER_CALL = 20

/** Graph-imposed bounds on availabilityViewInterval (minutes). */
export const MIN_INTERVAL_MINUTES = 5
export const MAX_INTERVAL_MINUTES = 1440

/** Graph's dateTimeTimeZone shape. `timeZone` accepts IANA (e.g.
 *  "America/New_York") or Windows ("Eastern Standard Time") names. */
export type GraphDateTimeTimeZone = { dateTime: string; timeZone: string }

/** One busy block within a mailbox's schedule. */
export type ScheduleItem = {
  status: string
  start: GraphDateTimeTimeZone
  end: GraphDateTimeTimeZone
  subject?: string
  location?: string
  isPrivate?: boolean
}

/** One mailbox's result. `error` is set (instead of the data fields) when
 *  Graph couldn't resolve or read that specific mailbox. */
export type ScheduleInformation = {
  scheduleId: string
  availabilityView: string
  scheduleItems: ScheduleItem[]
  workingHours?: unknown
  error?: { message: string; responseCode: string }
}

export type GetScheduleOptions = {
  /** Mailbox the request runs as (real address in the tenant). */
  callerMailbox: string
  /** Email addresses to read free/busy for. 1–20. */
  schedules: string[]
  startTime: GraphDateTimeTimeZone
  endTime: GraphDateTimeTimeZone
  /** Slot width in minutes; each digit of availabilityView is one slot. 5–1440. */
  availabilityViewInterval: number
}

/**
 * Fetch free/busy for `schedules` as seen by `callerMailbox`.
 *
 * Validates the batch size and interval against Graph's documented limits
 * before making the call, so we fail fast with a clear message rather than
 * getting an opaque 400 back.
 */
export async function getSchedule(opts: GetScheduleOptions): Promise<ScheduleInformation[]> {
  const { callerMailbox, schedules, startTime, endTime, availabilityViewInterval } = opts

  if (schedules.length === 0) {
    throw new Error("getSchedule: `schedules` is empty — pass at least one email.")
  }
  if (schedules.length > MAX_SCHEDULES_PER_CALL) {
    throw new Error(
      `getSchedule: ${schedules.length} mailboxes requested but Graph allows at most ${MAX_SCHEDULES_PER_CALL} per call. Batch the list.`,
    )
  }
  if (
    availabilityViewInterval < MIN_INTERVAL_MINUTES ||
    availabilityViewInterval > MAX_INTERVAL_MINUTES
  ) {
    throw new Error(
      `getSchedule: availabilityViewInterval ${availabilityViewInterval} is out of range (${MIN_INTERVAL_MINUTES}–${MAX_INTERVAL_MINUTES} minutes).`,
    )
  }

  const path = `/users/${encodeURIComponent(callerMailbox)}/calendar/getSchedule`

  const res = await graphFetch<{ value: ScheduleInformation[] }>(path, {
    method: "POST",
    // Ask Graph to return scheduleItem times in the same zone we queried, so
    // the raw result is human-readable rather than UTC.
    headers: { Prefer: `outlook.timezone="${startTime.timeZone}"` },
    body: {
      schedules,
      startTime,
      endTime,
      availabilityViewInterval,
    },
  })

  return res.value
}

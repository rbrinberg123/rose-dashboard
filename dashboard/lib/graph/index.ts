/**
 * Microsoft Graph integration — public surface.
 *
 * Import from "@/lib/graph" only; the individual files (token/request/…) are
 * internal to this module and may be reorganised freely.
 *
 * Stage 1: app-only auth + the shared HTTP core.
 * Stage 2: getSchedule (calendar free/busy).
 */

export { getGraphAccessToken, clearGraphTokenCache } from "./token"
export { graphFetch, GraphError } from "./request"
export {
  getSchedule,
  MAX_SCHEDULES_PER_CALL,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
} from "./schedule"
export type {
  GetScheduleOptions,
  ScheduleInformation,
  ScheduleItem,
  GraphDateTimeTimeZone,
} from "./schedule"
export { resolveHostEmail, resolveHostEmails, getHostSchedules } from "./hosts"
export type { ResolvedHost, HostCalendarResult, GetHostSchedulesOptions } from "./hosts"

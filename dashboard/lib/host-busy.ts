/**
 * Host busy-time overlay — config + shared types for the Scheduler's Outlook
 * free/busy shading and its API route (app/api/host-busy).
 *
 * The Scheduler already shows confirmed-meeting assignments. This overlay adds a
 * SECONDARY, background cue: each host's real Outlook free/busy, so "other
 * commitments" (external conflicts) that aren't in our meeting data become
 * visible. Meeting assignments always render on top and win visually where they
 * overlap busy shading (a busy block coinciding with a hosted meeting is almost
 * certainly that same meeting on the host's Outlook calendar — not a conflict).
 *
 * Server-only config (the caller mailbox) is read here but only imported by the
 * route/data layer; the client view type-only imports the response shapes, so no
 * mailbox address ships to the browser. Mirrors the conference-rooms module.
 */

/**
 * Mailbox getSchedule runs "as" (app-only; the caller is just the identity
 * context, NOT whose calendar we read — see lib/graph/schedule.ts).
 *
 * Defaults to a person (scott@) for now, overridable per environment via
 * GRAPH_SCHEDULE_CALLER_MAILBOX. TODO: move to a dedicated, permanent service
 * mailbox not tied to any individual — the Conference Rooms feature already does
 * this (it runs as a room resource mailbox), so the calendar never breaks if a
 * staff member leaves. Point GRAPH_SCHEDULE_CALLER_MAILBOX at that mailbox once
 * it exists.
 */
export const SCHEDULE_CALLER_MAILBOX =
  process.env.GRAPH_SCHEDULE_CALLER_MAILBOX?.trim() || "scott@roseandco.com"

/** Everything is presented in US Eastern wall-clock, matching the Scheduler. */
export const HOST_BUSY_TIME_ZONE = "America/New_York"

/**
 * A Graph scheduleItem status we treat as an "other commitment" worth shading.
 * `free` and `workingElsewhere` are intentionally excluded — they don't block
 * the host. Kept as a set so the UI/data layer share one definition.
 */
export const BUSY_STATUSES = new Set(["busy", "tentative", "oof"])

// ---------------------------------------------------------------------------
// API request + response shapes (shared by the route and the client view).
// ---------------------------------------------------------------------------

/** POST body: which hosts + which Eastern day range to fetch busy for. Dates are
 *  inclusive 'YYYY-MM-DD'. Day view sends startDate === endDate + every shown
 *  host; Week·one-person sends the Mon–Fri range + a single host. */
export type HostBusyRequest = {
  startDate: string
  endDate: string
  hostIds: string[]
}

/** One busy interval on a single Eastern day. Minutes are from midnight ET
 *  (8:30am = 510), so the Scheduler can position the band directly with the same
 *  math its meeting blocks use. `status` is Graph's raw status (one of
 *  BUSY_STATUSES). */
export type HostBusyBlock = {
  day: string // 'YYYY-MM-DD' (Eastern)
  startMinutes: number
  endMinutes: number
  status: string
}

/** Why a requested host produced no shading. `no-mailbox`/`unknown-host` come
 *  straight from the resolver; `graph-error` is a per-mailbox Graph failure
 *  (e.g. responseCode 5009 — mailbox not found). All are non-fatal: the host
 *  simply gets no overlay. */
export type HostBusySkip = {
  hostId: string
  reason: "no-mailbox" | "unknown-host" | "graph-error"
}

export type HostBusyResponse = {
  startDate: string
  endDate: string
  timeZone: string
  /** hostId → its busy blocks across the range. Only hosts that resolved to a
   *  mailbox appear (possibly with an empty array = resolved but fully free). */
  busyByHost: Record<string, HostBusyBlock[]>
  skipped: HostBusySkip[]
}

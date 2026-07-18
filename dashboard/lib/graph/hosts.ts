/**
 * Host → mailbox resolution — the single source of truth for turning our
 * internal host user IDs into the email addresses Graph calendar calls need.
 *
 * EVERY calendar feature must resolve hosts through here (never build its own
 * mapping), so they can't drift apart. The email comes from the synced
 * `users.email` column (Dynamics systemuser.internalemailaddress); see
 * lib/sync/mappers.ts and sql/patches/2026-07-18_users_email.sql.
 *
 * The no-email case is first-class, not an error: system/application accounts
 * (e.g. CRM Administration) and some ex-employees have no mailbox. Those hosts
 * resolve with `email: null` and are reported as "no calendar available" —
 * getHostSchedules never issues a Graph call for them.
 */

import { getSupabaseServer } from "@/lib/supabase"
import { getSchedule, MAX_SCHEDULES_PER_CALL } from "./schedule"
import type { GraphDateTimeTimeZone, ScheduleInformation } from "./schedule"

/** A host looked up in the users table. Keyed in the returned map by the id the
 *  caller passed; `canonicalUserId` is the identity we actually read the mailbox
 *  from (folding duplicate Dynamics ids via public.user_id_aliases, exactly like
 *  public.canonical_user_id — the app's single identity resolver). `email` is
 *  null when that person has no usable mailbox — treat as "no calendar
 *  available". */
export type ResolvedHost = {
  /** The id the caller asked about (a meetings.host_id). */
  requestedId: string
  /** The canonical identity whose mailbox `email` belongs to. Equals
   *  requestedId unless requestedId is a known duplicate/alias. */
  canonicalUserId: string
  displayName: string | null
  email: string | null
}

/**
 * Explicit mailbox overrides, keyed by CANONICAL user id (post alias-fold).
 *
 * These three people each have MULTIPLE email addresses in the tenant; this pins
 * the one their real Outlook calendar lives on so the free/busy lookup can never
 * pick a secondary alias. As of writing the synced `users.email` already holds
 * exactly these addresses, so every entry is a no-op against current data — it
 * is deliberate DEFENSIVE pinning: if a future Dynamics sync ever writes a
 * secondary SMTP into users.email, the calendar lookup for these VIPs stays put.
 *
 * An override wins over users.email and applies even if the canonical identity
 * has no users row. Keyed to canonical id (not a raw host_id) so it survives the
 * duplicate-id folding, matching resolveHostEmails' own lookup key.
 *
 *   cc5afa45-… Blair Mutschler
 *   21d086fe-… Brian Smith
 *   3126290d-… Simon Rose (currently excluded from the Scheduler by choice —
 *              see EXCLUDED_HOSTS in scheduler-view.tsx — so this entry is inert
 *              until he is un-excluded; kept here for completeness/robustness).
 */
const HOST_EMAIL_OVERRIDES: Record<string, string> = {
  "cc5afa45-a5ee-ed11-8849-0022482a4b51": "blair@roseandco.com",
  "21d086fe-e441-ee11-bdf3-0022482a4e0c": "bsmith@roseandco.com",
  "3126290d-62a6-ed11-aad1-0022482a4b51": "simon@roseandco.com",
}

/** Load the (tiny) alias table into requestedId -> canonicalId. Mirrors
 *  public.canonical_user_id so host resolution never drifts from the rest of
 *  the app's identity handling. */
async function loadAliasMap(
  sb: ReturnType<typeof getSupabaseServer>,
): Promise<Map<string, string>> {
  const { data, error } = await sb
    .from("user_id_aliases")
    .select("alias_user_id, canonical_user_id")
  if (error) {
    throw new Error(`resolveHostEmails: alias lookup failed: ${error.message}`)
  }
  const m = new Map<string, string>()
  for (const r of data ?? []) {
    m.set(r.alias_user_id as string, r.canonical_user_id as string)
  }
  return m
}

/** Look up `hostIds` (meetings.host_id values) and return a map keyed by the id
 *  passed in. Each id is folded to its canonical identity first, then that
 *  identity's mailbox is read from users.email. A host whose canonical identity
 *  has no users row is absent from the map; one that exists but has a blank
 *  mailbox comes back with `email: null`. */
export async function resolveHostEmails(
  hostIds: string[],
): Promise<Map<string, ResolvedHost>> {
  const result = new Map<string, ResolvedHost>()
  const requested = [...new Set(hostIds.filter(Boolean))]
  if (requested.length === 0) return result

  const sb = getSupabaseServer()

  // Fold each requested id to its canonical identity.
  const aliases = await loadAliasMap(sb)
  const canonicalOf = (id: string) => aliases.get(id) ?? id
  const canonicalIds = [...new Set(requested.map(canonicalOf))]

  // Fetch the canonical identities' rows (chunked so a large set doesn't build
  // an unwieldy query).
  const byCanonical = new Map<string, { displayName: string | null; email: string | null }>()
  const CHUNK = 200
  for (let i = 0; i < canonicalIds.length; i += CHUNK) {
    const chunk = canonicalIds.slice(i, i + CHUNK)
    const { data, error } = await sb
      .from("users")
      .select("user_id, display_name, email")
      .in("user_id", chunk)
    if (error) {
      throw new Error(`resolveHostEmails: users lookup failed: ${error.message}`)
    }
    for (const row of data ?? []) {
      const raw = typeof row.email === "string" ? row.email.trim() : ""
      byCanonical.set(row.user_id as string, {
        displayName: (row.display_name as string | null) ?? null,
        // Normalise blank to null so callers have a single "no mailbox" signal.
        email: raw ? raw : null,
      })
    }
  }

  // Re-key by the id the caller asked about. An explicit override (keyed by
  // canonical id) wins over users.email and stands in even when the canonical
  // identity has no users row.
  for (const id of requested) {
    const canonicalUserId = canonicalOf(id)
    const override = HOST_EMAIL_OVERRIDES[canonicalUserId]
    const found = byCanonical.get(canonicalUserId)
    if (!found && !override) continue // canonical identity absent from users → unknown host
    result.set(id, {
      requestedId: id,
      canonicalUserId,
      displayName: found?.displayName ?? null,
      email: override ?? found?.email ?? null,
    })
  }
  return result
}

/** Single-host convenience. Returns null when the host's canonical identity
 *  isn't in users at all; returns a ResolvedHost with `email: null` when it
 *  exists but has no mailbox. */
export async function resolveHostEmail(hostId: string): Promise<ResolvedHost | null> {
  const map = await resolveHostEmails([hostId])
  return map.get(hostId) ?? null
}

/** Per-host outcome from getHostSchedules. `ok` carries the Graph free/busy;
 *  `no-calendar` means we deliberately skipped Graph (no mailbox / unknown
 *  host) and the UI should show a "no calendar available" state. */
export type HostCalendarResult =
  | {
      hostId: string
      status: "ok"
      email: string
      displayName: string | null
      schedule: ScheduleInformation
    }
  | {
      hostId: string
      status: "no-calendar"
      displayName: string | null
      /** "no-mailbox" = exists in users but blank email; "unknown-host" = not
       *  found in users at all. */
      reason: "no-mailbox" | "unknown-host"
    }

export type GetHostSchedulesOptions = {
  hostIds: string[]
  callerMailbox: string
  startTime: GraphDateTimeTimeZone
  endTime: GraphDateTimeTimeZone
  availabilityViewInterval: number
}

/**
 * Resolve hosts to mailboxes and fetch each one's free/busy in a single call.
 *
 * This is the safe, drift-proof entry point for calendar features: it resolves
 * every host through resolveHostEmails, issues Graph getSchedule ONLY for hosts
 * with a valid mailbox (batched to Graph's 20-per-call limit), and returns a
 * "no-calendar" result for the rest — so no lookup is ever attempted without a
 * valid email. Results are returned in the same order as `hostIds`.
 */
export async function getHostSchedules(
  opts: GetHostSchedulesOptions,
): Promise<HostCalendarResult[]> {
  const { hostIds, callerMailbox, startTime, endTime, availabilityViewInterval } = opts

  const resolved = await resolveHostEmails(hostIds)

  // Split hosts into the ones we can query and the ones we can't.
  const queryable: { hostId: string; host: ResolvedHost }[] = []
  const skipped = new Map<string, HostCalendarResult>()
  for (const hostId of hostIds) {
    if (skipped.has(hostId)) continue
    const host = resolved.get(hostId)
    if (!host) {
      skipped.set(hostId, { hostId, status: "no-calendar", displayName: null, reason: "unknown-host" })
    } else if (!host.email) {
      skipped.set(hostId, {
        hostId,
        status: "no-calendar",
        displayName: host.displayName,
        reason: "no-mailbox",
      })
    } else {
      queryable.push({ hostId, host })
    }
  }

  // Query Graph in batches of at most MAX_SCHEDULES_PER_CALL. One Graph
  // scheduleId is returned per requested email, in request order.
  const byHost = new Map<string, HostCalendarResult>()
  for (let i = 0; i < queryable.length; i += MAX_SCHEDULES_PER_CALL) {
    const batch = queryable.slice(i, i + MAX_SCHEDULES_PER_CALL)
    const infos = await getSchedule({
      callerMailbox,
      schedules: batch.map((b) => b.host.email as string),
      startTime,
      endTime,
      availabilityViewInterval,
    })
    batch.forEach((b, idx) => {
      byHost.set(b.hostId, {
        hostId: b.hostId,
        status: "ok",
        email: b.host.email as string,
        displayName: b.host.displayName,
        schedule: infos[idx],
      })
    })
  }

  // Reassemble in the caller's original host order.
  const seen = new Set<string>()
  const out: HostCalendarResult[] = []
  for (const hostId of hostIds) {
    if (seen.has(hostId)) continue
    seen.add(hostId)
    out.push(byHost.get(hostId) ?? skipped.get(hostId)!)
  }
  return out
}

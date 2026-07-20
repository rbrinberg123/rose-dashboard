// Shared server-side loader for Live Outreach.
//
// Fetches v_live_outreach and enriches each confirmed meeting with the
// client<->institution meeting-history flag (NEW / prior-count). Extracted from
// page.tsx verbatim so the page, the email-send route, and the Stage-1 test
// route all build the digest from IDENTICAL data.
//
// Fails soft on the history read exactly as the page did: any error there leaves
// prior_meeting_count = null (no flags shown) rather than wrong flags. Only a
// fatal v_live_outreach fetch error is surfaced via the returned `error`.

import { getSupabaseServer } from "@/lib/supabase"
import type { LiveOutreachRow } from "@/lib/types"

// PostgREST caps a single response at 1,000 rows; the meeting-history read can
// exceed that across all the Live Outreach clients, so we page through it.
const MEETINGS_PAGE_SIZE = 1000

// ---- sort ------------------------------------------------------------------
// Desired order (page + email share this loader, so both get it):
//   1. High-urgency events first (urgency === "High"; the "High Urgency" pill is
//      just the UI label — the stored value is "High").
//   2. Then by the event's start date, soonest first. v_live_outreach has no
//      clean start-date column, so we derive one (see eventStartMs).
//   3. Tiebreaker: alphabetical by client/company name (fallback event name).

/** Best-effort epoch (ms) from the first "M/D" token of the event_dates display
 *  string (e.g. "8/4, 8/5" → Aug 4). No year is stored, so we assume this year
 *  and roll to next year if that date has already passed (these are upcoming
 *  events). Returns +Infinity when nothing parseable is present. Used only to
 *  position events that have no confirmed meetings yet. */
function parseEventDatesStart(eventDates: string | null): number {
  if (!eventDates) return Number.POSITIVE_INFINITY
  const match = eventDates.match(/(\d{1,2})\/(\d{1,2})/)
  if (!match) return Number.POSITIVE_INFINITY
  const month = Number(match[1])
  const day = Number(match[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return Number.POSITIVE_INFINITY

  const now = new Date()
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  let ms = Date.UTC(now.getUTCFullYear(), month - 1, day)
  if (ms < todayUTC) ms = Date.UTC(now.getUTCFullYear() + 1, month - 1, day)
  return ms
}

/** The event's effective start DATE as an epoch (ms) for sorting — truncated to
 *  the UTC calendar day so events sharing a start date tie and fall through to
 *  the alphabetical tiebreaker (day granularity matches the meeting-date display,
 *  which renders by UTC day). Derived from, in order:
 *   - the earliest confirmed meeting date when the event has meetings;
 *   - else the parsed event_dates start (best-effort);
 *   - else +Infinity, so dateless events sort last within their urgency group. */
function eventStartMs(row: LiveOutreachRow): number {
  let min = Number.POSITIVE_INFINITY
  for (const m of row.confirmed_meetings ?? []) {
    const t = Date.parse(m.meeting_date)
    if (!Number.isNaN(t) && t < min) min = t
  }
  if (min !== Number.POSITIVE_INFINITY) {
    const d = new Date(min)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  }
  return parseEventDatesStart(row.event_dates) // already UTC midnight
}

/** Compare two events by the Live Outreach sort order (see the block above). */
function compareLiveOutreach(a: LiveOutreachRow, b: LiveOutreachRow): number {
  // 1. High urgency on top.
  const ah = a.urgency === "High" ? 0 : 1
  const bh = b.urgency === "High" ? 0 : 1
  if (ah !== bh) return ah - bh

  // 2. Start date ascending (soonest first; dateless events last).
  const ad = eventStartMs(a)
  const bd = eventStartMs(b)
  if (ad !== bd) return ad - bd

  // 3. Alphabetical by client/company name (fallback event name).
  const an = (a.client_account_name ?? a.event_name ?? "").toLowerCase()
  const bn = (b.client_account_name ?? b.event_name ?? "").toLowerCase()
  return an.localeCompare(bn)
}

export async function loadLiveOutreachRows(): Promise<{
  rows: LiveOutreachRow[]
  error: string | null
}> {
  const sb = getSupabaseServer()

  // Only ~21 events are in the Live Outreach state — comfortably under the
  // PostgREST 1,000-row cap, so a single fetch is enough. The view is already
  // ordered (ticker, then event name).
  const { data, error } = await sb.from("v_live_outreach").select("*")
  if (error) return { rows: [], error: error.message }

  const rows = (data ?? []) as LiveOutreachRow[]

  // ---- client<->institution meeting history --------------------------------
  // Each confirmed meeting gets a NEW / count flag based on how many OTHER
  // 'Confirmed' meetings (any date) this client has had with that institution.
  // Computed here (no view change) with one paginated read of public.meetings,
  // matched on client_account_id + institution_name (the app treats the
  // institution NAME as the key — see the meetings mirror table). Fails soft:
  // any read error leaves history unavailable so we show NO flags rather than
  // wrong ones.
  const clientIds = Array.from(
    new Set(
      rows.map((r) => r.client_account_id).filter((v): v is string => Boolean(v)),
    ),
  )

  const confirmedByPair = new Map<string, number>()
  const countedMeetingIds = new Set<string>()
  let historyAvailable = clientIds.length > 0

  if (clientIds.length > 0) {
    for (let from = 0; ; from += MEETINGS_PAGE_SIZE) {
      const { data: mrows, error: merr } = await sb
        .from("meetings")
        .select("client_account_id, institution_name, meeting_id")
        .in("client_account_id", clientIds)
        .eq("meeting_status_label", "Confirmed")
        .range(from, from + MEETINGS_PAGE_SIZE - 1)

      if (merr) {
        historyAvailable = false
        break
      }
      const batch = mrows ?? []
      for (const m of batch) {
        if (!m.client_account_id || !m.institution_name) continue
        const key = `${m.client_account_id}|${m.institution_name}`
        confirmedByPair.set(key, (confirmedByPair.get(key) ?? 0) + 1)
        countedMeetingIds.add(m.meeting_id as string)
      }
      if (batch.length < MEETINGS_PAGE_SIZE) break
    }
  }

  // ---- per-meeting live flag + city ----------------------------------------
  // v_live_outreach's confirmed_meetings JSON carries no live/city info, so we
  // look it up from public.meetings for exactly the meetings shown: is_in_person
  // (Live vs Virtual) and the city NAME, which lives only inside the raw Dynamics
  // blob under _bcs_city_value's FormattedValue (there is no cities lookup table).
  // Fails soft — any error just leaves meetings without the Live/city pill.
  const shownMeetingIds = Array.from(
    new Set(
      rows.flatMap((r) => (r.confirmed_meetings ?? []).map((m) => m.meeting_id)).filter(Boolean),
    ),
  )
  const meetingLoc = new Map<string, { isInPerson: boolean; city: string | null }>()
  if (shownMeetingIds.length > 0) {
    const { data: locRows } = await sb
      .from("meetings")
      // Pull the city straight out of _raw's formatted value (a lean JSON-path
      // select, so we don't fetch the whole blob).
      .select(
        'meeting_id,is_in_person,city:_raw->>"_bcs_city_value@OData.Community.Display.V1.FormattedValue"',
      )
      .in("meeting_id", shownMeetingIds)
    for (const row of locRows ?? []) {
      meetingLoc.set(row.meeting_id as string, {
        isInPerson: row.is_in_person === true,
        city: (row.city as string | null) || null,
      })
    }
  }

  const enriched: LiveOutreachRow[] = rows.map((r) => ({
    ...r,
    confirmed_meetings: (r.confirmed_meetings ?? []).map((m) => {
      let prior: number | null = null
      if (historyAvailable && r.client_account_id && m.institution_name) {
        const key = `${r.client_account_id}|${m.institution_name}`
        const total = confirmedByPair.get(key) ?? 0
        // Subtract the current meeting itself when it is in the counted set.
        prior = Math.max(0, total - (countedMeetingIds.has(m.meeting_id) ? 1 : 0))
      }
      const loc = meetingLoc.get(m.meeting_id)
      return {
        ...m,
        prior_meeting_count: prior,
        is_in_person: loc?.isInPerson ?? null,
        city: loc?.city ?? null,
      }
    }),
  }))

  // Sort in place: High urgency → start date ascending → alphabetical. Both the
  // page and the email consume this order (they render rows as-given).
  enriched.sort(compareLiveOutreach)

  return { rows: enriched, error: null }
}

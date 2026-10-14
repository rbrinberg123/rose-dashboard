import { getSupabaseServer } from "@/lib/supabase"
import type { MarketingEventMeeting } from "@/lib/types"

/**
 * The ONE event → confirmed-meetings read, shared by every page that drills into
 * a marketing event (Client Detail's "Marketing Events & Dates" block and the
 * To-Do List's event cluster), so the two can never drift apart.
 *
 * Uses the same meetings→event link (`meetings.event_id`, from Dynamics
 * `_bcs_event_value`) and the same status field (`meeting_status_label =
 * 'Confirmed'`) the Planning and Live Outreach views use, and selects the same
 * fields the detail pane renders.
 *
 * SCOPING: this takes event ids the CALLER has already scope-checked — it does
 * no scoping of its own. Both callers pass ids drawn from rows their loader
 * already filtered by client scope, so the read is scoped implicitly.
 *
 * Fail-soft, matching the original inline read: a query error yields an empty
 * map rather than throwing, so a drill-in that can't load degrades to "no
 * confirmed meetings" instead of blanking the page.
 */
export async function loadConfirmedMeetingsByEvent(
  eventIds: readonly (string | null | undefined)[],
): Promise<Record<string, MarketingEventMeeting[]>> {
  const ids = Array.from(new Set(eventIds.filter((id): id is string => Boolean(id))))
  const byEvent: Record<string, MarketingEventMeeting[]> = {}
  if (ids.length === 0) return byEvent

  const sb = getSupabaseServer()
  const { data } = await sb
    .from("meetings")
    .select("event_id, meeting_id, meeting_date, institution_name, investor_text")
    .in("event_id", ids)
    .eq("meeting_status_label", "Confirmed")

  for (const r of data ?? []) {
    const row = r as {
      event_id: string | null
      meeting_id: string
      meeting_date: string | null
      institution_name: string | null
      investor_text: string | null
    }
    if (!row.event_id) continue
    const meeting: MarketingEventMeeting = {
      meeting_id: row.meeting_id,
      meeting_date: row.meeting_date,
      institution_name: row.institution_name,
      investor_text: row.investor_text,
    }
    const list = byEvent[row.event_id]
    if (list) list.push(meeting)
    else byEvent[row.event_id] = [meeting]
  }
  return byEvent
}

/** One meeting row of the event drawer / Edit Event "Meetings & Reports" lists. */
export type EventMeetingRow = {
  meeting_id: string
  meeting_date: string | null
  institution_name: string | null
  investor_text: string | null
  host_name: string | null
  booker_name: string | null
  meeting_status_label: string | null
  state_label: string | null
  feedback_status_label: string | null
  fb_received_date: string | null
  /** 'dashboard' | 'dynamics' — decides editable form vs read-only record on click. */
  origin: string | null
}

/**
 * EVERY meeting of ONE event — all statuses (Confirmed, Pending, TBR,
 * Cancelled) and both origins — for the event drawer's Meetings & Reports tab
 * (the read-only list on Dynamics events) and the tab count badges. Unlike
 * loadConfirmedMeetingsByEvent above it is NOT confirmed-only: an event's
 * meeting list has to show pending and cancelled meetings too. Same link
 * (`meetings.event_id`, from Dynamics `_bcs_event_value`).
 *
 * The CALLER gates access (super user) — no scoping here. Unlike the batch
 * read above it reports a query error, so the list can say it failed.
 */
export async function loadEventMeetings(
  eventId: string,
): Promise<{ ok: true; rows: EventMeetingRow[] } | { ok: false; error: string }> {
  const { data, error } = await getSupabaseServer()
    .from("meetings")
    .select(
      "meeting_id, meeting_date, institution_name, investor_text, host_name, booker_name, meeting_status_label, state_label, feedback_status_label, fb_received_date, origin",
    )
    .eq("event_id", eventId)
    .order("meeting_date", { ascending: true, nullsFirst: false })
  if (error) return { ok: false, error: error.message }
  return { ok: true, rows: (data ?? []) as EventMeetingRow[] }
}

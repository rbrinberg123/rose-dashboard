"use server"

/**
 * Admin → Events Planner — server actions. The ONLY writer of the ep_* tables.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * App traffic uses the service-role key, which BYPASSES RLS, so these checks are
 * the real gate (proxy.ts keeps non-super-users off the page; server actions are
 * their own entry points and must re-check):
 *   - reads:  effective role must be super_user (View-as previews the denial);
 *   - writes: requireCrmWriter — super_user AND not in "View as".
 * Every write is audited (recordAudit) and logged to ep_activity_log.
 *
 * CRM mirrors (events, meetings, contacts, accounts) are READ here, never
 * written. Ids coming from the browser are re-read server-side before use.
 */

import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import { getEffectiveRole } from "@/lib/effective-identity"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { isIsoDate, isUuid, loadAccountOptions, requireCrmWriter, resolveAccount } from "@/lib/crm-write"
import type { AccountOption } from "@/lib/types"
import {
  HOME_TZ,
  MAX_ITINERARY_DAYS,
  enumerateDates,
  planCrmMeetings,
  proposeDateRange,
  todayHome,
  type CrmMeetingRow,
} from "@/lib/events-planner/core"
import type {
  ContactOption,
  CrmEventOption,
  CrmEventPreview,
  NewItineraryInput,
  TypeOption,
} from "@/lib/events-planner/types"

const PATH = "/admin/events"

async function requireRead(): Promise<string | null> {
  const role = await getEffectiveRole()
  return role === "super_user" ? null : "Not authorised."
}

const EVENT_COLS =
  "event_id, name, client_account_id, client_account_name, event_start_actual, event_end_actual, event_state_label, event_location, dates"

const MEETING_COLS =
  "meeting_id, meeting_date, origin, meeting_status_label, meeting_type_label, is_in_person, group_meeting, hosted_in_hq, institution_id, institution_name, investor_text, city_name, state_region_name"

/* ------------------------------------------------------------- pickers */

/** Clients for the blank-itinerary picker. */
export async function loadPlannerClientOptions(): Promise<ActionResult<AccountOption[]>> {
  return loadAccountOptions()
}

/** Active event types, in order. */
export async function loadEventTypeOptions(): Promise<ActionResult<TypeOption[]>> {
  const denied = await requireRead()
  if (denied) return fail(denied)
  const { data, error } = await getSupabaseServer()
    .from("ep_event_types")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order")
    .order("name")
  if (error) return fail(describeError(error))
  return ok((data ?? []) as TypeOption[])
}

/** Strip characters that would break a PostgREST `or=(…)` filter. */
function searchTerm(q: string): string {
  return q.replace(/[,()%_*\\:"']/g, " ").trim().slice(0, 80)
}

/**
 * CRM events for the "From CRM event" picker — upcoming first (soonest at the
 * top), then past (most recent first). With no search text: events whose
 * meetings end within the last 30 days or later.
 */
export async function searchCrmEvents(q: string): Promise<ActionResult<CrmEventOption[]>> {
  const denied = await requireRead()
  if (denied) return fail(denied)

  let query = getSupabaseServer().from("events").select(EVENT_COLS).limit(100)
  const term = searchTerm(q ?? "")
  if (term) {
    query = query.or(`name.ilike.%${term}%,client_account_name.ilike.%${term}%`)
  } else {
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()
    query = query.gte("event_end_actual", cutoff).order("event_start_actual", { ascending: true })
  }
  const { data, error } = await query
  if (error) return fail(describeError(error))

  const today = todayHome()
  const rows = (data ?? []) as CrmEventOption[]
  const day = (r: CrmEventOption) => (r.event_end_actual ?? r.event_start_actual ?? "").slice(0, 10)
  const upcoming = rows.filter((r) => day(r) >= today)
  const past = rows.filter((r) => day(r) && day(r) < today)
  const undated = rows.filter((r) => !day(r))
  upcoming.sort((a, b) => (a.event_start_actual ?? "").localeCompare(b.event_start_actual ?? ""))
  past.sort((a, b) => day(b).localeCompare(day(a)))
  return ok([...upcoming, ...past, ...undated].slice(0, 60))
}

/** Contacts at one client company (either CRM company link), active first. */
async function loadClientContacts(accountId: string): Promise<ContactOption[]> {
  const { data } = await getSupabaseServer()
    .from("contacts")
    .select("contact_id, full_name, job_title, email, state_label")
    .or(`parent_customer_id.eq.${accountId},company_master_record_id.eq.${accountId}`)
    .order("full_name")
    .limit(300)
  return ((data ?? []) as (ContactOption & { state_label: string | null })[])
    .filter((c) => (c.state_label ?? "").trim().toLowerCase() !== "inactive")
    .map(({ contact_id, full_name, job_title, email }) => ({ contact_id, full_name, job_title, email }))
}

/** Client contacts for an itinerary's client (blank flow, after picking a client). */
export async function loadClientContactOptions(accountId: string): Promise<ActionResult<ContactOption[]>> {
  const denied = await requireRead()
  if (denied) return fail(denied)
  if (!isUuid(accountId)) return ok([])
  return ok(await loadClientContacts(accountId))
}

/** Everything the import preview shows for one CRM event. Reads only. */
export async function previewCrmEvent(eventId: string): Promise<ActionResult<CrmEventPreview>> {
  const denied = await requireRead()
  if (denied) return fail(denied)
  if (!isUuid(eventId)) return fail("Unknown event.")

  const sb = getSupabaseServer()
  const [evRes, mtRes, typesRes] = await Promise.all([
    sb.from("events").select(`${EVENT_COLS}, event_type_label`).eq("event_id", eventId).maybeSingle(),
    sb.from("meetings").select(MEETING_COLS).eq("event_id", eventId).order("meeting_date").limit(500),
    sb.from("ep_event_types").select("id, name, crm_type_label").eq("is_active", true),
  ])
  if (evRes.error) return fail(describeError(evRes.error))
  if (!evRes.data) return fail("That CRM event no longer exists.")
  if (mtRes.error) return fail(describeError(mtRes.error))
  if (typesRes.error) return fail(`${describeError(typesRes.error)} — has the Events Planner SQL been run?`)

  const event = evRes.data as CrmEventPreview["event"]
  const meetings = (mtRes.data ?? []) as CrmMeetingRow[]
  const contacts = event.client_account_id ? await loadClientContacts(event.client_account_id) : []
  const { startDate, endDate } = proposeDateRange(event, meetings, todayHome())

  // CRM type → planner type: an explicit crm_type_label mapping, else a name
  // match, else "Other".
  const types = (typesRes.data ?? []) as { id: string; name: string; crm_type_label: string | null }[]
  const label = (event.event_type_label ?? "").trim().toLowerCase()
  const mapped =
    (label &&
      (types.find((t) => (t.crm_type_label ?? "").trim().toLowerCase() === label) ??
        types.find((t) => t.name.toLowerCase() === label))) ||
    types.find((t) => t.name === "Other") ||
    null

  return ok({
    event,
    meetings,
    contacts,
    proposedStart: startDate,
    proposedEnd: endDate,
    eventTypeId: mapped?.id ?? null,
  })
}

/* -------------------------------------------------------------- create */

/**
 * Create an itinerary + one day per date + the chosen imported meetings + the
 * chosen client contacts. Not one transaction (PostgREST), so any failure after
 * the itinerary row exists deletes it again — the rest cascades.
 */
export async function createItinerary(input: NewItineraryInput): Promise<ActionResult<{ id: string }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("creating itineraries")
  if (!gate.ok) return fail(gate.error)

  const title = (input.title ?? "").trim()
  if (!title) return fail("Enter a title.")
  if (!isIsoDate(input.startDate) || !isIsoDate(input.endDate)) return fail("Enter a start and end date.")
  const dates = enumerateDates(input.startDate, input.endDate)
  if (dates.length === 0) return fail("The end date must be on or after the start date.")
  if (dates.length > MAX_ITINERARY_DAYS) return fail(`An itinerary can be at most ${MAX_ITINERARY_DAYS} days.`)
  const minutes = Math.round(Number(input.defaultMeetingMinutes))
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 600) return fail("Meeting length must be 5–600 minutes.")

  const sb = getSupabaseServer()

  // Re-read everything the browser named.
  const client = await resolveAccount(input.clientAccountId)
  if (!client.ok) return fail(client.error)

  let crmEvent: { event_id: string; name: string | null } | null = null
  if (input.crmEventId) {
    if (!isUuid(input.crmEventId)) return fail("Unknown event.")
    const { data, error } = await sb.from("events").select("event_id, name").eq("event_id", input.crmEventId).maybeSingle()
    if (error) return fail(describeError(error))
    if (!data) return fail("That CRM event no longer exists.")
    crmEvent = data as { event_id: string; name: string | null }
  }

  let eventTypeId: string | null = null
  if (input.eventTypeId) {
    if (!isUuid(input.eventTypeId)) return fail("Unknown event type.")
    const { data } = await sb.from("ep_event_types").select("id").eq("id", input.eventTypeId).maybeSingle()
    if (!data) return fail("That event type no longer exists.")
    eventTypeId = input.eventTypeId
  }

  const meetingIds = crmEvent ? [...new Set(input.importMeetingIds ?? [])].filter(isUuid) : []
  let meetingRows: CrmMeetingRow[] = []
  if (meetingIds.length) {
    const { data, error } = await sb
      .from("meetings")
      .select(MEETING_COLS)
      .in("meeting_id", meetingIds)
      .eq("event_id", crmEvent!.event_id) // only that event's meetings
    if (error) return fail(describeError(error))
    meetingRows = (data ?? []) as CrmMeetingRow[]
  }

  const contactIds = [...new Set(input.contactIds ?? [])].filter(isUuid)
  let contactRows: {
    contact_id: string
    full_name: string | null
    email: string | null
    mobile_phone: string | null
    direct_phone: string | null
    job_title: string | null
  }[] = []
  if (contactIds.length) {
    const { data, error } = await sb
      .from("contacts")
      .select("contact_id, full_name, email, mobile_phone, direct_phone, job_title")
      .in("contact_id", contactIds)
    if (error) return fail(describeError(error))
    contactRows = (data ?? []) as typeof contactRows
  }

  const { data: mtypes, error: mtErr } = await sb.from("ep_meeting_types").select("id, name")
  if (mtErr) return fail(`${describeError(mtErr)} — has the Events Planner SQL been run?`)
  const meetingTypeId = new Map(((mtypes ?? []) as TypeOption[]).map((t) => [t.name, t.id]))

  const who = { created_by_id: gate.userId, created_by_name: gate.name, updated_by_id: gate.userId, updated_by_name: gate.name }

  // ---- 1. itinerary ----
  const { data: itin, error: iErr } = await sb
    .from("ep_itineraries")
    .insert({
      crm_event_id: crmEvent?.event_id ?? null,
      client_company_id: client.data?.account_id ?? null,
      title,
      subtitle: (input.subtitle ?? "").trim() || null,
      event_type_id: eventTypeId,
      start_date: input.startDate,
      end_date: input.endDate,
      home_timezone: HOME_TZ,
      default_meeting_minutes: minutes,
      organizer_user_id: gate.userId,
      organizer_name: gate.name,
      ...who,
    })
    .select("id")
    .single()
  if (iErr) return fail(describeError(iErr))
  const id = (itin as { id: string }).id

  const rollback = async (msg: string) => {
    await sb.from("ep_itineraries").delete().eq("id", id)
    return fail(msg)
  }

  // ---- 2. days (Eastern by default; cities from the imported meetings) ----
  const plan = planCrmMeetings(meetingRows, { startDate: input.startDate, endDate: input.endDate, meetingMinutes: minutes })
  const importable = plan.filter((p) => !p.problem && p.startIso && p.endIso && p.date)
  const cityFor = (date: string) => {
    const counts = new Map<string, number>()
    for (const p of importable) if (p.date === date && p.city) counts.set(p.city, (counts.get(p.city) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }
  const { data: dayRows, error: dErr } = await sb
    .from("ep_days")
    .insert(dates.map((date, i) => ({ itinerary_id: id, date, timezone: HOME_TZ, city: cityFor(date), day_title: cityFor(date), sort_order: i })))
    .select("id, date")
  if (dErr) return rollback(describeError(dErr))
  const dayId = new Map(((dayRows ?? []) as { id: string; date: string }[]).map((d) => [d.date, d.id]))

  // ---- 3. imported meetings ----
  if (importable.length) {
    const perDay = new Map<string, number>()
    const items = importable.map((p) => {
      const n = perDay.get(p.date!) ?? 0
      perDay.set(p.date!, n + 1)
      return {
        itinerary_id: id,
        day_id: dayId.get(p.date!)!,
        item_type: "meeting",
        crm_meeting_id: p.crmMeetingId,
        title: p.title,
        start_at: p.startIso,
        end_at: p.endIso,
        timezone: HOME_TZ,
        meeting_type_id: meetingTypeId.get(p.meetingTypeName) ?? null,
        institution_name: p.institutionName,
        institution_crm_id: p.institutionCrmId && isUuid(p.institutionCrmId) ? p.institutionCrmId : null,
        city: p.city,
        state: p.state,
        at_investor_office: p.atInvestorOffice,
        status: p.status,
        notes_internal: p.investorText ? `Investor(s) per CRM: ${p.investorText}` : null,
        send_invite: true,
        sort_order: n,
        ...who,
      }
    })
    const { error } = await sb.from("ep_items").insert(items)
    if (error) return rollback(describeError(error))
  }

  // ---- 4. client contacts as attendees ----
  if (contactRows.length) {
    const { error } = await sb.from("ep_attendees").insert(
      contactRows.map((c, i) => ({
        itinerary_id: id,
        crm_contact_id: c.contact_id,
        full_name: c.full_name?.trim() || "(no name)",
        email: c.email?.trim() || null,
        phone: c.mobile_phone?.trim() || c.direct_phone?.trim() || null,
        title: c.job_title?.trim() || null,
        company: client.data?.name ?? null,
        role: "client_executive",
        side: "client",
        receives_full_itinerary: true,
        sort_order: i,
      })),
    )
    if (error) return rollback(describeError(error))
  }

  const summary = {
    title,
    crm_event_id: crmEvent?.event_id ?? null,
    crm_event_name: crmEvent?.name ?? null,
    client: client.data?.name ?? null,
    start_date: input.startDate,
    end_date: input.endDate,
    days: dates.length,
    meetings_imported: importable.length,
    meetings_skipped: meetingRows.length - importable.length,
    attendees_added: contactRows.length,
    default_meeting_minutes: minutes,
  }
  await sb.from("ep_activity_log").insert({
    itinerary_id: id,
    actor_id: gate.userId,
    actor_name: gate.name,
    action: "created",
    details: summary,
  })
  await recordAudit({
    action: "create",
    entity: "ep_itineraries",
    recordId: id,
    changes: summary,
    context: `${PATH} · New itinerary${crmEvent ? " (from CRM event)" : ""}`,
  })

  revalidatePath(PATH)
  return ok({ id })
}

/* -------------------------------------------------------------- delete */

/** Delete an itinerary and everything on it (days, items, attendees… cascade). */
export async function deleteItinerary(id: string): Promise<ActionResult<undefined>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("deleting itineraries")
  if (!gate.ok) return fail(gate.error)
  if (!isUuid(id)) return fail("Unknown itinerary.")

  const sb = getSupabaseServer()
  // Real invites still on people's calendars would be orphaned (they cascade away).
  const { count: live } = await sb
    .from("ep_invites")
    .select("id, ep_items!inner(itinerary_id)", { count: "exact", head: true })
    .eq("ep_items.itinerary_id", id)
    .in("status", ["sent", "updated", "update_pending"])
    .eq("dry_run", false)
  if (live) return fail(`${live} calendar invite${live === 1 ? " is" : "s are"} still out. Cancel the items and send the cancellations before deleting.`)
  const { data, error } = await sb
    .from("ep_itineraries")
    .delete()
    .eq("id", id)
    .select("id, title, crm_event_id, client_company_id, start_date, end_date, status")
  if (error) return fail(describeError(error))
  const row = (data ?? [])[0]
  if (!row) return fail("That itinerary no longer exists.")

  await recordAudit({
    action: "delete",
    entity: "ep_itineraries",
    recordId: id,
    changes: row,
    context: `${PATH} · Delete itinerary`,
  })
  revalidatePath(PATH)
  return ok(undefined)
}

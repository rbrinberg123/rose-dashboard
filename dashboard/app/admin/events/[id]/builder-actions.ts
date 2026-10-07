"use server"

/**
 * Events Planner builder — server actions for one itinerary's days, items and
 * attendees.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * Service-role client (RLS bypassed), so EVERY action gates itself first:
 *   - writes: requireCrmWriter — super_user AND not in "View as";
 *   - reads (pickers): effective role must be super_user.
 * Every id from the browser is re-read and must belong to the itinerary being
 * edited. Each write updates the itinerary's updated_by, is audited
 * (recordAudit) and logged to ep_activity_log.
 *
 * EDIT AFTER FINALISE: any change to a finalized / invites-sent itinerary sends
 * it back to "in_review" (the builder shows a banner).
 *
 * CRM mirrors are only READ (contact search, staff picker).
 */

import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import { getEffectiveRole } from "@/lib/effective-identity"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { isIsoDate, isUuid, requireCrmWriter } from "@/lib/crm-write"
import { buildIdentityIndex } from "@/lib/access/identity-index"
import {
  ITEM_TYPES,
  TRAVEL_MODES,
  checkSchedule,
  isValidTimeZone,
  keepWallClock,
  resolveTimes,
  shiftIso,
  zonedToIso,
} from "@/lib/events-planner/core"
import { loadBuilderBlock, loadBuilderItem, loadBuilderItinerary } from "@/lib/events-planner/load"
import { getTravelTimeProvider } from "@/lib/events-planner/travel-time"
import {
  ATTENDEE_ROLES,
  ATTENDEE_SIDES,
  type AttendeeInput,
  type BlockInput,
  type BuilderAttendee,
  type BuilderBlock,
  type CrossBooking,
  type BuilderDay,
  type BuilderItem,
  type ContactSearchRow,
  type ItemInput,
  type ItineraryStatus,
  type StaffOption,
} from "@/lib/events-planner/types"

type Gate = { userId: string | null; name: string | null }
type Sb = ReturnType<typeof getSupabaseServer>

/** Every write returns the itinerary's status, which an edit may have changed. */
type WithStatus<T> = T & { status: ItineraryStatus }

const STATUSES = ["tentative", "confirmed", "cancelled"] as const

const txt = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim()
  return s === "" ? null : s
}

async function writeGate(verb: string): Promise<{ ok: true; gate: Gate } | { ok: false; error: string }> {
  const g = await requireCrmWriter(verb)
  if (!g.ok) return { ok: false, error: g.error }
  return { ok: true, gate: { userId: g.userId, name: g.name } }
}

/**
 * Stamp who changed the itinerary; send a finalized one back to review. Returns
 * the resulting status.
 */
async function touch(sb: Sb, itineraryId: string, gate: Gate): Promise<ItineraryStatus> {
  const { data } = await sb.from("ep_itineraries").select("status").eq("id", itineraryId).maybeSingle()
  const current = ((data as { status: ItineraryStatus } | null)?.status ?? "draft") as ItineraryStatus
  const next: ItineraryStatus = current === "finalized" || current === "invites_sent" ? "in_review" : current
  await sb
    .from("ep_itineraries")
    .update({ updated_by_id: gate.userId, updated_by_name: gate.name, ...(next !== current ? { status: next } : {}) })
    .eq("id", itineraryId)
  if (next !== current) await log(sb, itineraryId, gate, "returned_to_review", { from: current })
  return next
}

async function log(sb: Sb, itineraryId: string, gate: Gate, action: string, details: Record<string, unknown>) {
  await sb.from("ep_activity_log").insert({
    itinerary_id: itineraryId,
    actor_id: gate.userId,
    actor_name: gate.name,
    action,
    details,
  })
}

async function audit(
  action: "create" | "update" | "delete",
  entity: string,
  recordId: string,
  itineraryId: string,
  changes: unknown,
  what: string,
) {
  await recordAudit({ action, entity, recordId, changes, context: `/admin/events/${itineraryId} · ${what}` })
}

function revalidate(itineraryId: string) {
  revalidatePath(`/admin/events/${itineraryId}`)
  revalidatePath("/admin/events")
}

async function loadDay(sb: Sb, dayId: string): Promise<(BuilderDay & { itinerary_id: string }) | null> {
  if (!isUuid(dayId)) return null
  const { data } = await sb
    .from("ep_days")
    .select("id, itinerary_id, date, city, timezone, day_title, day_notes, sort_order")
    .eq("id", dayId)
    .maybeSingle()
  return (data as (BuilderDay & { itinerary_id: string }) | null) ?? null
}

/**
 * Real (not dry-run) invites still on people's calendars for these items /
 * this person. Deleting would orphan them — the caller refuses and asks for
 * Cancel + "Cancel invites for cancelled items" first.
 */
async function liveInviteCount(sb: Sb, column: "item_id" | "attendee_id", ids: string[]): Promise<number> {
  if (!ids.length) return 0
  const { count } = await sb
    .from("ep_invites")
    .select("id", { count: "exact", head: true })
    .in(column, ids)
    .in("status", ["sent", "updated", "update_pending"])
    .eq("dry_run", false)
  return count ?? 0
}

async function itemOwner(sb: Sb, itemId: string): Promise<{ itinerary_id: string; day_id: string } | null> {
  if (!isUuid(itemId)) return null
  const { data } = await sb.from("ep_items").select("itinerary_id, day_id").eq("id", itemId).maybeSingle()
  return (data as { itinerary_id: string; day_id: string } | null) ?? null
}

/** Keep the itinerary's start/end equal to its first/last day. */
async function syncDateRange(sb: Sb, itineraryId: string) {
  const { data } = await sb.from("ep_days").select("date").eq("itinerary_id", itineraryId).order("date")
  const dates = ((data ?? []) as { date: string }[]).map((d) => d.date)
  if (dates.length) {
    await sb.from("ep_itineraries").update({ start_date: dates[0], end_date: dates[dates.length - 1] }).eq("id", itineraryId)
  }
}

/* ================================================================ settings */

export type SettingsInput = {
  title: string
  subtitle: string
  eventTypeId: string | null
  clientNameOverride: string
  defaultMeetingMinutes: number
  bufferCarMinutes: number
  bufferWalkMinutes: number
  airportLeadMinutes: number
  internalNotes: string
  clientNotes: string
  confidential: boolean
}

export async function updateItinerarySettings(
  itineraryId: string,
  input: SettingsInput,
): Promise<ActionResult<{ status: ItineraryStatus }>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  if (!isUuid(itineraryId)) return fail("Unknown itinerary.")
  const title = (input.title ?? "").trim()
  if (!title) return fail("Enter a title.")
  const minutes = Math.round(Number(input.defaultMeetingMinutes))
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 600) return fail("Meeting length must be 5–600 minutes.")
  if (input.eventTypeId && !isUuid(input.eventTypeId)) return fail("Unknown event type.")
  const whole = (v: number, max: number) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null
  }
  const bufCar = whole(input.bufferCarMinutes, 240)
  const bufWalk = whole(input.bufferWalkMinutes, 240)
  const lead = whole(input.airportLeadMinutes, 480)
  if (bufCar == null || bufWalk == null) return fail("Buffers must be 0–240 minutes.")
  if (lead == null) return fail("Airport lead time must be 0–480 minutes.")

  const sb = getSupabaseServer()
  const { data: before } = await sb.from("ep_itineraries").select("*").eq("id", itineraryId).maybeSingle()
  if (!before) return fail("That itinerary no longer exists.")
  const patch = {
    title,
    subtitle: txt(input.subtitle),
    event_type_id: input.eventTypeId || null,
    client_name_override: txt(input.clientNameOverride),
    default_meeting_minutes: minutes,
    internal_notes: txt(input.internalNotes),
    client_notes: txt(input.clientNotes),
    confidential: !!input.confidential,
    buffer_car_minutes: bufCar,
    buffer_walk_minutes: bufWalk,
    airport_lead_minutes: lead,
  }
  const { error } = await sb.from("ep_itineraries").update(patch).eq("id", itineraryId)
  if (error) return fail(describeError(error))
  const status = await touch(sb, itineraryId, g.gate)
  await log(sb, itineraryId, g.gate, "settings_updated", { title })
  await audit("update", "ep_itineraries", itineraryId, itineraryId, { before, after: patch }, "Edit settings")
  revalidate(itineraryId)
  return ok({ status })
}

/* ==================================================================== days */

export type DayInput = { date: string; city: string; timezone: string; dayTitle: string; dayNotes: string }

export async function addDay(
  itineraryId: string,
  input: DayInput,
): Promise<ActionResult<WithStatus<{ day: BuilderDay }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  if (!isUuid(itineraryId)) return fail("Unknown itinerary.")
  if (!isIsoDate(input.date)) return fail("Pick a date.")
  if (!isValidTimeZone(input.timezone)) return fail("Pick a time zone.")

  const sb = getSupabaseServer()
  const { data: days } = await sb.from("ep_days").select("date").eq("itinerary_id", itineraryId)
  if (!days) return fail("That itinerary no longer exists.")
  if ((days as { date: string }[]).some((d) => d.date === input.date)) return fail("That date is already a day.")
  if (days.length >= 31) return fail("An itinerary can be at most 31 days.")

  const { data, error } = await sb
    .from("ep_days")
    .insert({
      itinerary_id: itineraryId,
      date: input.date,
      city: txt(input.city),
      timezone: input.timezone,
      day_title: txt(input.dayTitle) ?? txt(input.city),
      day_notes: txt(input.dayNotes),
      sort_order: days.length,
    })
    .select("id, date, city, timezone, day_title, day_notes, sort_order")
    .single()
  if (error) return fail(describeError(error))
  await syncDateRange(sb, itineraryId)
  const status = await touch(sb, itineraryId, g.gate)
  await log(sb, itineraryId, g.gate, "day_added", { date: input.date, city: txt(input.city) })
  await audit("create", "ep_days", (data as BuilderDay).id, itineraryId, data, "Add day")
  revalidate(itineraryId)
  return ok({ day: data as BuilderDay, status })
}

/**
 * Edit a day. Changing its time zone keeps every block's CLOCK time (a 10:00
 * meeting stays at 10:00, now in the new zone) — the usual reason to change it
 * is "this day is actually in Chicago".
 */
export async function updateDay(
  dayId: string,
  input: Omit<DayInput, "date">,
): Promise<ActionResult<WithStatus<{ day: BuilderDay; items: BuilderItem[]; blocks: BuilderBlock[] }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  if (!isValidTimeZone(input.timezone)) return fail("Pick a time zone.")
  const sb = getSupabaseServer()
  const day = await loadDay(sb, dayId)
  if (!day) return fail("That day no longer exists.")

  const patch = {
    city: txt(input.city),
    timezone: input.timezone,
    day_title: txt(input.dayTitle),
    day_notes: txt(input.dayNotes),
  }
  const { data, error } = await sb
    .from("ep_days")
    .update(patch)
    .eq("id", dayId)
    .select("id, date, city, timezone, day_title, day_notes, sort_order")
    .single()
  if (error) return fail(describeError(error))

  const changed: BuilderItem[] = []
  if (day.timezone !== input.timezone) {
    const { data: its } = await sb
      .from("ep_items")
      .select("id, start_at, end_at, timezone")
      .eq("day_id", dayId)
      .eq("timezone", day.timezone)
    for (const it of (its ?? []) as { id: string; start_at: string; end_at: string; timezone: string }[]) {
      await sb
        .from("ep_items")
        .update({
          start_at: keepWallClock(it.start_at, day.timezone, input.timezone),
          end_at: keepWallClock(it.end_at, day.timezone, input.timezone),
          timezone: input.timezone,
        })
        .eq("id", it.id)
      const fresh = await loadBuilderItem(sb, it.id)
      if (fresh) changed.push(fresh)
    }
  }
  // Availability blocks on the day keep their clock times too.
  const changedBlocks: BuilderBlock[] = []
  if (day.timezone !== input.timezone) {
    const { data: bl } = await sb
      .from("ep_availability_blocks")
      .select("id, start_at, end_at")
      .eq("day_id", dayId)
    for (const b of (bl ?? []) as { id: string; start_at: string; end_at: string }[]) {
      await sb
        .from("ep_availability_blocks")
        .update({
          start_at: keepWallClock(b.start_at, day.timezone, input.timezone),
          end_at: keepWallClock(b.end_at, day.timezone, input.timezone),
          timezone: input.timezone,
        })
        .eq("id", b.id)
      const fresh = await loadBuilderBlock(sb, b.id)
      if (fresh) changedBlocks.push(fresh)
    }
  }

  const status = await touch(sb, day.itinerary_id, g.gate)
  await log(sb, day.itinerary_id, g.gate, "day_updated", { date: day.date, ...patch, items_retimed: changed.length })
  await audit("update", "ep_days", dayId, day.itinerary_id, { before: day, after: patch }, "Edit day")
  revalidate(day.itinerary_id)
  return ok({ day: data as BuilderDay, items: changed, blocks: changedBlocks, status })
}

export async function deleteDay(dayId: string): Promise<ActionResult<WithStatus<{ removedItemIds: string[] }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  const sb = getSupabaseServer()
  const day = await loadDay(sb, dayId)
  if (!day) return fail("That day no longer exists.")
  const { count } = await sb.from("ep_days").select("id", { count: "exact", head: true }).eq("itinerary_id", day.itinerary_id)
  if ((count ?? 0) <= 1) return fail("An itinerary needs at least one day.")

  const { data: its } = await sb.from("ep_items").select("id, title").eq("day_id", dayId)
  if (await liveInviteCount(sb, "item_id", ((its ?? []) as { id: string }[]).map((i) => i.id)))
    return fail("Invites have been sent for items on this day. Cancel those items and send the cancellations first.")
  const { error } = await sb.from("ep_days").delete().eq("id", dayId) // items cascade
  if (error) return fail(describeError(error))
  await syncDateRange(sb, day.itinerary_id)
  const status = await touch(sb, day.itinerary_id, g.gate)
  const removed = ((its ?? []) as { id: string; title: string }[])
  await log(sb, day.itinerary_id, g.gate, "day_removed", { date: day.date, items_removed: removed.map((i) => i.title) })
  await audit("delete", "ep_days", dayId, day.itinerary_id, { ...day, items_removed: removed }, "Remove day")
  revalidate(day.itinerary_id)
  return ok({ removedItemIds: removed.map((i) => i.id), status })
}

/* =================================================================== items */

/** Validate an item form and turn it into ep_items / ep_travel_legs / ep_hotels rows. */
function buildItemRows(input: ItemInput, day: BuilderDay) {
  if (!(ITEM_TYPES as readonly string[]).includes(input.itemType)) return { error: "Unknown item type." } as const
  if (!(STATUSES as readonly string[]).includes(input.status)) return { error: "Unknown status." } as const
  const title = (input.title ?? "").trim()
  if (!title) return { error: "Enter a title." } as const

  const isTravel = input.itemType === "travel"
  const mode = input.travel?.mode ?? "car_service"
  if (isTravel && !(TRAVEL_MODES as readonly string[]).includes(mode)) return { error: "Unknown travel mode." } as const
  const crossZone = isTravel && (mode === "flight" || mode === "train") && !!input.travel?.toTimezone
  if (crossZone && !isValidTimeZone(input.travel!.toTimezone)) return { error: "Unknown arrival time zone." } as const

  const times = resolveTimes({
    dayDate: day.date,
    dayTz: day.timezone,
    startTime: input.startTime,
    endTime: input.endTime,
    endTz: crossZone ? input.travel!.toTimezone : null,
  })
  if (!times.ok) return { error: times.error } as const
  if (input.meetingTypeId && !isUuid(input.meetingTypeId)) return { error: "Unknown meeting type." } as const

  const item = {
    day_id: day.id,
    item_type: input.itemType,
    title,
    start_at: times.startIso,
    end_at: times.endIso,
    timezone: day.timezone,
    meeting_type_id: input.itemType === "meeting" ? input.meetingTypeId || null : null,
    institution_name: txt(input.institutionName),
    venue_name: txt(input.venueName),
    address_line1: txt(input.addressLine1),
    address_line2: txt(input.addressLine2),
    city: txt(input.city),
    state: txt(input.state),
    postal_code: txt(input.postalCode),
    country: txt(input.country),
    room_or_floor: txt(input.roomOrFloor),
    at_investor_office: !!input.atInvestorOffice,
    video_url: txt(input.videoUrl),
    dial_in: txt(input.dialIn),
    dial_in_passcode: txt(input.dialInPasscode),
    status: input.status,
    notes_internal: txt(input.notesInternal),
    notes_external: txt(input.notesExternal),
    include_in_pdf: !!input.includeInPdf,
    send_invite: !!input.sendInvite,
    availability_block_id: input.itemType === "meeting" && input.availabilityBlockId ? input.availabilityBlockId : null,
  }

  const t = input.travel
  const travel =
    isTravel && t
      ? {
          mode,
          from_item_id: t.fromItemId && isUuid(t.fromItemId) ? t.fromItemId : null,
          to_item_id: t.toItemId && isUuid(t.toItemId) ? t.toItemId : null,
          from_label: txt(t.fromLabel),
          to_label: txt(t.toLabel),
          from_address: txt(t.fromAddress),
          to_address: txt(t.toAddress),
          from_timezone: day.timezone,
          to_timezone: crossZone ? t.toTimezone : day.timezone,
          duration_minutes: Math.round((Date.parse(times.endIso) - Date.parse(times.startIso)) / 60_000),
          buffer_minutes: Math.max(0, Math.round(Number(t.bufferMinutes) || 0)),
          duration_source: t.durationSource === "estimated" ? "estimated" : "manual",
          transport_company: txt(t.transportCompany),
          driver_name: txt(t.driverName),
          driver_phone: txt(t.driverPhone),
          vehicle_type: txt(t.vehicleType),
          pickup_instructions: txt(t.pickupInstructions),
          carrier: txt(t.carrier),
          flight_or_train_number: txt(t.flightOrTrainNumber),
          depart_terminal: txt(t.departTerminal),
          arrive_terminal: txt(t.arriveTerminal),
          seat_info: txt(t.seatInfo),
          confirmation_number: txt(t.confirmationNumber),
          print_confirmation_number: !!t.printConfirmationNumber,
        }
      : null

  const h = input.hotel
  let hotel = null
  if (input.itemType === "hotel" && h) {
    const checkOut =
      h.checkOutDate && h.checkOutTime ? zonedToIso(h.checkOutDate, h.checkOutTime, day.timezone) : null
    if (checkOut && Date.parse(checkOut) < Date.parse(times.startIso))
      return { error: "Check-out is before check-in." } as const
    hotel = {
      hotel_name: txt(h.hotelName),
      address: txt(h.address),
      phone: txt(h.phone),
      check_in_at: times.startIso,
      check_out_at: checkOut,
      confirmation_number: txt(h.confirmationNumber),
      notes: txt(h.notes),
    }
  }
  return { item, travel, hotel } as const
}

/** Replace an item's attendees with `ids` (all must be on the itinerary). */
async function setItemAttendees(sb: Sb, itineraryId: string, itemId: string, ids: string[]): Promise<string | null> {
  const wanted = [...new Set(ids)].filter(isUuid)
  if (wanted.length) {
    const { data } = await sb.from("ep_attendees").select("id").eq("itinerary_id", itineraryId).in("id", wanted)
    if ((data ?? []).length !== wanted.length) return "An attendee is not on this itinerary."
  }
  const { error: dErr } = await sb.from("ep_item_attendees").delete().eq("item_id", itemId)
  if (dErr) return describeError(dErr)
  if (wanted.length) {
    const { error } = await sb.from("ep_item_attendees").insert(wanted.map((a) => ({ item_id: itemId, attendee_id: a })))
    if (error) return describeError(error)
  }
  return null
}

/** Create (itemId null) or update an item from the side panel. */
export async function saveItem(
  itineraryId: string,
  itemId: string | null,
  input: ItemInput,
): Promise<ActionResult<WithStatus<{ item: BuilderItem }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  if (!isUuid(itineraryId)) return fail("Unknown itinerary.")
  const sb = getSupabaseServer()

  const day = await loadDay(sb, input.dayId)
  if (!day || day.itinerary_id !== itineraryId) return fail("That day is not on this itinerary.")

  let before: BuilderItem | null = null
  if (itemId) {
    const owner = await itemOwner(sb, itemId)
    if (!owner || owner.itinerary_id !== itineraryId) return fail("That item no longer exists.")
    before = await loadBuilderItem(sb, itemId)
  }

  const rows = buildItemRows(input, day)
  if ("error" in rows) return fail(rows.error!)
  if (rows.item.availability_block_id) {
    if (!isUuid(rows.item.availability_block_id)) return fail("Unknown availability block.")
    const { data: blk } = await sb
      .from("ep_availability_blocks")
      .select("itinerary_id")
      .eq("id", rows.item.availability_block_id)
      .maybeSingle()
    if (!blk || (blk as { itinerary_id: string }).itinerary_id !== itineraryId) return fail("That availability block is not on this itinerary.")
  }
  const who = { updated_by_id: g.gate.userId, updated_by_name: g.gate.name }

  let id = itemId
  if (id) {
    const { error } = await sb.from("ep_items").update({ ...rows.item, ...who }).eq("id", id)
    if (error) return fail(describeError(error))
  } else {
    const { data, error } = await sb
      .from("ep_items")
      .insert({
        ...rows.item,
        itinerary_id: itineraryId,
        created_by_id: g.gate.userId,
        created_by_name: g.gate.name,
        ...who,
      })
      .select("id")
      .single()
    if (error) return fail(describeError(error))
    id = (data as { id: string }).id
  }

  // 1:1 children follow the type: a travel item has a leg, a hotel has hotel details.
  if (rows.travel) {
    const { error } = await sb.from("ep_travel_legs").upsert({ item_id: id, ...rows.travel }, { onConflict: "item_id" })
    if (error) return fail(describeError(error))
  } else await sb.from("ep_travel_legs").delete().eq("item_id", id)
  if (rows.hotel) {
    const { error } = await sb.from("ep_hotels").upsert({ item_id: id, ...rows.hotel }, { onConflict: "item_id" })
    if (error) return fail(describeError(error))
  } else await sb.from("ep_hotels").delete().eq("item_id", id)

  const aErr = await setItemAttendees(sb, itineraryId, id!, input.attendeeIds ?? [])
  if (aErr) return fail(aErr)

  const item = await loadBuilderItem(sb, id!)
  if (!item) return fail("Saved, but could not re-read the item.")
  const status = await touch(sb, itineraryId, g.gate)
  await log(sb, itineraryId, g.gate, itemId ? "item_updated" : "item_added", {
    item_id: id,
    title: item.title,
    type: item.item_type,
    start_at: item.start_at,
  })
  await audit(itemId ? "update" : "create", "ep_items", id!, itineraryId, before ? { before, after: item } : item, itemId ? "Edit item" : "Add item")
  revalidate(itineraryId)
  return ok({ item, status })
}

export async function deleteItem(itemId: string): Promise<ActionResult<WithStatus<{ id: string }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  const sb = getSupabaseServer()
  const owner = await itemOwner(sb, itemId)
  if (!owner) return fail("That item no longer exists.")
  if (await liveInviteCount(sb, "item_id", [itemId]))
    return fail("Invites were sent for this item. Mark it Cancelled and send the cancellations instead of deleting it.")
  const before = await loadBuilderItem(sb, itemId)
  const { error } = await sb.from("ep_items").delete().eq("id", itemId)
  if (error) return fail(describeError(error))
  const status = await touch(sb, owner.itinerary_id, g.gate)
  await log(sb, owner.itinerary_id, g.gate, "item_deleted", { title: before?.title, start_at: before?.start_at })
  await audit("delete", "ep_items", itemId, owner.itinerary_id, before, "Delete item")
  revalidate(owner.itinerary_id)
  return ok({ id: itemId, status })
}

/** Copy an item (with its travel/hotel details and attendees) to right after itself. */
export async function duplicateItem(itemId: string): Promise<ActionResult<WithStatus<{ item: BuilderItem }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  const sb = getSupabaseServer()
  const owner = await itemOwner(sb, itemId)
  if (!owner) return fail("That item no longer exists.")
  const { data: raw } = await sb.from("ep_items").select("*").eq("id", itemId).single()
  const src = await loadBuilderItem(sb, itemId)
  if (!raw || !src) return fail("That item no longer exists.")

  const r = raw as Record<string, unknown>
  const len = Date.parse(src.end_at) - Date.parse(src.start_at)
  const copy = { ...r }
  for (const k of ["id", "created_at", "updated_at", "crm_meeting_id"]) delete copy[k]
  Object.assign(copy, {
    title: `${src.title} (copy)`,
    start_at: src.end_at,
    end_at: new Date(Date.parse(src.end_at) + len).toISOString(),
    created_by_id: g.gate.userId,
    created_by_name: g.gate.name,
    updated_by_id: g.gate.userId,
    updated_by_name: g.gate.name,
  })
  const { data, error } = await sb.from("ep_items").insert(copy).select("id").single()
  if (error) return fail(describeError(error))
  const newId = (data as { id: string }).id

  if (src.travel) {
    const { from_item_id: _f, to_item_id: _t, ...leg } = src.travel
    void _f
    void _t
    await sb.from("ep_travel_legs").insert({ ...leg, item_id: newId })
  }
  if (src.hotel) await sb.from("ep_hotels").insert({ ...src.hotel, item_id: newId })
  if (src.attendee_ids.length)
    await sb.from("ep_item_attendees").insert(src.attendee_ids.map((a) => ({ item_id: newId, attendee_id: a })))

  const item = await loadBuilderItem(sb, newId)
  if (!item) return fail("Copied, but could not re-read the copy.")
  const status = await touch(sb, owner.itinerary_id, g.gate)
  await log(sb, owner.itinerary_id, g.gate, "item_duplicated", { from: src.title, item_id: newId })
  await audit("create", "ep_items", newId, owner.itinerary_id, { duplicated_from: itemId, ...item }, "Duplicate item")
  revalidate(owner.itinerary_id)
  return ok({ item, status })
}

export async function setItemStatus(
  itemId: string,
  status: string,
): Promise<ActionResult<WithStatus<{ item: BuilderItem }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  if (!(STATUSES as readonly string[]).includes(status)) return fail("Unknown status.")
  const sb = getSupabaseServer()
  const owner = await itemOwner(sb, itemId)
  if (!owner) return fail("That item no longer exists.")
  const before = await loadBuilderItem(sb, itemId)
  const { error } = await sb
    .from("ep_items")
    .update({ status, updated_by_id: g.gate.userId, updated_by_name: g.gate.name })
    .eq("id", itemId)
  if (error) return fail(describeError(error))
  const item = await loadBuilderItem(sb, itemId)
  if (!item) return fail("That item no longer exists.")
  const itinStatus = await touch(sb, owner.itinerary_id, g.gate)
  await log(sb, owner.itinerary_id, g.gate, "item_status", { title: item.title, from: before?.status, to: status })
  await audit("update", "ep_items", itemId, owner.itinerary_id, { status: { from: before?.status, to: status } }, "Item status")
  revalidate(owner.itinerary_id)
  return ok({ item, status: itinStatus })
}

/**
 * Ripple edit: shift every item on a day that starts at or after `fromIso`
 * (except `excludeId`, the one just edited) by `minutes`.
 */
export async function shiftFollowingItems(
  dayId: string,
  fromIso: string,
  minutes: number,
  excludeId: string | null,
): Promise<ActionResult<WithStatus<{ items: BuilderItem[] }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  const m = Math.round(Number(minutes))
  if (!Number.isFinite(m) || m === 0 || Math.abs(m) > 12 * 60) return fail("Shift must be up to 12 hours.")
  if (Number.isNaN(Date.parse(fromIso))) return fail("Bad time.")
  const sb = getSupabaseServer()
  const day = await loadDay(sb, dayId)
  if (!day) return fail("That day no longer exists.")

  const { data } = await sb
    .from("ep_items")
    .select("id, start_at, end_at")
    .eq("day_id", dayId)
    .gte("start_at", new Date(Date.parse(fromIso)).toISOString())
  const targets = ((data ?? []) as { id: string; start_at: string; end_at: string }[]).filter((i) => i.id !== excludeId)
  const items: BuilderItem[] = []
  for (const t of targets) {
    const { error } = await sb
      .from("ep_items")
      .update({ start_at: shiftIso(t.start_at, m), end_at: shiftIso(t.end_at, m), updated_by_id: g.gate.userId, updated_by_name: g.gate.name })
      .eq("id", t.id)
    if (error) return fail(describeError(error))
    const fresh = await loadBuilderItem(sb, t.id)
    if (fresh) items.push(fresh)
  }
  const status = await touch(sb, day.itinerary_id, g.gate)
  await log(sb, day.itinerary_id, g.gate, "items_shifted", { date: day.date, minutes: m, count: items.length })
  await audit("update", "ep_items", dayId, day.itinerary_id, { shifted: items.map((i) => i.id), minutes: m }, "Shift following items")
  revalidate(day.itinerary_id)
  return ok({ items, status })
}

/* ============================================================== attendance */

export async function toggleItemAttendee(
  itemId: string,
  attendeeId: string,
  on: boolean,
): Promise<ActionResult<WithStatus<{ itemId: string; attendeeId: string; on: boolean }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  if (!isUuid(attendeeId)) return fail("Unknown attendee.")
  const sb = getSupabaseServer()
  const owner = await itemOwner(sb, itemId)
  if (!owner) return fail("That item no longer exists.")
  const { data: att } = await sb.from("ep_attendees").select("itinerary_id, full_name").eq("id", attendeeId).maybeSingle()
  if (!att || (att as { itinerary_id: string }).itinerary_id !== owner.itinerary_id) return fail("That attendee is not on this itinerary.")

  const { error } = on
    ? await sb.from("ep_item_attendees").upsert({ item_id: itemId, attendee_id: attendeeId }, { onConflict: "item_id,attendee_id" })
    : await sb.from("ep_item_attendees").delete().eq("item_id", itemId).eq("attendee_id", attendeeId)
  if (error) return fail(describeError(error))
  const status = await touch(sb, owner.itinerary_id, g.gate)
  await audit(on ? "create" : "delete", "ep_item_attendees", `${itemId}:${attendeeId}`, owner.itinerary_id, { item_id: itemId, attendee_id: attendeeId }, on ? "Assign attendee" : "Unassign attendee")
  revalidate(owner.itinerary_id)
  return ok({ itemId, attendeeId, on, status })
}

/**
 * "Travelling party": every client executive and Rose staff member who gets the
 * full itinerary is put on every item that isn't cancelled.
 */
export async function assignTravellingParty(
  itineraryId: string,
): Promise<ActionResult<WithStatus<{ pairs: { item_id: string; attendee_id: string }[] }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  if (!isUuid(itineraryId)) return fail("Unknown itinerary.")
  const sb = getSupabaseServer()
  const [{ data: atts }, { data: its }] = await Promise.all([
    sb
      .from("ep_attendees")
      .select("id")
      .eq("itinerary_id", itineraryId)
      .eq("receives_full_itinerary", true)
      .in("side", ["client", "internal"]),
    sb.from("ep_items").select("id").eq("itinerary_id", itineraryId).neq("status", "cancelled"),
  ])
  const party = ((atts ?? []) as { id: string }[]).map((a) => a.id)
  const items = ((its ?? []) as { id: string }[]).map((i) => i.id)
  if (!party.length) return fail("No travelling party yet — mark client or Rose attendees as getting the full itinerary.")
  if (!items.length) return fail("There are no items to assign.")
  const pairs = items.flatMap((item_id) => party.map((attendee_id) => ({ item_id, attendee_id })))
  const { error } = await sb.from("ep_item_attendees").upsert(pairs, { onConflict: "item_id,attendee_id", ignoreDuplicates: true })
  if (error) return fail(describeError(error))
  const status = await touch(sb, itineraryId, g.gate)
  await log(sb, itineraryId, g.gate, "travelling_party_assigned", { people: party.length, items: items.length })
  await audit("create", "ep_item_attendees", itineraryId, itineraryId, { people: party, items }, "Assign travelling party")
  revalidate(itineraryId)
  return ok({ pairs, status })
}

/* =============================================================== attendees */

function attendeeRow(input: AttendeeInput) {
  const fullName = (input.fullName ?? "").trim()
  if (!fullName) return { error: "Enter a name." } as const
  if (!ATTENDEE_ROLES.some((r) => r.value === input.role)) return { error: "Unknown role." } as const
  if (!ATTENDEE_SIDES.some((s) => s.value === input.side)) return { error: "Unknown side." } as const
  const email = txt(input.email)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email doesn't look right." } as const
  return {
    row: {
      full_name: fullName,
      email,
      phone: txt(input.phone),
      title: txt(input.title),
      company: txt(input.company),
      role: input.role,
      side: input.side,
      receives_full_itinerary: !!input.receivesFullItinerary,
    },
  } as const
}

export async function addAttendees(
  itineraryId: string,
  inputs: AttendeeInput[],
): Promise<ActionResult<WithStatus<{ attendees: BuilderAttendee[] }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  if (!isUuid(itineraryId)) return fail("Unknown itinerary.")
  if (!inputs?.length) return fail("Nobody to add.")
  const sb = getSupabaseServer()
  const { data: existing } = await sb.from("ep_attendees").select("crm_contact_id, sort_order").eq("itinerary_id", itineraryId)
  const have = new Set(((existing ?? []) as { crm_contact_id: string | null }[]).map((e) => e.crm_contact_id).filter(Boolean))
  let order = (existing ?? []).length

  // CRM contacts are re-read: name/email/title come from the CRM, not the browser.
  const crmIds = inputs.map((i) => i.crmContactId).filter((v): v is string => !!v && isUuid(v))
  const crm = new Map<string, ContactSearchRow>()
  if (crmIds.length) {
    const { data } = await sb
      .from("contacts")
      .select("contact_id, full_name, job_title, email, mobile_phone, direct_phone, parent_customer_name")
      .in("contact_id", crmIds)
    for (const c of (data ?? []) as (ContactSearchRow & { parent_customer_name: string | null })[])
      crm.set(c.contact_id, { ...c, company: c.parent_customer_name })
  }

  const rows = []
  for (const input of inputs) {
    if (input.crmContactId) {
      if (have.has(input.crmContactId)) continue // already on the itinerary
      const c = crm.get(input.crmContactId)
      if (!c) return fail("A CRM contact no longer exists.")
      input.fullName = c.full_name ?? input.fullName
      input.email = c.email ?? ""
      input.phone = c.mobile_phone ?? c.direct_phone ?? ""
      input.title = c.job_title ?? ""
      input.company = input.company || c.company || ""
    }
    const r = attendeeRow(input)
    if ("error" in r) return fail(r.error!)
    rows.push({ ...r.row, itinerary_id: itineraryId, crm_contact_id: input.crmContactId || null, sort_order: order++ })
  }
  if (!rows.length) return fail("Everyone picked is already on this itinerary.")
  const { data, error } = await sb.from("ep_attendees").insert(rows).select("*")
  if (error) return fail(describeError(error))
  const status = await touch(sb, itineraryId, g.gate)
  await log(sb, itineraryId, g.gate, "attendees_added", { names: rows.map((r) => r.full_name) })
  for (const a of (data ?? []) as BuilderAttendee[]) await audit("create", "ep_attendees", a.id, itineraryId, a, "Add attendee")
  revalidate(itineraryId)
  return ok({ attendees: (data ?? []) as BuilderAttendee[], status })
}

export async function updateAttendee(
  attendeeId: string,
  input: AttendeeInput,
): Promise<ActionResult<WithStatus<{ attendee: BuilderAttendee }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  if (!isUuid(attendeeId)) return fail("Unknown attendee.")
  const sb = getSupabaseServer()
  const { data: before } = await sb.from("ep_attendees").select("*").eq("id", attendeeId).maybeSingle()
  if (!before) return fail("That attendee no longer exists.")
  const r = attendeeRow(input)
  if ("error" in r) return fail(r.error!)
  const { data, error } = await sb.from("ep_attendees").update(r.row).eq("id", attendeeId).select("*").single()
  if (error) return fail(describeError(error))
  const itineraryId = (before as BuilderAttendee & { itinerary_id: string }).itinerary_id
  const status = await touch(sb, itineraryId, g.gate)
  await log(sb, itineraryId, g.gate, "attendee_updated", { name: r.row.full_name })
  await audit("update", "ep_attendees", attendeeId, itineraryId, { before, after: r.row }, "Edit attendee")
  revalidate(itineraryId)
  return ok({ attendee: data as BuilderAttendee, status })
}

export async function deleteAttendee(attendeeId: string): Promise<ActionResult<WithStatus<{ id: string }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  if (!isUuid(attendeeId)) return fail("Unknown attendee.")
  const sb = getSupabaseServer()
  const { data: before } = await sb.from("ep_attendees").select("*").eq("id", attendeeId).maybeSingle()
  if (!before) return fail("That attendee no longer exists.")
  if (await liveInviteCount(sb, "attendee_id", [attendeeId]))
    return fail("This person has calendar invites. Take them off their items and send the cancellations before removing them.")
  const { error } = await sb.from("ep_attendees").delete().eq("id", attendeeId)
  if (error) return fail(describeError(error))
  const itineraryId = (before as { itinerary_id: string }).itinerary_id
  const status = await touch(sb, itineraryId, g.gate)
  await log(sb, itineraryId, g.gate, "attendee_removed", { name: (before as { full_name: string }).full_name })
  await audit("delete", "ep_attendees", attendeeId, itineraryId, before, "Remove attendee")
  revalidate(itineraryId)
  return ok({ id: attendeeId, status })
}

/* ================================================================= pickers */

async function readGate(): Promise<string | null> {
  return (await getEffectiveRole()) === "super_user" ? null : "Not authorised."
}

/**
 * CRM contacts for the attendee picker. With no search text and a client, that
 * client's contacts; otherwise a name / email / company search over everyone.
 */
export async function searchContacts(
  q: string,
  clientAccountId: string | null,
): Promise<ActionResult<ContactSearchRow[]>> {
  const denied = await readGate()
  if (denied) return fail(denied)
  const term = (q ?? "").replace(/[,()%_*\\:"']/g, " ").trim().slice(0, 80)
  let query = getSupabaseServer()
    .from("contacts")
    .select("contact_id, full_name, job_title, email, mobile_phone, direct_phone, parent_customer_name, state_label")
    .order("full_name")
    .limit(60)
  if (term) {
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,parent_customer_name.ilike.%${term}%`)
  } else if (clientAccountId && isUuid(clientAccountId)) {
    query = query.or(`parent_customer_id.eq.${clientAccountId},company_master_record_id.eq.${clientAccountId}`)
  } else {
    return ok([])
  }
  const { data, error } = await query
  if (error) return fail(describeError(error))
  return ok(
    ((data ?? []) as (ContactSearchRow & { parent_customer_name: string | null; state_label: string | null })[])
      .filter((c) => (c.state_label ?? "").trim().toLowerCase() !== "inactive")
      .map(({ parent_customer_name, state_label: _s, ...c }) => {
        void _s
        return { ...c, company: parent_customer_name }
      }),
  )
}

/** Active Rose staff with a mailbox, for adding Rose attendees. */
export async function loadStaffOptions(): Promise<ActionResult<StaffOption[]>> {
  const denied = await readGate()
  if (denied) return fail(denied)
  const { data, error } = await getSupabaseServer()
    .from("users")
    .select("user_id, display_name, email, is_active")
    .eq("is_active", true)
    .limit(2000)
  if (error) return fail(describeError(error))
  // Same roster rule as Admin → Account Teams: real people only (drops hashed /
  // disabled rows and shared mailboxes).
  const roster = buildIdentityIndex(
    (data ?? []) as { user_id: string; display_name: string | null; email: string | null; is_active: boolean }[],
  )
    .roster.filter((r) => !r.service && r.email)
    .map((r) => ({ user_id: r.userId, display_name: r.name, email: r.email }))
    .sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""))
  return ok(roster as StaffOption[])
}

/* ===================================================== availability blocks */

function buildBlockRow(input: BlockInput, day: BuilderDay) {
  const times = resolveTimes({ dayDate: day.date, dayTz: day.timezone, startTime: input.startTime, endTime: input.endTime })
  if (!times.ok) return { error: times.error } as const
  if (Date.parse(times.endIso) <= Date.parse(times.startIso)) return { error: "The block must end after it starts." } as const
  const slot = Math.round(Number(input.defaultSlotMinutes))
  const buf = Math.round(Number(input.defaultBufferMinutes))
  if (!Number.isFinite(slot) || slot < 5 || slot > 600) return { error: "Slot length must be 5–600 minutes." } as const
  if (!Number.isFinite(buf) || buf < 0 || buf > 240) return { error: "Buffer must be 0–240 minutes." } as const
  if (input.blockType !== "hard" && input.blockType !== "soft") return { error: "Pick hard or soft." } as const
  return {
    row: {
      day_id: day.id,
      start_at: times.startIso,
      end_at: times.endIso,
      timezone: day.timezone,
      label: txt(input.label),
      host_institution_name: txt(input.hostInstitutionName),
      venue_name: txt(input.venueName),
      address_line1: txt(input.addressLine1),
      address_line2: txt(input.addressLine2),
      city: txt(input.city),
      state: txt(input.state),
      postal_code: txt(input.postalCode),
      country: txt(input.country),
      room_or_floor: txt(input.roomOrFloor),
      at_investor_office: !!input.atInvestorOffice,
      video_url: txt(input.videoUrl),
      dial_in: txt(input.dialIn),
      dial_in_passcode: txt(input.dialInPasscode),
      default_slot_minutes: slot,
      default_buffer_minutes: buf,
      block_type: input.blockType,
      notes_internal: txt(input.notesInternal),
      notes_external: txt(input.notesExternal),
    },
  } as const
}

/** Create (blockId null) or update an availability block. */
export async function saveBlock(
  itineraryId: string,
  blockId: string | null,
  input: BlockInput,
): Promise<ActionResult<WithStatus<{ block: BuilderBlock }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  if (!isUuid(itineraryId)) return fail("Unknown itinerary.")
  const sb = getSupabaseServer()
  const day = await loadDay(sb, input.dayId)
  if (!day || day.itinerary_id !== itineraryId) return fail("That day is not on this itinerary.")

  let before: BuilderBlock | null = null
  if (blockId) {
    if (!isUuid(blockId)) return fail("Unknown block.")
    const { data: own } = await sb.from("ep_availability_blocks").select("itinerary_id").eq("id", blockId).maybeSingle()
    if ((own as { itinerary_id: string } | null)?.itinerary_id !== itineraryId) return fail("That block no longer exists.")
    before = await loadBuilderBlock(sb, blockId)
  }
  const b = buildBlockRow(input, day)
  if ("error" in b) return fail(b.error!)
  const who = { updated_by_id: g.gate.userId, updated_by_name: g.gate.name }

  let id = blockId
  if (id) {
    const { error } = await sb.from("ep_availability_blocks").update({ ...b.row, ...who }).eq("id", id)
    if (error) return fail(describeError(error))
  } else {
    const { data, error } = await sb
      .from("ep_availability_blocks")
      .insert({
        ...b.row,
        itinerary_id: itineraryId,
        source: "manual",
        created_by_id: g.gate.userId,
        created_by_name: g.gate.name,
        ...who,
      })
      .select("id")
      .single()
    if (error) return fail(describeError(error))
    id = (data as { id: string }).id
  }
  const block = await loadBuilderBlock(sb, id!)
  if (!block) return fail("Saved, but could not re-read the block.")
  const status = await touch(sb, itineraryId, g.gate)
  await log(sb, itineraryId, g.gate, blockId ? "block_updated" : "block_added", {
    block_id: id,
    label: block.label ?? block.host_institution_name,
    start_at: block.start_at,
    end_at: block.end_at,
  })
  await audit(
    blockId ? "update" : "create",
    "ep_availability_blocks",
    id!,
    itineraryId,
    before ? { before, after: block } : block,
    blockId ? "Edit availability block" : "Add availability block",
  )
  revalidate(itineraryId)
  return ok({ block, status })
}

/** Delete a block. Meetings booked into it stay on the schedule, just unlinked. */
export async function deleteBlock(blockId: string): Promise<ActionResult<WithStatus<{ id: string }>>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("editing itineraries")
  if (!g.ok) return fail(g.error)
  if (!isUuid(blockId)) return fail("Unknown block.")
  const sb = getSupabaseServer()
  const { data: before } = await sb.from("ep_availability_blocks").select("*").eq("id", blockId).maybeSingle()
  if (!before) return fail("That block no longer exists.")
  const { error } = await sb.from("ep_availability_blocks").delete().eq("id", blockId)
  if (error) return fail(describeError(error))
  const itineraryId = (before as { itinerary_id: string }).itinerary_id
  const status = await touch(sb, itineraryId, g.gate)
  await log(sb, itineraryId, g.gate, "block_removed", { label: (before as { label: string | null }).label })
  await audit("delete", "ep_availability_blocks", blockId, itineraryId, before, "Delete availability block")
  revalidate(itineraryId)
  return ok({ id: blockId, status })
}

/* ============================================================ travel time */

/** Estimate a travel leg's minutes. `minutes` is null when no estimator is configured or it can't say. */
export async function estimateTravelMinutes(q: {
  fromAddress: string
  toAddress: string
  mode: string
  departAt: string | null
}): Promise<ActionResult<{ minutes: number | null; provider: string }>> {
  const denied = await readGate()
  if (denied) return fail(denied)
  const provider = getTravelTimeProvider()
  if (!provider.available) return ok({ minutes: null, provider: provider.name })
  if (!(q.fromAddress ?? "").trim() || !(q.toAddress ?? "").trim()) return fail("Enter both addresses to estimate.")
  try {
    const minutes = await provider.estimate({
      fromAddress: q.fromAddress.slice(0, 300),
      toAddress: q.toAddress.slice(0, 300),
      mode: q.mode,
      departAt: q.departAt,
    })
    return ok({ minutes, provider: provider.name })
  } catch (e) {
    return fail(`Couldn't estimate: ${(e as Error).message}`)
  }
}

/* ================================================== cross-itinerary check */

/**
 * People on this itinerary who are also in an item on ANOTHER itinerary at an
 * overlapping time — matched by CRM contact, else by email. The one query that
 * looks across itineraries: scoped to this itinerary's time span and served by
 * the contact / email / start-end indexes.
 */
export async function loadCrossBookings(itineraryId: string): Promise<ActionResult<CrossBooking[]>> {
  const denied = await readGate()
  if (denied) return fail(denied)
  if (!isUuid(itineraryId)) return fail("Unknown itinerary.")
  const sb = getSupabaseServer()

  const [{ data: mine }, { data: myItems }] = await Promise.all([
    sb.from("ep_attendees").select("id, crm_contact_id, email").eq("itinerary_id", itineraryId),
    sb
      .from("ep_items")
      .select("id, start_at, end_at, status, ep_item_attendees(attendee_id)")
      .eq("itinerary_id", itineraryId)
      .neq("status", "cancelled"),
  ])
  const attendees = (mine ?? []) as { id: string; crm_contact_id: string | null; email: string | null }[]
  const items = (myItems ?? []) as {
    id: string
    start_at: string
    end_at: string
    ep_item_attendees: { attendee_id: string }[]
  }[]
  if (!attendees.length || !items.length) return ok([])

  const minStart = items.reduce((m, i) => (i.start_at < m ? i.start_at : m), items[0].start_at)
  const maxEnd = items.reduce((m, i) => (i.end_at > m ? i.end_at : m), items[0].end_at)
  const contacts = [...new Set(attendees.map((a) => a.crm_contact_id).filter((v): v is string => !!v))]
  const emails = [
    ...new Set(
      attendees.flatMap((a) => (a.email ? [a.email.replace(/[",()]/g, ""), a.email.replace(/[",()]/g, "").toLowerCase()] : [])),
    ),
  ]

  // The same people on other itineraries.
  const filters = [
    contacts.length ? `crm_contact_id.in.(${contacts.join(",")})` : null,
    emails.length ? `email.in.(${emails.map((e) => `"${e}"`).join(",")})` : null,
  ].filter(Boolean)
  if (!filters.length) return ok([])
  const { data: others, error } = await sb
    .from("ep_attendees")
    .select("id, crm_contact_id, email, itinerary_id")
    .neq("itinerary_id", itineraryId)
    .or(filters.join(","))
    .limit(2000)
  if (error) return fail(describeError(error))
  const otherAtts = (others ?? []) as {
    id: string
    crm_contact_id: string | null
    email: string | null
    itinerary_id: string
  }[]
  if (!otherAtts.length) return ok([])

  // Their items overlapping our time span.
  const { data: pairs, error: pErr } = await sb
    .from("ep_item_attendees")
    .select("attendee_id, ep_items!inner(id, title, start_at, end_at, status, ep_itineraries(title, status))")
    .in(
      "attendee_id",
      otherAtts.map((a) => a.id),
    )
    .lt("ep_items.start_at", maxEnd)
    .gt("ep_items.end_at", minStart)
    .neq("ep_items.status", "cancelled")
    .limit(5000)
  if (pErr) return fail(describeError(pErr))

  type Pair = {
    attendee_id: string
    ep_items: {
      id: string
      title: string
      start_at: string
      end_at: string
      ep_itineraries: { title: string; status: string } | null
    }
  }
  const same = (me: (typeof attendees)[number], other: (typeof otherAtts)[number]) =>
    (!!me.crm_contact_id && me.crm_contact_id === other.crm_contact_id) ||
    (!!me.email && !!other.email && me.email.toLowerCase() === other.email.toLowerCase())

  const out: CrossBooking[] = []
  for (const p of (pairs ?? []) as unknown as Pair[]) {
    const other = otherAtts.find((o) => o.id === p.attendee_id)
    const theirs = p.ep_items
    if (!other || !theirs || theirs.ep_itineraries?.status === "archived") continue
    for (const me of attendees.filter((a) => same(a, other))) {
      for (const it of items.filter((i) => i.ep_item_attendees.some((x) => x.attendee_id === me.id))) {
        if (Date.parse(it.start_at) < Date.parse(theirs.end_at) && Date.parse(it.end_at) > Date.parse(theirs.start_at))
          out.push({
            attendeeId: me.id,
            itemId: it.id,
            otherTitle: theirs.title,
            otherItinerary: theirs.ep_itineraries?.title ?? "another itinerary",
          })
      }
    }
  }
  return ok(out)
}

/* ================================================================ finalise */

/**
 * Finalise: re-run every check on the server, refuse while any error remains,
 * require the warnings to be acknowledged, then bump the version, snapshot the
 * whole schedule into the activity log and mark it finalized.
 */
export async function finalizeItinerary(
  itineraryId: string,
  acknowledgeWarnings: boolean,
): Promise<ActionResult<{ status: ItineraryStatus; version: number }>> {
  // ---- GATE (must stay first) ----
  const g = await writeGate("finalising itineraries")
  if (!g.ok) return fail(g.error)
  if (!isUuid(itineraryId)) return fail("Unknown itinerary.")
  const sb = getSupabaseServer()
  const { data: itin, error } = await loadBuilderItinerary(sb, itineraryId)
  if (error) return fail(error)
  if (!itin) return fail("That itinerary no longer exists.")
  if (itin.status === "archived") return fail("Archived itineraries can't be finalised.")

  const cross = await loadCrossBookings(itineraryId)
  const issues = checkSchedule({
    days: itin.days,
    items: itin.items,
    attendees: itin.attendees,
    blocks: itin.blocks,
    airportLeadMinutes: itin.airport_lead_minutes,
    crossBookings: cross.ok ? cross.data : [],
  })
  const errors = issues.filter((i) => i.severity === "error")
  const warnings = issues.filter((i) => i.severity === "warning")
  if (errors.length) return fail(`Fix ${errors.length} error${errors.length === 1 ? "" : "s"} first — ${errors[0].message}`)
  if (warnings.length && !acknowledgeWarnings)
    return fail(`Acknowledge the ${warnings.length} warning${warnings.length === 1 ? "" : "s"} to finalise.`)

  const version = itin.version + 1
  const status: ItineraryStatus = "finalized"
  const { error: uErr } = await sb
    .from("ep_itineraries")
    .update({ status, version, updated_by_id: g.gate.userId, updated_by_name: g.gate.name })
    .eq("id", itineraryId)
  if (uErr) return fail(describeError(uErr))

  await log(sb, itineraryId, g.gate, "finalized", {
    version,
    warnings_acknowledged: warnings.map((w) => w.message),
    snapshot: itin,
  })
  await audit("update", "ep_itineraries", itineraryId, itineraryId, { status: { from: itin.status, to: status }, version }, "Finalise")
  revalidate(itineraryId)
  return ok({ status, version })
}

/* ================================================================= exports */

export type ExportRow = {
  id: string
  version: number
  generated_by_name: string | null
  generated_at: string
  options: { audience?: string; attendeeId?: string | null } & Record<string, unknown>
}

/** This itinerary's PDF history, newest first. */
export async function listExports(itineraryId: string): Promise<ActionResult<ExportRow[]>> {
  const denied = await readGate()
  if (denied) return fail(denied)
  if (!isUuid(itineraryId)) return fail("Unknown itinerary.")
  const { data, error } = await getSupabaseServer()
    .from("ep_exports")
    .select("id, version, generated_by_name, generated_at, options")
    .eq("itinerary_id", itineraryId)
    .order("generated_at", { ascending: false })
    .limit(100)
  if (error) return fail(describeError(error))
  return ok((data ?? []) as ExportRow[])
}

/** A 10-minute signed download link for one saved PDF. */
export async function exportDownloadUrl(exportId: string): Promise<ActionResult<{ url: string }>> {
  const denied = await readGate()
  if (denied) return fail(denied)
  if (!isUuid(exportId)) return fail("Unknown export.")
  const sb = getSupabaseServer()
  const { data, error } = await sb.from("ep_exports").select("storage_path, version, options").eq("id", exportId).maybeSingle()
  if (error) return fail(describeError(error))
  if (!data) return fail("That export no longer exists.")
  const row = data as { storage_path: string; version: number; options: { audience?: string } }
  const signed = await sb.storage
    .from("event-itineraries")
    .createSignedUrl(row.storage_path, 600, { download: `itinerary-v${row.version}-${row.options?.audience ?? "pdf"}.pdf` })
  if (signed.error || !signed.data) return fail(signed.error?.message ?? "Could not create a download link.")
  return ok({ url: signed.data.signedUrl })
}

/* ================================================================ activity */

export type ActivityRow = {
  id: number
  action: string
  actor_name: string | null
  details: Record<string, unknown> | null
  created_at: string
}

/** The itinerary's activity log, newest first (the Finalise snapshot is left out — it's large). */
export async function listActivity(itineraryId: string): Promise<ActionResult<ActivityRow[]>> {
  const denied = await readGate()
  if (denied) return fail(denied)
  if (!isUuid(itineraryId)) return fail("Unknown itinerary.")
  const { data, error } = await getSupabaseServer()
    .from("ep_activity_log")
    .select("id, action, actor_name, details, created_at")
    .eq("itinerary_id", itineraryId)
    .order("created_at", { ascending: false })
    .limit(500)
  if (error) return fail(describeError(error))
  return ok(
    ((data ?? []) as ActivityRow[]).map((r) => {
      if (r.details && "snapshot" in r.details) {
        const { snapshot: _s, ...rest } = r.details
        void _s
        return { ...r, details: rest }
      }
      return r
    }),
  )
}

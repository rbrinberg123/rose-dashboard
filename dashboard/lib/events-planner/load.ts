import "server-only"

/**
 * Reading an itinerary for the builder — ONE PostgREST round trip with days,
 * items (+ travel leg, hotel, who's in it) and attendees embedded. Shared by
 * the builder page and the server actions (which return fresh rows after a
 * write, so the browser can replace its optimistic copy).
 *
 * Callers gate first; this module does not check roles.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  BuilderAttendee,
  BuilderBlock,
  BuilderDay,
  BuilderHotel,
  BuilderItem,
  BuilderItinerary,
  BuilderTravelLeg,
  ItineraryStatus,
} from "./types"

// ep_travel_legs has three FKs to ep_items (item, from, to) — name the one that
// makes it "this item's leg".
const ITEM_SELECT = `*, ep_travel_legs!ep_travel_legs_item_id_fkey(*), ep_hotels(*), ep_item_attendees(attendee_id)`

// FK hints on the itinerary children keep each embed unambiguous now that ep_items
// also points at ep_availability_blocks.
const ITINERARY_SELECT = `id, title, subtitle, status, start_date, end_date, home_timezone, default_meeting_minutes,
  crm_event_id, client_company_id, client_name_override, event_type_id, internal_notes, client_notes,
  confidential, version, buffer_car_minutes, buffer_walk_minutes, airport_lead_minutes, client:accounts(name),
  ep_days!ep_days_itinerary_id_fkey(id, date, city, timezone, day_title, day_notes, sort_order),
  ep_items!ep_items_itinerary_id_fkey(${ITEM_SELECT}),
  ep_availability_blocks!ep_availability_blocks_itinerary_id_fkey(*),
  ep_attendees!ep_attendees_itinerary_id_fkey(id, crm_contact_id, full_name, email, phone, title, company, role, side, receives_full_itinerary, sort_order)`

/** One-to-one embeds come back as an object or a one-element array. */
function one<T>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null
  return (v as T) ?? null
}

type RawItem = Omit<BuilderItem, "travel" | "hotel" | "attendee_ids"> & {
  ep_travel_legs: unknown
  ep_hotels: unknown
  ep_item_attendees: { attendee_id: string }[] | null
}

export function normalizeItem(raw: RawItem): BuilderItem {
  const { ep_travel_legs, ep_hotels, ep_item_attendees, ...rest } = raw
  const r = rest as Record<string, unknown>
  return {
    id: rest.id,
    day_id: rest.day_id,
    item_type: rest.item_type,
    crm_meeting_id: rest.crm_meeting_id,
    title: rest.title,
    start_at: new Date(rest.start_at).toISOString(),
    end_at: new Date(rest.end_at).toISOString(),
    timezone: rest.timezone,
    meeting_type_id: rest.meeting_type_id,
    institution_name: rest.institution_name,
    venue_name: rest.venue_name,
    address_line1: rest.address_line1,
    address_line2: rest.address_line2,
    city: rest.city,
    state: rest.state,
    postal_code: rest.postal_code,
    country: rest.country,
    room_or_floor: rest.room_or_floor,
    at_investor_office: !!r.at_investor_office,
    video_url: rest.video_url,
    dial_in: rest.dial_in,
    dial_in_passcode: rest.dial_in_passcode,
    status: rest.status,
    notes_internal: rest.notes_internal,
    notes_external: rest.notes_external,
    include_in_pdf: !!r.include_in_pdf,
    send_invite: !!r.send_invite,
    sort_order: rest.sort_order,
    availability_block_id: rest.availability_block_id ?? null,
    travel: one<BuilderTravelLeg>(ep_travel_legs),
    hotel: one<BuilderHotel>(ep_hotels),
    attendee_ids: (ep_item_attendees ?? []).map((a) => a.attendee_id),
  }
}

export async function loadBuilderItinerary(
  sb: SupabaseClient,
  id: string,
): Promise<{ data: BuilderItinerary | null; error: string | null }> {
  const { data, error } = await sb.from("ep_itineraries").select(ITINERARY_SELECT).eq("id", id).maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: null }
  const d = data as unknown as {
    id: string
    title: string
    subtitle: string | null
    status: ItineraryStatus
    start_date: string
    end_date: string
    home_timezone: string
    default_meeting_minutes: number
    crm_event_id: string | null
    client_company_id: string | null
    client_name_override: string | null
    event_type_id: string | null
    internal_notes: string | null
    client_notes: string | null
    confidential: boolean
    version: number
    buffer_car_minutes: number
    buffer_walk_minutes: number
    airport_lead_minutes: number
    client: unknown
    ep_days: BuilderDay[]
    ep_items: RawItem[]
    ep_availability_blocks: BuilderBlock[]
    ep_attendees: BuilderAttendee[]
  }
  return {
    error: null,
    data: {
      id: d.id,
      title: d.title,
      subtitle: d.subtitle,
      status: d.status,
      start_date: d.start_date,
      end_date: d.end_date,
      home_timezone: d.home_timezone,
      default_meeting_minutes: d.default_meeting_minutes,
      crm_event_id: d.crm_event_id,
      client_company_id: d.client_company_id,
      client_name: d.client_name_override?.trim() || one<{ name: string }>(d.client)?.name || null,
      client_name_override: d.client_name_override,
      event_type_id: d.event_type_id,
      internal_notes: d.internal_notes,
      client_notes: d.client_notes,
      confidential: d.confidential,
      version: d.version,
      buffer_car_minutes: d.buffer_car_minutes,
      buffer_walk_minutes: d.buffer_walk_minutes,
      airport_lead_minutes: d.airport_lead_minutes,
      days: [...d.ep_days].sort((a, b) => a.date.localeCompare(b.date)),
      items: d.ep_items.map(normalizeItem).sort((a, b) => a.start_at.localeCompare(b.start_at)),
      attendees: [...d.ep_attendees].sort((a, b) => a.sort_order - b.sort_order || a.full_name.localeCompare(b.full_name)),
      blocks: (d.ep_availability_blocks ?? []).map(normalizeBlock).sort((a, b) => a.start_at.localeCompare(b.start_at)),
    },
  }
}

export async function loadBuilderItem(sb: SupabaseClient, itemId: string): Promise<BuilderItem | null> {
  const { data } = await sb.from("ep_items").select(ITEM_SELECT).eq("id", itemId).maybeSingle()
  return data ? normalizeItem(data as unknown as RawItem) : null
}

/** Instants as ISO strings, flags as booleans. */
export function normalizeBlock(b: BuilderBlock): BuilderBlock {
  return {
    ...b,
    start_at: new Date(b.start_at).toISOString(),
    end_at: new Date(b.end_at).toISOString(),
    at_investor_office: !!b.at_investor_office,
  }
}

export async function loadBuilderBlock(sb: SupabaseClient, blockId: string): Promise<BuilderBlock | null> {
  const { data } = await sb.from("ep_availability_blocks").select("*").eq("id", blockId).maybeSingle()
  return data ? normalizeBlock(data as BuilderBlock) : null
}

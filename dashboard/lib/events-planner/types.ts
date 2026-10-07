/**
 * Shapes shared by the Events Planner pages (app/admin/events) and their server
 * actions. Table definitions: sql/patches/2026-10-02d_events_planner.sql.
 */

import type { CrmMeetingRow } from "./core"

export type ItineraryStatus = "draft" | "in_review" | "finalized" | "invites_sent" | "archived"

export const ITINERARY_STATUSES: readonly { value: ItineraryStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In review" },
  { value: "finalized", label: "Finalized" },
  { value: "invites_sent", label: "Invites sent" },
  { value: "archived", label: "Archived" },
] as const

export const DEFAULT_MEETING_MINUTES = 45

/** One row of v_ep_itineraries_list. */
export type ItineraryListRow = {
  id: string
  title: string
  subtitle: string | null
  status: ItineraryStatus
  start_date: string
  end_date: string
  crm_event_id: string | null
  client_company_id: string | null
  client_name: string | null
  event_type_name: string | null
  cities: string | null
  meeting_count: number
  organizer_user_id: string | null
  organizer_name: string | null
  created_by_id: string | null
  created_by_name: string | null
  updated_by_name: string | null
  created_at: string
  updated_at: string
}

export type TypeOption = { id: string; name: string }

/** A CRM event in the "From CRM event" picker. */
export type CrmEventOption = {
  event_id: string
  name: string | null
  client_account_id: string | null
  client_account_name: string | null
  event_start_actual: string | null
  event_end_actual: string | null
  event_state_label: string | null
  event_location: string | null
  dates: string | null
}

/** A client contact offered as an attendee. */
export type ContactOption = {
  contact_id: string
  full_name: string | null
  job_title: string | null
  email: string | null
}

/** Everything the import preview needs for one CRM event. */
export type CrmEventPreview = {
  event: CrmEventOption & { event_type_label: string | null }
  meetings: CrmMeetingRow[]
  contacts: ContactOption[]
  proposedStart: string
  proposedEnd: string
  /** ep_event_types id the CRM type maps to (or "Other"). */
  eventTypeId: string | null
}

export type NewItineraryInput = {
  crmEventId: string | null
  title: string
  subtitle: string
  clientAccountId: string | null
  eventTypeId: string | null
  startDate: string
  endDate: string
  defaultMeetingMinutes: number
  /** CRM meetings to import (From CRM event only). */
  importMeetingIds: string[]
  /** Client contacts to add as attendees. */
  contactIds: string[]
}

/* ============================================================================
 * BUILDER
 * ========================================================================== */

export type AttendeeRole = "client_executive" | "rose_staff" | "investor" | "host_broker" | "driver" | "other"
export type AttendeeSide = "internal" | "client" | "external"

export const ATTENDEE_ROLES: readonly { value: AttendeeRole; label: string; side: AttendeeSide }[] = [
  { value: "client_executive", label: "Client executive", side: "client" },
  { value: "rose_staff", label: "Rose staff", side: "internal" },
  { value: "investor", label: "Investor", side: "external" },
  { value: "host_broker", label: "Host / broker", side: "external" },
  { value: "driver", label: "Driver", side: "external" },
  { value: "other", label: "Other", side: "external" },
] as const

export const ATTENDEE_SIDES: readonly { value: AttendeeSide; label: string }[] = [
  { value: "client", label: "Client" },
  { value: "internal", label: "Rose" },
  { value: "external", label: "External" },
] as const

export type BuilderTravelLeg = {
  mode: string
  from_item_id: string | null
  to_item_id: string | null
  from_label: string | null
  to_label: string | null
  from_address: string | null
  to_address: string | null
  from_timezone: string | null
  to_timezone: string | null
  duration_minutes: number | null
  buffer_minutes: number
  duration_source: string
  transport_company: string | null
  driver_name: string | null
  driver_phone: string | null
  vehicle_type: string | null
  pickup_instructions: string | null
  carrier: string | null
  flight_or_train_number: string | null
  depart_terminal: string | null
  arrive_terminal: string | null
  seat_info: string | null
  confirmation_number: string | null
  print_confirmation_number: boolean
}

export type BuilderHotel = {
  hotel_name: string | null
  address: string | null
  phone: string | null
  check_in_at: string | null
  check_out_at: string | null
  confirmation_number: string | null
  notes: string | null
}

export type BuilderItem = {
  id: string
  day_id: string
  item_type: string
  crm_meeting_id: string | null
  title: string
  start_at: string
  end_at: string
  timezone: string
  meeting_type_id: string | null
  institution_name: string | null
  venue_name: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string | null
  room_or_floor: string | null
  at_investor_office: boolean
  video_url: string | null
  dial_in: string | null
  dial_in_passcode: string | null
  status: string
  notes_internal: string | null
  notes_external: string | null
  include_in_pdf: boolean
  send_invite: boolean
  sort_order: number
  availability_block_id: string | null
  travel: BuilderTravelLeg | null
  hotel: BuilderHotel | null
  attendee_ids: string[]
}

export type BuilderDay = {
  id: string
  date: string
  city: string | null
  timezone: string
  day_title: string | null
  day_notes: string | null
  sort_order: number
}

export type BuilderAttendee = {
  id: string
  crm_contact_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  title: string | null
  company: string | null
  role: AttendeeRole
  side: AttendeeSide
  receives_full_itinerary: boolean
  sort_order: number
}

export type BuilderItinerary = {
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
  client_name: string | null
  client_name_override: string | null
  event_type_id: string | null
  internal_notes: string | null
  client_notes: string | null
  confidential: boolean
  version: number
  buffer_car_minutes: number
  buffer_walk_minutes: number
  airport_lead_minutes: number
  days: BuilderDay[]
  items: BuilderItem[]
  attendees: BuilderAttendee[]
  blocks: BuilderBlock[]
}

/** What the item panel sends to the server. Times are "HH:mm" on the day's clock. */
export type ItemInput = {
  dayId: string
  itemType: string
  title: string
  startTime: string
  endTime: string
  status: string
  meetingTypeId: string | null
  institutionName: string
  venueName: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
  roomOrFloor: string
  atInvestorOffice: boolean
  videoUrl: string
  dialIn: string
  dialInPasscode: string
  notesInternal: string
  notesExternal: string
  includeInPdf: boolean
  sendInvite: boolean
  attendeeIds: string[]
  /** The availability block a meeting is booked into, if any. */
  availabilityBlockId: string | null
  travel: {
    mode: string
    fromItemId: string | null
    toItemId: string | null
    fromLabel: string
    toLabel: string
    fromAddress: string
    toAddress: string
    /** Arrival zone for flights/trains crossing zones; blank = the day's zone. */
    toTimezone: string
    bufferMinutes: number
    /** "estimated" when the duration came from the travel-time estimate and was not edited since. */
    durationSource: "manual" | "estimated"
    transportCompany: string
    driverName: string
    driverPhone: string
    vehicleType: string
    pickupInstructions: string
    carrier: string
    flightOrTrainNumber: string
    departTerminal: string
    arriveTerminal: string
    seatInfo: string
    confirmationNumber: string
    printConfirmationNumber: boolean
  } | null
  hotel: {
    hotelName: string
    address: string
    phone: string
    checkOutDate: string
    checkOutTime: string
    confirmationNumber: string
    notes: string
  } | null
}

export type AttendeeInput = {
  crmContactId: string | null
  fullName: string
  email: string
  phone: string
  title: string
  company: string
  role: AttendeeRole
  side: AttendeeSide
  receivesFullItinerary: boolean
}

/** A CRM contact in the attendee search. */
export type ContactSearchRow = {
  contact_id: string
  full_name: string | null
  job_title: string | null
  email: string | null
  mobile_phone: string | null
  direct_phone: string | null
  company: string | null
}

/** A Rose staff member (public.users) for the attendee picker. */
export type StaffOption = { user_id: string; display_name: string | null; email: string | null }

/** An availability block: a bookable window on a day that meetings are booked into. */
export type BuilderBlock = {
  id: string
  day_id: string
  start_at: string
  end_at: string
  timezone: string
  label: string | null
  host_institution_name: string | null
  host_crm_account_id: string | null
  host_institution_crm_id: string | null
  venue_name: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string | null
  room_or_floor: string | null
  at_investor_office: boolean
  video_url: string | null
  dial_in: string | null
  dial_in_passcode: string | null
  default_slot_minutes: number
  default_buffer_minutes: number
  block_type: "hard" | "soft"
  notes_internal: string | null
  notes_external: string | null
  sort_order: number
  source: "manual" | "imported"
}

/** What the block panel sends. Times are "HH:mm" on the day's clock. */
export type BlockInput = {
  dayId: string
  startTime: string
  endTime: string
  label: string
  hostInstitutionName: string
  venueName: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
  roomOrFloor: string
  atInvestorOffice: boolean
  videoUrl: string
  dialIn: string
  dialInPasscode: string
  defaultSlotMinutes: number
  defaultBufferMinutes: number
  blockType: "hard" | "soft"
  notesInternal: string
  notesExternal: string
}

/** Someone on this itinerary who is also in another itinerary's item at the same time. */
export type CrossBooking = { attendeeId: string; itemId: string; otherTitle: string; otherItinerary: string }

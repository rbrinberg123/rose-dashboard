-- =============================================================================
-- Patch: Events Planner — Rose-owned itinerary tables (Admin → Events Planner)
-- Date:  2026-10-02
--
-- WHY
--   Super users turn a CRM event (roadshow, NDR, investor day, conference, site
--   visit…) into a minute-by-minute itinerary: meetings, travel, hotels, meals,
--   holds — then (later phases) check it for conflicts, send calendar invites
--   and print a client-ready PDF. Page: /admin/events.
--
-- CREATES
--   public.ep_event_types        addable list of event types (Roadshow, NDR…)
--   public.ep_meeting_types      addable list of meeting types (1:1, Group…)
--   public.ep_itineraries        one per planned event
--   public.ep_days               one per day (city + that city's time zone)
--   public.ep_items              every block on the schedule
--   public.ep_travel_legs        1:1 with travel items
--   public.ep_hotels             1:1 with hotel items
--   public.ep_attendees          people on the itinerary
--   public.ep_item_attendees     who is in which item
--   public.ep_invites            calendar-invite tracking (item × attendee)
--   public.ep_exports            PDF history
--   public.ep_activity_log       readable change log
--   public.v_ep_itineraries_list the list page, one row per itinerary
--
-- CRM IS READ-ONLY
--   The planner never writes events / meetings / contacts / accounts (the sync
--   would overwrite it). It only points at them by id. Those pointers are real
--   foreign keys with ON DELETE SET NULL, so if a CRM record is ever deleted
--   (the reconciliation approve-delete) the itinerary keeps its own copy of the
--   details and just loses the link. The sync's upserts are unaffected.
--
-- TIME
--   Every moment is a timestamptz — one exact instant, unambiguous. Each day
--   carries its city's IANA time zone (default America/New_York); the app
--   enters and shows times in that zone, with Eastern alongside when it differs.
--
-- SECURITY
--   RLS on, zero policies => only service_role reaches these tables — the same
--   lock as every other Rose-owned table. The real gate is in the app: proxy.ts
--   (/admin/events is in ADMIN_ONLY_ROUTES), the page's role check, and every
--   server action in app/admin/events/actions.ts re-checking on its own.
--
-- WHO
--   created_by_* / updated_by_* are public.users ids (Dynamics id space, no FK —
--   not every super user is guaranteed a row there) plus the name, the same
--   pattern as time_off_requests.
--
-- Safe to re-run.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- touch_updated_at() already exists (sql/02_rose_owned_tables.sql); re-declared
-- here so this patch stands alone.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---- 1. Type lists (addable) -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ep_event_types (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL UNIQUE,
  crm_type_label text,                       -- optional: the CRM event_type_label that maps here
  sort_order     integer NOT NULL DEFAULT 100,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ep_meeting_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  sort_order  integer NOT NULL DEFAULT 100,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ep_event_types (name, sort_order) VALUES
  ('Roadshow', 10), ('NDR', 20), ('Investor Day', 30), ('Conference', 40),
  ('Site Visit', 50), ('Reverse Roadshow', 60), ('Other', 999)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.ep_meeting_types (name, sort_order) VALUES
  ('One-on-One', 10), ('Group', 20), ('Breakfast', 30), ('Lunch', 40), ('Dinner', 50),
  ('Call', 60), ('Video', 70), ('Site Tour', 80), ('Other', 999)
ON CONFLICT (name) DO NOTHING;

-- ---- 2. Itineraries ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ep_itineraries (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_event_id             uuid REFERENCES public.events (event_id) ON DELETE SET NULL,
  client_company_id        uuid REFERENCES public.accounts (account_id) ON DELETE SET NULL,
  client_name_override     text,
  title                    text NOT NULL,
  subtitle                 text,
  event_type_id            uuid REFERENCES public.ep_event_types (id) ON DELETE SET NULL,
  status                   text NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','in_review','finalized','invites_sent','archived')),
  start_date               date NOT NULL,
  end_date                 date NOT NULL,
  home_timezone            text NOT NULL DEFAULT 'America/New_York',
  default_meeting_minutes  integer NOT NULL DEFAULT 45 CHECK (default_meeting_minutes BETWEEN 5 AND 600),
  internal_notes           text,               -- NEVER shown externally
  client_notes             text,               -- printed in the PDF
  confidential             boolean NOT NULL DEFAULT true,
  version                  integer NOT NULL DEFAULT 0,   -- +1 on each Finalise
  organizer_user_id        uuid,               -- public.users.user_id
  organizer_name           text,
  created_by_id            uuid,
  created_by_name          text,
  updated_by_id            uuid,
  updated_by_name          text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ep_itineraries_dates_ordered CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_ep_itineraries_event  ON public.ep_itineraries (crm_event_id);
CREATE INDEX IF NOT EXISTS idx_ep_itineraries_client ON public.ep_itineraries (client_company_id);
CREATE INDEX IF NOT EXISTS idx_ep_itineraries_dates  ON public.ep_itineraries (start_date, end_date);

-- ---- 3. Days -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ep_days (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id  uuid NOT NULL REFERENCES public.ep_itineraries (id) ON DELETE CASCADE,
  date          date NOT NULL,
  city          text,
  timezone      text NOT NULL DEFAULT 'America/New_York',
  day_title     text,
  day_notes     text,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ep_days_one_per_date UNIQUE (itinerary_id, date)
);

-- ---- 4. Items ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ep_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id          uuid NOT NULL REFERENCES public.ep_itineraries (id) ON DELETE CASCADE,
  day_id                uuid NOT NULL REFERENCES public.ep_days (id) ON DELETE CASCADE,
  item_type             text NOT NULL
                        CHECK (item_type IN ('meeting','travel','hotel','meal','break','hold','presentation','other')),
  crm_meeting_id        uuid REFERENCES public.meetings (meeting_id) ON DELETE SET NULL,
  title                 text NOT NULL,
  start_at              timestamptz NOT NULL,
  end_at                timestamptz NOT NULL,
  timezone              text NOT NULL DEFAULT 'America/New_York',   -- app sets it from the day
  meeting_type_id       uuid REFERENCES public.ep_meeting_types (id) ON DELETE SET NULL,  -- meetings only
  institution_name      text,
  institution_crm_id    uuid,   -- meetings.institution_id (Dynamics bcs_institution — not mirrored, so no FK)
  venue_name            text,
  address_line1         text,
  address_line2         text,
  city                  text,
  state                 text,
  postal_code           text,
  country               text,
  room_or_floor         text,
  lat                   double precision,
  lng                   double precision,
  at_investor_office    boolean NOT NULL DEFAULT false,
  video_url             text,
  dial_in               text,
  dial_in_passcode      text,
  status                text NOT NULL DEFAULT 'confirmed'
                        CHECK (status IN ('tentative','confirmed','cancelled')),
  notes_internal        text,     -- NEVER in a PDF or invite
  notes_external        text,     -- printed in the PDF and included in invites
  include_in_pdf        boolean NOT NULL DEFAULT true,
  send_invite           boolean NOT NULL DEFAULT true,   -- app defaults false for travel
  sort_order            integer NOT NULL DEFAULT 0,
  created_by_id         uuid,
  created_by_name       text,
  updated_by_id         uuid,
  updated_by_name       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ep_items_times_ordered CHECK (end_at >= start_at)
);

CREATE INDEX IF NOT EXISTS idx_ep_items_itinerary ON public.ep_items (itinerary_id, start_at);
CREATE INDEX IF NOT EXISTS idx_ep_items_day       ON public.ep_items (day_id, start_at);
CREATE INDEX IF NOT EXISTS idx_ep_items_time      ON public.ep_items (start_at, end_at);
-- A CRM meeting is imported at most once per itinerary.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ep_items_crm_meeting
  ON public.ep_items (itinerary_id, crm_meeting_id) WHERE crm_meeting_id IS NOT NULL;

-- ---- 5. Travel legs (1:1 with travel items) ----------------------------------
CREATE TABLE IF NOT EXISTS public.ep_travel_legs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                   uuid NOT NULL UNIQUE REFERENCES public.ep_items (id) ON DELETE CASCADE,
  mode                      text NOT NULL DEFAULT 'car_service'
                            CHECK (mode IN ('car_service','taxi_rideshare','walk','flight','train','other')),
  from_item_id              uuid REFERENCES public.ep_items (id) ON DELETE SET NULL,
  to_item_id                uuid REFERENCES public.ep_items (id) ON DELETE SET NULL,
  from_label                text,
  to_label                  text,
  from_address              text,
  to_address                text,
  from_timezone             text,   -- flights/trains crossing zones: departure zone
  to_timezone               text,   -- … and arrival zone
  duration_minutes          integer CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  buffer_minutes            integer NOT NULL DEFAULT 10 CHECK (buffer_minutes >= 0),
  duration_source           text NOT NULL DEFAULT 'manual' CHECK (duration_source IN ('manual','estimated')),
  transport_company         text,
  driver_name               text,
  driver_phone              text,
  vehicle_type              text,
  pickup_instructions       text,
  carrier                   text,
  flight_or_train_number    text,
  depart_terminal           text,
  arrive_terminal           text,
  seat_info                 text,
  confirmation_number       text,                          -- internal by default
  print_confirmation_number boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- ---- 6. Hotels (1:1 with hotel items) ----------------------------------------
CREATE TABLE IF NOT EXISTS public.ep_hotels (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id              uuid NOT NULL UNIQUE REFERENCES public.ep_items (id) ON DELETE CASCADE,
  hotel_name           text,
  address              text,
  phone                text,
  check_in_at          timestamptz,
  check_out_at         timestamptz,
  confirmation_number  text,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ---- 7. Attendees ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ep_attendees (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id             uuid NOT NULL REFERENCES public.ep_itineraries (id) ON DELETE CASCADE,
  crm_contact_id           uuid REFERENCES public.contacts (contact_id) ON DELETE SET NULL,
  full_name                text NOT NULL,
  email                    text,
  phone                    text,
  title                    text,
  company                  text,
  role                     text NOT NULL DEFAULT 'other'
                           CHECK (role IN ('client_executive','rose_staff','investor','host_broker','driver','other')),
  side                     text NOT NULL DEFAULT 'external'
                           CHECK (side IN ('internal','client','external')),
  receives_full_itinerary  boolean NOT NULL DEFAULT false,
  sort_order               integer NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ep_attendees_itinerary ON public.ep_attendees (itinerary_id);
CREATE INDEX IF NOT EXISTS idx_ep_attendees_contact   ON public.ep_attendees (crm_contact_id) WHERE crm_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ep_attendees_email     ON public.ep_attendees (lower(email)) WHERE email IS NOT NULL;
-- A CRM contact is on an itinerary at most once.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ep_attendees_contact
  ON public.ep_attendees (itinerary_id, crm_contact_id) WHERE crm_contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ep_item_attendees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES public.ep_items (id) ON DELETE CASCADE,
  attendee_id  uuid NOT NULL REFERENCES public.ep_attendees (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ep_item_attendees_unique UNIQUE (item_id, attendee_id)
);

-- The cross-itinerary double-booking check (Phase 3) walks attendee → items.
CREATE INDEX IF NOT EXISTS idx_ep_item_attendees_attendee ON public.ep_item_attendees (attendee_id);

-- ---- 8. Invites --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ep_invites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id            uuid NOT NULL REFERENCES public.ep_items (id) ON DELETE CASCADE,
  attendee_id        uuid NOT NULL REFERENCES public.ep_attendees (id) ON DELETE CASCADE,
  ical_uid           text NOT NULL,                       -- ep-{itemId}@roseandco.com, stable
  sequence           integer NOT NULL DEFAULT 0,
  provider           text CHECK (provider IN ('graph','ics_email','ics_download')),
  provider_event_id  text,
  status             text NOT NULL DEFAULT 'not_sent'
                     CHECK (status IN ('not_sent','sent','update_pending','updated','cancelled','failed')),
  dry_run            boolean NOT NULL DEFAULT false,
  last_sent_at       timestamptz,
  last_payload_hash  text,
  error_message      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ep_invites_unique UNIQUE (item_id, attendee_id)
);

CREATE INDEX IF NOT EXISTS idx_ep_invites_attendee ON public.ep_invites (attendee_id);

-- ---- 9. Exports + activity ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ep_exports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id       uuid NOT NULL REFERENCES public.ep_itineraries (id) ON DELETE CASCADE,
  version            integer NOT NULL,
  storage_path       text NOT NULL,      -- private bucket 'event-itineraries'
  generated_by_id    uuid,
  generated_by_name  text,
  generated_at       timestamptz NOT NULL DEFAULT now(),
  options            jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ep_exports_itinerary ON public.ep_exports (itinerary_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS public.ep_activity_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  itinerary_id  uuid NOT NULL REFERENCES public.ep_itineraries (id) ON DELETE CASCADE,
  actor_id      uuid,
  actor_name    text,
  action        text NOT NULL,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ep_activity_itinerary ON public.ep_activity_log (itinerary_id, created_at DESC);

-- ---- 10. updated_at triggers -------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ep_event_types','ep_meeting_types','ep_itineraries','ep_days','ep_items',
                           'ep_travel_legs','ep_hotels','ep_attendees','ep_invites']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_touch_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
                   t || '_touch_updated_at', t);
  END LOOP;
END $$;

-- ---- 11. Lock down -----------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ep_event_types','ep_meeting_types','ep_itineraries','ep_days','ep_items',
                           'ep_travel_legs','ep_hotels','ep_attendees','ep_item_attendees','ep_invites',
                           'ep_exports','ep_activity_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ---- 12. List view -----------------------------------------------------------
-- One row per itinerary for /admin/events. Client = override, else the CRM
-- account name. Cities = the days' cities in date order. Meetings = meeting
-- items not cancelled.
CREATE OR REPLACE VIEW public.v_ep_itineraries_list AS
SELECT
  i.id,
  i.title,
  i.subtitle,
  i.status,
  i.start_date,
  i.end_date,
  i.crm_event_id,
  i.client_company_id,
  COALESCE(NULLIF(btrim(i.client_name_override), ''), a.name) AS client_name,
  et.name                                                     AS event_type_name,
  (SELECT string_agg(DISTINCT d.city, ' · ')
     FROM public.ep_days d
    WHERE d.itinerary_id = i.id AND NULLIF(btrim(d.city), '') IS NOT NULL) AS cities,
  (SELECT count(*)
     FROM public.ep_items it
    WHERE it.itinerary_id = i.id AND it.item_type = 'meeting' AND it.status <> 'cancelled')::int AS meeting_count,
  i.organizer_user_id,
  i.organizer_name,
  i.created_by_id,
  i.created_by_name,
  i.updated_by_name,
  i.created_at,
  i.updated_at
FROM public.ep_itineraries i
LEFT JOIN public.accounts a        ON a.account_id = i.client_company_id
LEFT JOIN public.ep_event_types et ON et.id = i.event_type_id;

GRANT SELECT ON public.v_ep_itineraries_list TO service_role;


-- ---- CHECK IT ---------------------------------------------------------------
-- SELECT name FROM public.ep_event_types ORDER BY sort_order;     -- 7 rows
-- SELECT name FROM public.ep_meeting_types ORDER BY sort_order;   -- 9 rows
-- SELECT * FROM public.v_ep_itineraries_list;                     -- 0 rows until the first itinerary
--
-- Map a CRM event type to a planner type (so "From CRM event" pre-fills it):
-- SELECT DISTINCT event_type_label FROM public.events WHERE event_type_label IS NOT NULL;
-- UPDATE public.ep_event_types SET crm_type_label = '<CRM label>' WHERE name = 'Roadshow';

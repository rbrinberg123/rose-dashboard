-- =============================================================================
-- Patch: Events Planner — Phase 3 (travel buffers) + availability blocks
-- Date:  2026-10-02
-- Needs: 2026-10-02d_events_planner.sql (run first)
--
-- ADDS
--   ep_itineraries.buffer_car_minutes      default buffer after a car / taxi leg (10)
--   ep_itineraries.buffer_walk_minutes     default buffer after a walk incl. lobby check-in (15)
--   ep_itineraries.airport_lead_minutes    "be at the airport" lead before a flight (90)
--   public.ep_availability_blocks          bookable windows on a day ("Fidelity, 9–12,
--                                          their office") that meetings are booked into
--   ep_items.availability_block_id         the block a meeting was booked into (nullable)
--
-- HOST
--   host_crm_account_id points at the CRM accounts mirror (Rose's clients). Investor
--   firms are NOT in that table (the CRM's institutions aren't mirrored), so
--   host_institution_crm_id carries the institution id the way meetings.institution_id
--   does — no FK. host_institution_name is always the display name.
--
-- SECURITY
--   Same as every ep_ table: RLS on, zero policies (service_role only); the
--   super-user gate lives in proxy.ts + every server action.
--
-- Safe to re-run.
-- =============================================================================

-- ---- 1. Per-itinerary buffer defaults ---------------------------------------
ALTER TABLE public.ep_itineraries
  ADD COLUMN IF NOT EXISTS buffer_car_minutes   integer NOT NULL DEFAULT 10 CHECK (buffer_car_minutes BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS buffer_walk_minutes  integer NOT NULL DEFAULT 15 CHECK (buffer_walk_minutes BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS airport_lead_minutes integer NOT NULL DEFAULT 90 CHECK (airport_lead_minutes BETWEEN 0 AND 480);

-- ---- 2. Availability blocks ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ep_availability_blocks (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id             uuid NOT NULL REFERENCES public.ep_itineraries (id) ON DELETE CASCADE,
  day_id                   uuid NOT NULL REFERENCES public.ep_days (id) ON DELETE CASCADE,
  start_at                 timestamptz NOT NULL,
  end_at                   timestamptz NOT NULL,
  timezone                 text NOT NULL DEFAULT 'America/New_York',   -- app sets it from the day
  label                    text,
  host_institution_name    text,
  host_crm_account_id      uuid REFERENCES public.accounts (account_id) ON DELETE SET NULL,
  host_institution_crm_id  uuid,          -- meetings.institution_id space; not mirrored, no FK
  venue_name               text,
  address_line1            text,
  address_line2            text,
  city                     text,
  state                    text,
  postal_code              text,
  country                  text,
  room_or_floor            text,
  at_investor_office       boolean NOT NULL DEFAULT false,
  video_url                text,
  dial_in                  text,
  dial_in_passcode         text,
  default_slot_minutes     integer NOT NULL DEFAULT 30 CHECK (default_slot_minutes BETWEEN 5 AND 600),
  default_buffer_minutes   integer NOT NULL DEFAULT 5  CHECK (default_buffer_minutes BETWEEN 0 AND 240),
  block_type               text NOT NULL DEFAULT 'hard' CHECK (block_type IN ('hard','soft')),
  notes_internal           text,
  notes_external           text,
  sort_order               integer NOT NULL DEFAULT 0,
  source                   text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','imported')),
  created_by_id            uuid,
  created_by_name          text,
  updated_by_id            uuid,
  updated_by_name          text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ep_availability_blocks_times_ordered CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS idx_ep_blocks_itinerary ON public.ep_availability_blocks (itinerary_id, start_at);
CREATE INDEX IF NOT EXISTS idx_ep_blocks_day       ON public.ep_availability_blocks (day_id, start_at);

-- ---- 3. Meetings booked into a block ---------------------------------------
ALTER TABLE public.ep_items
  ADD COLUMN IF NOT EXISTS availability_block_id uuid
    REFERENCES public.ep_availability_blocks (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ep_items_block ON public.ep_items (availability_block_id)
  WHERE availability_block_id IS NOT NULL;

-- ---- 4. Trigger + lock down ------------------------------------------------
DROP TRIGGER IF EXISTS ep_availability_blocks_touch_updated_at ON public.ep_availability_blocks;
CREATE TRIGGER ep_availability_blocks_touch_updated_at
  BEFORE UPDATE ON public.ep_availability_blocks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.ep_availability_blocks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ep_availability_blocks TO service_role;


-- ---- CHECK IT ---------------------------------------------------------------
-- SELECT buffer_car_minutes, buffer_walk_minutes, airport_lead_minutes FROM public.ep_itineraries LIMIT 5;
-- SELECT count(*) FROM public.ep_availability_blocks;                      -- 0 until the first block
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'ep_items' AND column_name = 'availability_block_id'; -- 1 row

-- ===========================================================================
-- 2026-10-07h_meetings_cancellation_rescheduling.sql
--
-- FLATTEN three meeting fields that so far lived only in meetings._raw, so the
-- Edit Meeting form can show and write them (the same pattern as
-- 2026-09-23e_meetings_flatten_full_fields.sql):
--
--   cancelled_code / cancelled_label  int / text   <- bcs_cancelled (CHOICE)
--        755860000 All Cancelled · 755860001 iPlanner Cancelled ·
--        755860002 Outlook Cancelled     (402 meetings carry a value)
--   contact_radar                     boolean      <- bcs_contactradar (Yes/No)
--   rescheduled_notes                 text         <- bcs_reschedulednotes
--
-- Already flattened (no change): rescheduled (boolean <- bcs_rescheduledmeeting)
-- and cancellation_notes (text <- bcs_cancellationnotes).
--
-- The sync (lib/sync/mappers.ts mapMeeting) writes the new columns too, so
-- RUN THIS BEFORE THE CODE DEPLOYS — otherwise every meetings sync fails on
-- the unknown columns, and the Edit Meeting form can't load.
--
-- Run ONCE in the Supabase SQL editor. Safe to re-run.
-- See dashboard/content/docs/12-meetings-all.md.
-- ===========================================================================

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS cancelled_code     integer,
  ADD COLUMN IF NOT EXISTS cancelled_label    text,
  ADD COLUMN IF NOT EXISTS contact_radar      boolean,
  ADD COLUMN IF NOT EXISTS rescheduled_notes  text;

COMMENT ON COLUMN public.meetings.cancelled_code IS
  'bcs_cancelled (choice): 755860000 All Cancelled, 755860001 iPlanner Cancelled, 755860002 Outlook Cancelled.';
COMMENT ON COLUMN public.meetings.contact_radar IS 'bcs_contactradar (Yes/No).';
COMMENT ON COLUMN public.meetings.rescheduled_notes IS 'bcs_reschedulednotes.';

-- Backfill from _raw (Dynamics rows). Only fills blanks, so it is re-runnable
-- and never overwrites a value the dashboard wrote.
UPDATE public.meetings m
   SET cancelled_code    = COALESCE(m.cancelled_code, NULLIF(m._raw ->> 'bcs_cancelled', '')::integer),
       cancelled_label   = COALESCE(m.cancelled_label,
                                    NULLIF(m._raw ->> 'bcs_cancelled@OData.Community.Display.V1.FormattedValue', '')),
       contact_radar     = COALESCE(m.contact_radar, NULLIF(m._raw ->> 'bcs_contactradar', '')::boolean),
       rescheduled_notes = COALESCE(m.rescheduled_notes, NULLIF(m._raw ->> 'bcs_reschedulednotes', ''))
 WHERE m._raw ? 'bcs_cancelled'
    OR m._raw ? 'bcs_contactradar'
    OR m._raw ? 'bcs_reschedulednotes';

-- ---- Verify ------------------------------------------------------------------
--   SELECT count(cancelled_code) AS cancelled,      -- ~402
--          count(contact_radar)  AS contact_radar,  -- ~4,894
--          count(rescheduled_notes) AS resched_notes -- ~113
--     FROM public.meetings;

-- =============================================================================
-- Patch: mirror six new Dynamics logistics fields
-- Date: 2026-07-27
--
-- Adds five meeting fields and one event field to the mirror tables:
--
--   public.meetings
--     sent            boolean   <- bcs_Sent      (Yes/No, verified in _raw)
--     confirm         boolean   <- bcs_Confirm   (Yes/No, verified in _raw)
--     food_order      text      <- bcs_FoodOrder (empty everywhere so far)
--     driver          boolean   <- bcs_Driver    (Yes/No, verified in _raw)
--     logistics_notes text      <- bcs_Notes     (empty everywhere so far)
--
--   public.events
--     profile_link    text      <- bcs_ProfileLink (SharePoint URL, verified in _raw)
--
-- Type basis: the sync stores the full Dynamics record in each table's _raw
-- JSONB column, so the shape of every field was read directly from stored rows
-- (13,194 meetings / 902 events scanned 2026-07-27):
--   * bcs_sent / bcs_confirm / bcs_driver returned true/false with a "Yes"/"No"
--     FormattedValue in 170 rows each  -> boolean.
--   * bcs_profilelink returned SharePoint URL strings                  -> text.
--   * bcs_foodorder / bcs_notes were present as keys but NULL in every row (no
--     data captured yet), so their type could not be observed. They are typed
--     text — the loss-free superset (str() preserves any incoming string; a
--     boolean column would coerce and discard information). If a future value
--     reveals bcs_foodorder to be a Yes/No or a choice, revisit this column.
--
-- Editing sql/01_mirror_tables.sql and sql/16_events_table.sql (the source of
-- truth for the CREATE TABLE shapes) does NOT change the live database — that is
-- what this patch is for. Paste the whole file into the Supabase SQL Editor.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a re-runnable backfill. Safe to run
-- more than once.
--
-- Source of truth: sql/01_mirror_tables.sql (meetings), sql/16_events_table.sql
-- (events), dashboard/lib/sync/mappers.ts (mapMeeting / mapEvent).
-- =============================================================================

-- --- 1. Columns -------------------------------------------------------------

ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS sent            boolean;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS confirm         boolean;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS food_order      text;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS driver          boolean;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS logistics_notes text;

ALTER TABLE public.events   ADD COLUMN IF NOT EXISTS profile_link    text;

-- --- 2. Backfill from _raw --------------------------------------------------
--
-- Every mirror row already holds the source value in its _raw blob, so the
-- historical rows can be filled without a re-sync. Going forward the normal
-- incremental sync populates these columns on any create/edit (see mappers.ts).
-- ->> extracts the JSON value as text; ::boolean casts the 'true'/'false' text
-- of the Yes/No fields. Rows without the key resolve to NULL and are skipped by
-- the WHERE guard.

UPDATE public.meetings SET
  sent            = (_raw->>'bcs_sent')::boolean,
  confirm         = (_raw->>'bcs_confirm')::boolean,
  food_order      = _raw->>'bcs_foodorder',
  driver          = (_raw->>'bcs_driver')::boolean,
  logistics_notes = _raw->>'bcs_notes'
WHERE _raw ?| array['bcs_sent','bcs_confirm','bcs_foodorder','bcs_driver','bcs_notes'];

UPDATE public.events SET
  profile_link = _raw->>'bcs_profilelink'
WHERE _raw ? 'bcs_profilelink';

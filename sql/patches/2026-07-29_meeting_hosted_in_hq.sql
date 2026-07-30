-- =============================================================================
-- Patch: mirror the bcs_HostedinHQ meeting field
-- Date: 2026-07-29
--
-- Adds one meeting field to the mirror table:
--
--   public.meetings
--     hosted_in_hq   boolean   <- bcs_hostedinhq (Yes/No)
--
-- bcs_HostedinHQ (Web API logical name bcs_hostedinhq) is a Dynamics Yes/No
-- boolean: true when the client is hosted in the HQ / office that day. It is the
-- authoritative "in the office" flag for the Week Ahead email digest — the NY-
-- office banner and the week-grid pins are driven off it (replacing the earlier
-- "Live + city = New York" guess).
--
-- Type basis: the sync stores the full Dynamics record in each table's _raw
-- JSONB column. bcs_sent/bcs_confirm/bcs_driver on this same entity are Yes/No
-- booleans, and bcs_hostedinhq is the same field type, so it is typed boolean.
-- Verify against a stored _raw sample before/after running (a Yes/No field
-- surfaces as true/false with a "Yes"/"No" FormattedValue).
--
-- Editing sql/01_mirror_tables.sql (the CREATE TABLE source of truth) does NOT
-- change the live database — that is what this patch is for. Paste the whole
-- file into the Supabase SQL Editor.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a re-runnable backfill. Safe to run
-- more than once.
--
-- Source of truth: sql/01_mirror_tables.sql (meetings),
-- dashboard/lib/sync/mappers.ts (mapMeeting). v_planning_events must be
-- re-created to expose the column (see sql/03_views.sql).
-- =============================================================================

-- --- 1. Column --------------------------------------------------------------

ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS hosted_in_hq boolean;

-- --- 2. Backfill from _raw --------------------------------------------------
--
-- Every mirror row already holds the source value in its _raw blob, so history
-- can be filled without a re-sync. Going forward the normal incremental sync
-- populates the column on any create/edit (see mappers.ts). ->> extracts the
-- JSON value as text; ::boolean casts the 'true'/'false' text of the Yes/No
-- field. Rows without the key resolve to NULL and are skipped by the WHERE guard.

UPDATE public.meetings SET
  hosted_in_hq = (_raw->>'bcs_hostedinhq')::boolean
WHERE _raw ? 'bcs_hostedinhq';

-- --- 3. Re-create v_planning_events to expose hosted_in_hq ------------------
-- Run the CREATE VIEW for public.v_planning_events from sql/03_views.sql after
-- this patch (it now appends m.hosted_in_hq to the ev CTE and final SELECT).

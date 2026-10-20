-- ===========================================================================
-- 2026-10-20b_event_prep_toggles.sql
--
-- Event PREP CHECKLIST — five Yes / No toggles on the event drawer's and the
-- Edit Event form's "Targeting & Other Prep" tab:
--   Assigned to run · Targeting run · Sent to client manager ·
--   Client manager reviewed · Coverage assigned
--
-- All five columns are DASHBOARD-OWNED: never written by the Dynamics sync
-- (mapEvent in dashboard/lib/sync/mappers.ts upserts only its own columns),
-- so they are safe on Dynamics-origin events too (like event_contacts /
-- tasks.closed_at). The drawer reads them straight off public.events (with
-- is_test / origin / paused), so NO view changes.
--
-- Run ONCE in the Supabase SQL editor. Safe to re-run. Until it is run the
-- drawer and the Edit Event form fail to load / save events, so run it BEFORE
-- the code deploys. See dashboard/content/docs/13-events.md → "Prep checklist".
-- ===========================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS assigned_to_run         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS targeting_run           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sent_to_client_manager  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_manager_reviewed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coverage_assigned       boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.assigned_to_run IS
  'DASHBOARD-OWNED. Prep checklist (Targeting & Other Prep tab): Assigned to run.';
COMMENT ON COLUMN public.events.targeting_run IS
  'DASHBOARD-OWNED. Prep checklist (Targeting & Other Prep tab): Targeting run.';
COMMENT ON COLUMN public.events.sent_to_client_manager IS
  'DASHBOARD-OWNED. Prep checklist (Targeting & Other Prep tab): Sent to client manager.';
COMMENT ON COLUMN public.events.client_manager_reviewed IS
  'DASHBOARD-OWNED. Prep checklist (Targeting & Other Prep tab): Client manager reviewed.';
COMMENT ON COLUMN public.events.coverage_assigned IS
  'DASHBOARD-OWNED. Prep checklist (Targeting & Other Prep tab): Coverage assigned.';

-- ---- Check after running ------------------------------------------------------
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'events'
--      AND column_name IN ('assigned_to_run', 'targeting_run', 'sent_to_client_manager',
--                          'client_manager_reviewed', 'coverage_assigned');
--   -- expect 5 rows: boolean, NO, false

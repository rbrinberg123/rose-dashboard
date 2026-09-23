-- =============================================================================
-- Patch: ownership boundary ("origin fence") on the writable mirror tables
-- Date:  2026-09-23
--
-- WHY
--   The dashboard is going to start writing its own rows into the mirror tables
--   (and eventually replace Dynamics as the CRM). Before the FIRST such write,
--   the sync has to be unable to clobber or delete a dashboard-authored row.
--
--   The 10-minute sync (lib/sync/run.ts) is already safe: it upserts ON
--   CONFLICT on the Dynamics GUID pk, which a dashboard gen_random_uuid() will
--   never match. The danger is the nightly deletion sweep
--   (lib/sync/reconcile.ts): it flags every mirror row whose pk is not in
--   Dynamics -- which is EVERY dashboard row -- and an approve on
--   /admin/reconciliation hard-deletes it.
--
-- WHAT THIS PATCH DOES
--   Part A  origin ('dynamics' | 'dashboard', default 'dynamics') and is_test
--           (default false) on the 8 tables the dashboard will write to:
--           accounts, contacts, meetings, tasks, touchpoints, client_notes,
--           events, contracts. Constant defaults: Postgres fills every existing
--           row instantly (no rewrite, no backfill) -> all existing rows are
--           'dynamics' / false.
--   Part B  lock_origin(): BEFORE UPDATE trigger on those 8 tables that forces
--           NEW.origin := OLD.origin, so no update (a sync upsert on a
--           colliding id included) can ever flip a row's owner.
--           Trigger names end in _lock_origin so they fire BEFORE the
--           _touch_synced_at triggers (Postgres fires same-timing triggers in
--           name order: "lock" < "touch").
--   Part C  touch_synced_at(): stamp _synced_at only when the row is NOT
--           dashboard-origin. Uses to_jsonb(NEW)->>'origin' so it stays safe on
--           the tables that have no origin column (new_vacationrequest) --
--           there it reads NULL and stamps exactly as before.
--
-- ORDER -- RUN THIS BEFORE THE CODE SHIPS
--   The code half of the fence (reconcile.ts sweep filter + the approve-delete
--   guard in app/admin/reconciliation/actions.ts) filters on origin. If that
--   code runs against a table without the column, the sweep for that entity
--   errors (it skips; nothing is flagged or deleted, but the sweep is blind).
--
-- RE-RUN HAZARD
--   touch_synced_at() is also defined in sql/01_mirror_tables.sql and
--   sql/patches/2026-09-09_feedback_received_and_synced_at.sql. Re-running
--   either of those restores the OLD body (stamps dashboard rows too). If you
--   ever re-run them, re-run Part C of this patch afterwards.
--
-- Safe to re-run.
-- =============================================================================


-- ---- PART A -- origin + is_test columns ------------------------------------
-- ADD COLUMN IF NOT EXISTS skips the whole clause (CHECK included) on re-run.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS origin  text    NOT NULL DEFAULT 'dynamics' CHECK (origin IN ('dynamics','dashboard')),
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS origin  text    NOT NULL DEFAULT 'dynamics' CHECK (origin IN ('dynamics','dashboard')),
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS origin  text    NOT NULL DEFAULT 'dynamics' CHECK (origin IN ('dynamics','dashboard')),
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS origin  text    NOT NULL DEFAULT 'dynamics' CHECK (origin IN ('dynamics','dashboard')),
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

ALTER TABLE public.touchpoints
  ADD COLUMN IF NOT EXISTS origin  text    NOT NULL DEFAULT 'dynamics' CHECK (origin IN ('dynamics','dashboard')),
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

ALTER TABLE public.client_notes
  ADD COLUMN IF NOT EXISTS origin  text    NOT NULL DEFAULT 'dynamics' CHECK (origin IN ('dynamics','dashboard')),
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS origin  text    NOT NULL DEFAULT 'dynamics' CHECK (origin IN ('dynamics','dashboard')),
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS origin  text    NOT NULL DEFAULT 'dynamics' CHECK (origin IN ('dynamics','dashboard')),
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;


-- ---- PART B -- origin-lock trigger (the 8 tables only) ---------------------
CREATE OR REPLACE FUNCTION public.lock_origin()
RETURNS trigger AS $$
BEGIN
  NEW.origin := OLD.origin;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounts_lock_origin ON public.accounts;
CREATE TRIGGER accounts_lock_origin
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.lock_origin();

DROP TRIGGER IF EXISTS contacts_lock_origin ON public.contacts;
CREATE TRIGGER contacts_lock_origin
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.lock_origin();

DROP TRIGGER IF EXISTS meetings_lock_origin ON public.meetings;
CREATE TRIGGER meetings_lock_origin
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.lock_origin();

DROP TRIGGER IF EXISTS tasks_lock_origin ON public.tasks;
CREATE TRIGGER tasks_lock_origin
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.lock_origin();

DROP TRIGGER IF EXISTS touchpoints_lock_origin ON public.touchpoints;
CREATE TRIGGER touchpoints_lock_origin
  BEFORE UPDATE ON public.touchpoints
  FOR EACH ROW EXECUTE FUNCTION public.lock_origin();

DROP TRIGGER IF EXISTS client_notes_lock_origin ON public.client_notes;
CREATE TRIGGER client_notes_lock_origin
  BEFORE UPDATE ON public.client_notes
  FOR EACH ROW EXECUTE FUNCTION public.lock_origin();

DROP TRIGGER IF EXISTS events_lock_origin ON public.events;
CREATE TRIGGER events_lock_origin
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.lock_origin();

DROP TRIGGER IF EXISTS contracts_lock_origin ON public.contracts;
CREATE TRIGGER contracts_lock_origin
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.lock_origin();


-- ---- PART C -- _synced_at skips dashboard rows ------------------------------
-- Replaces the body only; the existing _touch_synced_at triggers on all nine
-- tables pick it up without being re-created. A dashboard row keeps whatever
-- _synced_at it was inserted with (the column DEFAULT now()) and is never
-- re-stamped -- "synced" means "came from Dynamics", which a dashboard row
-- never did. Dashboard writes should track their own edit time in modified_on.
CREATE OR REPLACE FUNCTION public.touch_synced_at()
RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) ->> 'origin') IS DISTINCT FROM 'dashboard' THEN
    NEW._synced_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---- CHECK IT (run by hand after the patch) ---------------------------------
-- 1. Every existing row is 'dynamics' / not test. Expect ONE row per table:
--    origin = 'dynamics', is_test = false, n = the table's full row count.
--
-- SELECT 'accounts'     AS t, origin, is_test, count(*) AS n FROM public.accounts     GROUP BY 1,2,3
-- UNION ALL SELECT 'contacts',     origin, is_test, count(*) FROM public.contacts     GROUP BY 1,2,3
-- UNION ALL SELECT 'meetings',     origin, is_test, count(*) FROM public.meetings     GROUP BY 1,2,3
-- UNION ALL SELECT 'tasks',        origin, is_test, count(*) FROM public.tasks        GROUP BY 1,2,3
-- UNION ALL SELECT 'touchpoints',  origin, is_test, count(*) FROM public.touchpoints  GROUP BY 1,2,3
-- UNION ALL SELECT 'client_notes', origin, is_test, count(*) FROM public.client_notes GROUP BY 1,2,3
-- UNION ALL SELECT 'events',       origin, is_test, count(*) FROM public.events       GROUP BY 1,2,3
-- UNION ALL SELECT 'contracts',    origin, is_test, count(*) FROM public.contracts    GROUP BY 1,2,3
-- ORDER BY 1,2,3;
--
-- 2. Triggers are attached. Expect 8 rows (one *_lock_origin per table).
--
-- SELECT event_object_table, trigger_name
-- FROM information_schema.triggers
-- WHERE trigger_name LIKE '%\_lock\_origin'
-- ORDER BY 1;
--
-- 3. The review queue holds no pending candidate that points at a
--    dashboard-origin row. Expect ZERO rows (there are no dashboard rows yet;
--    re-run this after the first dashboard write too).
--
-- SELECT dc.id, dc.entity_name, dc.pk_value, dc.label
-- FROM public.deletion_candidates dc
-- WHERE dc.status = 'pending'
--   AND (
--        (dc.table_name = 'accounts'     AND EXISTS (SELECT 1 FROM public.accounts     x WHERE x.account_id::text    = lower(dc.pk_value) AND x.origin = 'dashboard'))
--     OR (dc.table_name = 'contacts'     AND EXISTS (SELECT 1 FROM public.contacts     x WHERE x.contact_id::text    = lower(dc.pk_value) AND x.origin = 'dashboard'))
--     OR (dc.table_name = 'meetings'     AND EXISTS (SELECT 1 FROM public.meetings     x WHERE x.meeting_id::text    = lower(dc.pk_value) AND x.origin = 'dashboard'))
--     OR (dc.table_name = 'tasks'        AND EXISTS (SELECT 1 FROM public.tasks        x WHERE x.task_id::text       = lower(dc.pk_value) AND x.origin = 'dashboard'))
--     OR (dc.table_name = 'touchpoints'  AND EXISTS (SELECT 1 FROM public.touchpoints  x WHERE x.touchpoint_id::text = lower(dc.pk_value) AND x.origin = 'dashboard'))
--     OR (dc.table_name = 'client_notes' AND EXISTS (SELECT 1 FROM public.client_notes x WHERE x.note_id::text       = lower(dc.pk_value) AND x.origin = 'dashboard'))
--     OR (dc.table_name = 'events'       AND EXISTS (SELECT 1 FROM public.events       x WHERE x.event_id::text      = lower(dc.pk_value) AND x.origin = 'dashboard'))
--     OR (dc.table_name = 'contracts'    AND EXISTS (SELECT 1 FROM public.contracts    x WHERE x.contract_id::text   = lower(dc.pk_value) AND x.origin = 'dashboard'))
--   );

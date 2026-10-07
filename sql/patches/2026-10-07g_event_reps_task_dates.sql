-- ===========================================================================
-- 2026-10-07g_event_reps_task_dates.sql
--
--   A. COMPANY REPRESENTATIVES — public.event_contacts, a DASHBOARD-OWNED
--      junction (event ↔ existing contact). Nothing in Dynamics' synced data
--      carries an event↔contact link (checked 2026-10-07: no synced entity, and
--      no representative field on events._raw), so this is new and the sync
--      never writes it. Written only by the event form's server actions
--      (requireCrmWriter, audited). Cascades away with its event / contact.
--
--   B. MEMO DATE + TARGETING DATE join LAST DATA UPLOAD as LOOKED-UP dates on
--      dashboard-origin events — each the completion time (actual_end) of the
--      client's most recent Completed task of a sub-type:
--        events.last_data_upload  ← 'Data Upload'
--        events.teaser_date       ← 'Marketing Memo'   (the drawer's "Memo Date")
--        events.targeting_date    ← 'Targeting'
--      Client-level (tasks.bcs_account_id), latest wins, never typed. Set by the
--      events_compute_stage trigger and refreshed whenever such a task changes.
--      Replaces 2026-10-07f's Data-Upload-only trigger with one for all three.
--
-- Dynamics-origin events are not touched (event_lifecycle_in_scope).
--
-- PREREQUISITE: 2026-10-07e_event_lifecycle.sql. Works whether or not
-- 2026-10-07f has been run (it redefines everything it needs).
-- Run this ONCE in the Supabase SQL editor. Safe to re-run.
-- See dashboard/content/docs/13-events.md.
-- ===========================================================================

-- ---- A. event_contacts --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_contacts (
  event_id      uuid        NOT NULL REFERENCES public.events (event_id) ON DELETE CASCADE,
  contact_id    uuid        NOT NULL REFERENCES public.contacts (contact_id) ON DELETE CASCADE,
  added_by_id   uuid,
  added_by_name text,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, contact_id)
);

COMMENT ON TABLE public.event_contacts IS
  'Dashboard-owned: an event''s company representatives (existing contacts). '
  'Not synced from Dynamics. Written by app/events/actions.ts (createEvent / '
  'updateEvent), gated by requireCrmWriter and audited.';

CREATE INDEX IF NOT EXISTS idx_event_contacts_contact ON public.event_contacts (contact_id);

-- Service-role only (the app's server actions); no anon / authenticated access.
ALTER TABLE public.event_contacts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.event_contacts TO service_role;

-- ---- B. The lookup (one rule for all three dates) ---------------------------
CREATE OR REPLACE FUNCTION public.event_client_latest_task(p_account uuid, p_subtype text)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT MAX(t.actual_end)
    FROM public.tasks t
   WHERE t.bcs_account_id = p_account
     AND t.bcs_task_subtype_label = p_subtype
     AND t.state_label = 'Completed'
$$;

-- Kept for anything that called the 2026-10-07f name.
CREATE OR REPLACE FUNCTION public.event_client_last_data_upload(p_account uuid)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT public.event_client_latest_task(p_account, 'Data Upload')
$$;

CREATE INDEX IF NOT EXISTS idx_tasks_account_subtype
  ON public.tasks (bcs_account_id, bcs_task_subtype_label);

-- ---- The events trigger: stage + marketing + the three looked-up dates ----
CREATE OR REPLACE FUNCTION public.trg_events_compute_stage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_stage text;
BEGIN
  IF NOT public.event_lifecycle_in_scope(NEW.origin) THEN RETURN NEW; END IF;
  v_stage := public.event_lifecycle_stage(
    NEW.event_id, NEW.launch, NEW.outreach_complete, NEW.paused, NEW.event_start_actual);
  NEW.event_state_label := v_stage;
  NEW.event_state_code  := public.event_stage_code(v_stage);
  -- Marketing in lockstep with the stage (2026-10-07f).
  IF v_stage = 'Live Outreach' THEN
    NEW.marketing_state_code  := 755860001;
    NEW.marketing_state_label := 'Marketing';
  ELSE
    NEW.marketing_state_code  := 755860000;
    NEW.marketing_state_label := 'Not Marketing';
  END IF;
  -- Looked-up dates from the client's tasks.
  NEW.last_data_upload := public.event_client_latest_task(NEW.client_account_id, 'Data Upload');
  NEW.teaser_date      := public.event_client_latest_task(NEW.client_account_id, 'Marketing Memo');
  NEW.targeting_date   := public.event_client_latest_task(NEW.client_account_id, 'Targeting');
  RETURN NEW;
END $$;

-- ---- Task changes → refresh that client's dashboard events ------------------
CREATE OR REPLACE FUNCTION public.event_refresh_client_task_dates(p_account uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_upload    timestamptz;
  v_memo      timestamptz;
  v_targeting timestamptz;
  v_n         integer;
BEGIN
  IF p_account IS NULL THEN RETURN 0; END IF;
  v_upload    := public.event_client_latest_task(p_account, 'Data Upload');
  v_memo      := public.event_client_latest_task(p_account, 'Marketing Memo');
  v_targeting := public.event_client_latest_task(p_account, 'Targeting');
  -- The BEFORE trigger re-derives the values itself; the SET just touches rows
  -- whose stored dates are out of date.
  UPDATE public.events
     SET last_data_upload = v_upload, teaser_date = v_memo, targeting_date = v_targeting
   WHERE client_account_id = p_account
     AND public.event_lifecycle_in_scope(origin)
     AND (last_data_upload IS DISTINCT FROM v_upload
          OR teaser_date IS DISTINCT FROM v_memo
          OR targeting_date IS DISTINCT FROM v_targeting);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    INSERT INTO public.audit_log (action, entity, record_id, changes, context)
    VALUES ('update', 'events', p_account::text,
            jsonb_build_object('last_data_upload', v_upload, 'teaser_date', v_memo,
                               'targeting_date', v_targeting, 'events_updated', v_n),
            'automation:event-task-dates');
  END IF;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.trg_tasks_event_task_dates()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_types text[] := ARRAY['Data Upload', 'Marketing Memo', 'Targeting'];
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.bcs_task_subtype_label = ANY (v_types) THEN
    PERFORM public.event_refresh_client_task_dates(OLD.bcs_account_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.bcs_task_subtype_label = ANY (v_types)
     AND (TG_OP = 'INSERT'
          OR NEW.bcs_account_id IS DISTINCT FROM OLD.bcs_account_id
          OR NOT (OLD.bcs_task_subtype_label = ANY (v_types))) THEN
    PERFORM public.event_refresh_client_task_dates(NEW.bcs_account_id);
  END IF;
  RETURN NULL;
END $$;

-- One trigger for all three (replaces 2026-10-07f's Data-Upload-only one).
DROP TRIGGER IF EXISTS tasks_event_data_upload ON public.tasks;
DROP TRIGGER IF EXISTS tasks_event_task_dates ON public.tasks;
CREATE TRIGGER tasks_event_task_dates
  AFTER INSERT OR DELETE
     OR UPDATE OF state_label, actual_end, bcs_task_subtype_label, bcs_account_id
  ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_tasks_event_task_dates();

-- ---- Backfill: re-derive every dashboard event now --------------------------
UPDATE public.events SET launch = launch WHERE origin = 'dashboard';

-- ---- Verify ------------------------------------------------------------------
--   SELECT name, marketing_state_label, last_data_upload, teaser_date, targeting_date,
--          public.event_client_latest_task(client_account_id, 'Marketing Memo') AS memo_lookup,
--          public.event_client_latest_task(client_account_id, 'Targeting')      AS tgt_lookup
--     FROM public.events WHERE origin = 'dashboard' ORDER BY created_on DESC;
--   SELECT count(*) FROM public.event_contacts;   -- 0 until reps are added

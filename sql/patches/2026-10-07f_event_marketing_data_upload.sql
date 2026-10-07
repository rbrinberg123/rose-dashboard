-- ===========================================================================
-- 2026-10-07f_event_marketing_data_upload.sql
--
-- Two more DERIVED fields on dashboard-origin events, set by the same
-- events_compute_stage trigger as the stage (2026-10-07e):
--
--   A. Marketing state (marketing_state_code / _label) — derived from the
--      computed stage, in lockstep with it:
--        stage = 'Live Outreach'  → 755860001 'Marketing'
--        every other stage        → 755860000 'Not Marketing'
--
--   B. Last Data Upload (last_data_upload) — looked up, never typed: the
--      completion time (actual_end) of the client's most recent Completed task
--      with sub-type 'Data Upload' (tasks.bcs_account_id = the event's client).
--      Client-level; the latest wins. NULL when the client has none.
--      Kept fresh by a tasks trigger: any Data Upload task inserted / closed /
--      reopened / re-dated / re-linked / deleted refreshes that client's
--      dashboard events.
--
-- Dynamics-origin events are not touched (event_lifecycle_in_scope).
-- Adds NO columns. Shareholder Report Received is simply no longer on the
-- form; its column and data are kept.
--
-- PREREQUISITE: sql/patches/2026-10-07e_event_lifecycle.sql.
-- Run this ONCE in the Supabase SQL editor. Safe to re-run.
-- See dashboard/content/docs/13-events.md.
-- ===========================================================================

-- ---- B. The lookup -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_client_last_data_upload(p_account uuid)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT MAX(t.actual_end)
    FROM public.tasks t
   WHERE t.bcs_account_id = p_account
     AND t.bcs_task_subtype_label = 'Data Upload'
     AND t.state_label = 'Completed'
$$;

CREATE INDEX IF NOT EXISTS idx_tasks_account_subtype
  ON public.tasks (bcs_account_id, bcs_task_subtype_label);

-- ---- A + B. The events trigger, now setting all three derived fields --------
CREATE OR REPLACE FUNCTION public.trg_events_compute_stage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_stage text;
BEGIN
  IF NOT public.event_lifecycle_in_scope(NEW.origin) THEN RETURN NEW; END IF;
  v_stage := public.event_lifecycle_stage(
    NEW.event_id, NEW.launch, NEW.outreach_complete, NEW.paused, NEW.event_start_actual);
  NEW.event_state_label := v_stage;
  NEW.event_state_code  := public.event_stage_code(v_stage);
  -- Marketing in lockstep with the stage.
  IF v_stage = 'Live Outreach' THEN
    NEW.marketing_state_code  := 755860001;
    NEW.marketing_state_label := 'Marketing';
  ELSE
    NEW.marketing_state_code  := 755860000;
    NEW.marketing_state_label := 'Not Marketing';
  END IF;
  -- Last Data Upload from the client's tasks.
  NEW.last_data_upload := public.event_client_last_data_upload(NEW.client_account_id);
  RETURN NEW;
END $$;

-- The stage-change audit row now records the marketing flip with it.
CREATE OR REPLACE FUNCTION public.trg_events_stage_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.audit_log (action, entity, record_id, changes, context)
  VALUES ('update', 'events', NEW.event_id::text,
          jsonb_build_object(
            'event_state_label',
              jsonb_build_object('from', OLD.event_state_label, 'to', NEW.event_state_label),
            'marketing_state_label',
              jsonb_build_object('from', OLD.marketing_state_label, 'to', NEW.marketing_state_label)),
          'automation:event-lifecycle');
  RETURN NULL;
END $$;

-- ---- B. Data Upload task changes → that client's dashboard events ----------
CREATE OR REPLACE FUNCTION public.event_refresh_client_data_upload(p_account uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_latest timestamptz;
  v_n      integer;
BEGIN
  IF p_account IS NULL THEN RETURN 0; END IF;
  v_latest := public.event_client_last_data_upload(p_account);
  -- The BEFORE trigger re-derives the value itself; the SET just touches the row.
  UPDATE public.events
     SET last_data_upload = v_latest
   WHERE client_account_id = p_account
     AND public.event_lifecycle_in_scope(origin)
     AND last_data_upload IS DISTINCT FROM v_latest;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    INSERT INTO public.audit_log (action, entity, record_id, changes, context)
    VALUES ('update', 'events', p_account::text,
            jsonb_build_object('last_data_upload', v_latest, 'events_updated', v_n),
            'automation:event-last-data-upload');
  END IF;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.trg_tasks_event_data_upload()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.bcs_task_subtype_label = 'Data Upload' THEN
    PERFORM public.event_refresh_client_data_upload(OLD.bcs_account_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.bcs_task_subtype_label = 'Data Upload'
     AND (TG_OP = 'INSERT' OR NEW.bcs_account_id IS DISTINCT FROM OLD.bcs_account_id
          OR OLD.bcs_task_subtype_label IS DISTINCT FROM 'Data Upload') THEN
    PERFORM public.event_refresh_client_data_upload(NEW.bcs_account_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tasks_event_data_upload ON public.tasks;
CREATE TRIGGER tasks_event_data_upload
  AFTER INSERT OR DELETE
     OR UPDATE OF state_label, actual_end, bcs_task_subtype_label, bcs_account_id
  ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_tasks_event_data_upload();

-- ---- Backfill: re-derive all three fields on every dashboard event now ----
-- (A no-op SET; the BEFORE trigger does the work. Stage changes are audited.)
UPDATE public.events SET launch = launch WHERE origin = 'dashboard';

-- ---- Verify ------------------------------------------------------------------
--   SELECT name, event_state_label, marketing_state_label, last_data_upload,
--          public.event_client_last_data_upload(client_account_id) AS lookup
--     FROM public.events WHERE origin = 'dashboard' ORDER BY created_on DESC;
--   -- Marketing only on Live Outreach rows; last_data_upload = lookup.

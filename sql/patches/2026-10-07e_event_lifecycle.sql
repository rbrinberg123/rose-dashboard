-- ===========================================================================
-- 2026-10-07e_event_lifecycle.sql
--
-- COMPUTED EVENT LIFECYCLE (dashboard-origin events only).
--
-- The event stage (events.event_state_code / event_state_label) is no longer
-- picked by a person. For origin = 'dashboard' events it is COMPUTED from the
-- event's three toggles + its own meetings and feedback tasks, and written
-- into the SAME two columns — so every existing filter, view and page that
-- reads event_state_label keeps working unchanged.
--
-- Evaluated top-down; the first match wins:
--
--   Pause               paused                                   (overrides all)
--   Complete            launch & outreach_complete & meetings over & feedback closed
--   Preparing Feedback  launch & outreach_complete & meetings over
--   Meetings Ongoing    launch & outreach_complete & today >= meetings start
--   Schedule Closed     launch & outreach_complete
--   Live Outreach       launch
--   Pre-Launch          otherwise (the default on creation)
--
--   "meetings over"     the event has at least one eligible meeting
--                       (feedback_meeting_is_eligible: not Cancelled, Active)
--                       and EVERY eligible meeting's Eastern date is before
--                       today. Zero eligible meetings = NOT over (the event
--                       stays in Meetings Ongoing). Past-dated Confirmed /
--                       Pending / TBR all count as over.
--   "feedback closed"   the event has at least one Feedback task, no Feedback
--                       or Feedback Report Sent task is still Open, and every
--                       Completed Feedback task has its review task
--                       (review_of_task_id) and that review task is closed.
--   "today"             the Eastern calendar day.
--
-- Recomputed by:
--   * events BEFORE INSERT / UPDATE  — any toggle, date or other edit
--   * meetings AFTER insert/update/delete — the meeting's event(s)
--   * tasks AFTER insert/update/delete    — Feedback / Feedback Report Sent
--   * the daily sweep events_recompute_all_stages(), called by the Vercel
--     cron /api/events/recompute-stages (Meetings Ongoing and "meetings
--     over" depend on the date, not on any write).
--
-- Dynamics-origin events are NEVER touched: they keep the stage Dynamics
-- syncs in. (At cutover, widen event_lifecycle_in_scope.)
--
-- Adds NO columns: events.launch, events.outreach_complete and events.paused
-- already exist (sql/16_events_table.sql).
--
-- PREREQUISITE: sql/patches/2026-10-07b_feedback_report_automation.sql
-- (feedback_meeting_is_eligible, tasks.review_of_task_id).
-- Run this ONCE in the Supabase SQL editor. Safe to re-run.
-- See dashboard/content/docs/13-events.md ("Computed lifecycle").
-- ===========================================================================

-- ---- 0. Scope + label → code ----------------------------------------------
CREATE OR REPLACE FUNCTION public.event_lifecycle_in_scope(p_origin text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_origin = 'dashboard'
$$;

COMMENT ON FUNCTION public.event_lifecycle_in_scope(text) IS
  'CUTOVER SWITCH for the computed event lifecycle. Dashboard-origin events '
  'only today; Dynamics-origin events keep their synced stage.';

-- The Dynamics bcs_eventstate codes (dashboard/lib/events/create.ts).
CREATE OR REPLACE FUNCTION public.event_stage_code(p_label text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_label
    WHEN 'Pre-Launch'         THEN 755860000
    WHEN 'Live Outreach'      THEN 755860001
    WHEN 'Complete'           THEN 755860002
    WHEN 'Schedule Closed'    THEN 755860003
    WHEN 'Meetings Ongoing'   THEN 755860004
    WHEN 'Preparing Feedback' THEN 755860005
    WHEN 'Pause'              THEN 755860006
  END
$$;

-- ---- 1. The rule (pure inputs → label) -----------------------------------
-- Takes the toggles + start as arguments so the events BEFORE trigger can use
-- the NEW row's values; reads meetings / tasks for the rest.
CREATE OR REPLACE FUNCTION public.event_lifecycle_stage(
  p_event    uuid,
  p_launch   boolean,
  p_outreach boolean,
  p_paused   boolean,
  p_start    timestamptz
) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_today         date := (now() AT TIME ZONE 'America/New_York')::date;
  v_meetings_over boolean;
  v_feedback_done boolean;
BEGIN
  IF COALESCE(p_paused, false) THEN RETURN 'Pause'; END IF;
  IF NOT COALESCE(p_launch, false) THEN RETURN 'Pre-Launch'; END IF;
  IF NOT COALESCE(p_outreach, false) THEN RETURN 'Live Outreach'; END IF;

  -- Meetings over: >= 1 eligible meeting, and none dated today / later / undated.
  SELECT COUNT(*) > 0
         AND COUNT(*) FILTER (
               WHERE m.meeting_date IS NULL
                  OR (m.meeting_date AT TIME ZONE 'America/New_York')::date >= v_today
             ) = 0
    INTO v_meetings_over
    FROM public.meetings m
   WHERE m.event_id = p_event
     AND public.feedback_meeting_is_eligible(m.meeting_status_label, m.state_label);

  IF v_meetings_over THEN
    -- Feedback closed: both task types for this event (linked the way
    -- v_feedback_pipeline links them: bcs_event_id, else regarding_id).
    WITH fb AS (
      SELECT t.task_id, t.state_label, t.bcs_task_subtype_label
        FROM public.tasks t
       WHERE COALESCE(t.bcs_event_id, t.regarding_id) = p_event
         AND t.bcs_task_subtype_label IN ('Feedback', 'Feedback Report Sent')
    )
    SELECT EXISTS (SELECT 1 FROM fb WHERE bcs_task_subtype_label = 'Feedback')
           AND NOT EXISTS (SELECT 1 FROM fb WHERE state_label = 'Open')
           AND NOT EXISTS (
             SELECT 1 FROM fb r
              WHERE r.bcs_task_subtype_label = 'Feedback'
                AND r.state_label = 'Completed'
                AND NOT EXISTS (
                  SELECT 1 FROM public.tasks s
                   WHERE s.review_of_task_id = r.task_id
                     AND s.state_label IS DISTINCT FROM 'Open'
                )
           )
      INTO v_feedback_done;

    RETURN CASE WHEN v_feedback_done THEN 'Complete' ELSE 'Preparing Feedback' END;
  END IF;

  IF p_start IS NOT NULL AND (p_start AT TIME ZONE 'America/New_York')::date <= v_today THEN
    RETURN 'Meetings Ongoing';
  END IF;
  RETURN 'Schedule Closed';
END $$;

-- The stage for a stored event (any origin — callers decide whether to apply it).
CREATE OR REPLACE FUNCTION public.event_compute_stage(p_event uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT public.event_lifecycle_stage(e.event_id, e.launch, e.outreach_complete, e.paused, e.event_start_actual)
    FROM public.events e
   WHERE e.event_id = p_event
$$;

-- ---- 2. events: compute on every insert / update (dashboard only) ---------
CREATE OR REPLACE FUNCTION public.trg_events_compute_stage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_stage text;
BEGIN
  IF NOT public.event_lifecycle_in_scope(NEW.origin) THEN RETURN NEW; END IF;
  v_stage := public.event_lifecycle_stage(
    NEW.event_id, NEW.launch, NEW.outreach_complete, NEW.paused, NEW.event_start_actual);
  NEW.event_state_label := v_stage;
  NEW.event_state_code  := public.event_stage_code(v_stage);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS events_compute_stage ON public.events;
CREATE TRIGGER events_compute_stage
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.trg_events_compute_stage();

-- Audit every stage CHANGE on a dashboard event (whatever caused it).
CREATE OR REPLACE FUNCTION public.trg_events_stage_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.audit_log (action, entity, record_id, changes, context)
  VALUES ('update', 'events', NEW.event_id::text,
          jsonb_build_object('event_state_label',
                             jsonb_build_object('from', OLD.event_state_label, 'to', NEW.event_state_label)),
          'automation:event-lifecycle');
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS events_stage_audit ON public.events;
CREATE TRIGGER events_stage_audit
  AFTER UPDATE OF event_state_label ON public.events
  FOR EACH ROW
  WHEN (NEW.origin = 'dashboard' AND OLD.event_state_label IS DISTINCT FROM NEW.event_state_label)
  EXECUTE FUNCTION public.trg_events_stage_audit();

-- ---- 3. Recompute one event (no-op unless the stage actually changes) -----
-- The UPDATE fires events_compute_stage, which sets both columns.
CREATE OR REPLACE FUNCTION public.event_recompute_stage(p_event uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_origin text;
  v_old    text;
  v_new    text;
BEGIN
  IF p_event IS NULL THEN RETURN false; END IF;
  -- Origin first, so a Dynamics meeting / task sync never evaluates the rule.
  SELECT origin, event_state_label INTO v_origin, v_old FROM public.events WHERE event_id = p_event;
  IF NOT FOUND OR NOT public.event_lifecycle_in_scope(v_origin) THEN RETURN false; END IF;
  v_new := public.event_compute_stage(p_event);
  IF v_new IS NOT DISTINCT FROM v_old THEN RETURN false; END IF;
  UPDATE public.events SET event_state_label = v_new WHERE event_id = p_event;
  RETURN true;
END $$;

-- ---- 4. meetings → their event(s) -----------------------------------------
CREATE OR REPLACE FUNCTION public.trg_meetings_event_stage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM public.event_recompute_stage(OLD.event_id); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.event_id IS DISTINCT FROM OLD.event_id) THEN
    PERFORM public.event_recompute_stage(NEW.event_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS meetings_event_stage ON public.meetings;
CREATE TRIGGER meetings_event_stage
  AFTER INSERT OR DELETE OR UPDATE OF event_id, meeting_date, meeting_status_label, state_label
  ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.trg_meetings_event_stage();

-- ---- 5. feedback tasks → their event ---------------------------------------
CREATE OR REPLACE FUNCTION public.trg_tasks_event_stage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.bcs_task_subtype_label IN ('Feedback', 'Feedback Report Sent') THEN
    PERFORM public.event_recompute_stage(COALESCE(OLD.bcs_event_id, OLD.regarding_id));
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.bcs_task_subtype_label IN ('Feedback', 'Feedback Report Sent') THEN
    PERFORM public.event_recompute_stage(COALESCE(NEW.bcs_event_id, NEW.regarding_id));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tasks_event_stage ON public.tasks;
CREATE TRIGGER tasks_event_stage
  AFTER INSERT OR DELETE
     OR UPDATE OF state_label, bcs_task_subtype_label, bcs_event_id, regarding_id, review_of_task_id
  ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_tasks_event_stage();

-- ---- 6. Daily sweep (Vercel cron /api/events/recompute-stages) ------------
-- Active dashboard-origin events only. Returns how many stages changed.
CREATE OR REPLACE FUNCTION public.events_recompute_all_stages()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  r   record;
  v_n integer := 0;
BEGIN
  FOR r IN SELECT event_id FROM public.events
            WHERE public.event_lifecycle_in_scope(origin) AND state_label = 'Active' LOOP
    IF public.event_recompute_stage(r.event_id) THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- ---- 7. Bring existing dashboard events onto the computed stage now -------
SELECT public.events_recompute_all_stages();

-- ---- Verify ------------------------------------------------------------------
--   SELECT event_id, name, launch, outreach_complete, paused, event_state_label,
--          public.event_compute_stage(event_id) AS computed
--     FROM public.events WHERE origin = 'dashboard' ORDER BY created_on DESC;
--   -- every row: event_state_label = computed

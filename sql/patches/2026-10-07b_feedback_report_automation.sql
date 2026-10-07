-- ===========================================================================
-- 2026-10-07b_feedback_report_automation.sql
--
-- Feedback-report AUTOMATIONS (dashboard-origin events only, cutover switch):
--
--   A. Event created            → auto-create Feedback report #1 (unclaimed,
--                                  Open, no feedback received), map the
--                                  event's meetings to it.
--   B. Meeting added / moved /  → keep the report ↔ meeting mapping and every
--      re-dated / cancelled /       report's due date (= last meeting date +
--      reinstated / deleted         10 days, Eastern) correct. New meetings
--                                   route to the event's LATEST report.
--   C. Feedback report closed   → auto-create its review task
--                                  "Feedback Report Pending Review – <event>"
--                                  (sub-type Feedback Report Sent), linked to
--                                  that exact report, due close date + 2 days.
--   D. v_feedback_pipeline      → dashboard reports pair with their review task
--                                  by that explicit link (Dynamics rows keep the
--                                  created-date heuristic, unchanged); per-report
--                                  meeting stats once a report has a mapping.
--   E. RPCs for Split (add report, reassign meetings, delete report).
--
-- THE CUTOVER SWITCH: feedback_automation_includes_dynamics() returns false.
-- Every automation here asks feedback_automation_in_scope(origin), so today
-- only origin = 'dashboard' records are touched. At cutover, change the one
-- function to return true. (The claim feature's switch is separate, in
-- dashboard/lib/feedback-claims/policy.ts.)
--
-- PREREQUISITE: sql/patches/2026-10-07_feedback_claims.sql (claim columns).
-- Run this ONCE in the Supabase SQL editor, after that one. Safe to re-run.
-- See dashboard/content/docs/27-feedback-reports.md.
-- ===========================================================================

-- ---- 0. Switch + small helpers ----------------------------------------------
CREATE OR REPLACE FUNCTION public.feedback_automation_includes_dynamics()
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;

COMMENT ON FUNCTION public.feedback_automation_includes_dynamics() IS
  'CUTOVER SWITCH for the feedback-report automations. false = dashboard-origin '
  'records only. Change to true at cutover to include Dynamics-origin records.';

CREATE OR REPLACE FUNCTION public.feedback_automation_in_scope(p_origin text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_origin = 'dashboard'
      OR (p_origin = 'dynamics' AND public.feedback_automation_includes_dynamics())
$$;

-- A meeting counts toward a report unless it is Cancelled or deactivated.
CREATE OR REPLACE FUNCTION public.feedback_meeting_is_eligible(p_status text, p_state text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status IS DISTINCT FROM 'Cancelled' AND COALESCE(p_state, 'Active') = 'Active'
$$;

-- A calendar day as Eastern midnight — how the app stores a task's Due date.
CREATE OR REPLACE FUNCTION public.feedback_eastern_midnight(d date)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT (d::timestamp AT TIME ZONE 'America/New_York')
$$;

-- ---- 1. Data model ------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS feedback_report_seq smallint,   -- 1/2/3 = report A/B/C of its event
  ADD COLUMN IF NOT EXISTS review_of_task_id   uuid;       -- review task → the report it reviews

COMMENT ON COLUMN public.tasks.feedback_report_seq IS
  'DASHBOARD-OWNED. Set on Feedback REPORT tasks created by the event automation / '
  'Split: 1, 2, 3 = report A, B, C of the task''s event (bcs_event_id). Null on every other task.';
COMMENT ON COLUMN public.tasks.review_of_task_id IS
  'DASHBOARD-OWNED. On an auto-created "Feedback Report Pending Review" task: the '
  'Feedback report it reviews. v_feedback_pipeline pairs by this link.';

-- One report per (event, seq); one review task per report.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_feedback_report_seq
  ON public.tasks (bcs_event_id, feedback_report_seq) WHERE feedback_report_seq IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_review_of_task
  ON public.tasks (review_of_task_id) WHERE review_of_task_id IS NOT NULL;

-- Report ↔ meeting. meeting_id is the PK: a meeting sits in at most ONE report.
CREATE TABLE IF NOT EXISTS public.feedback_report_meetings (
  meeting_id      uuid PRIMARY KEY REFERENCES public.meetings (meeting_id) ON DELETE CASCADE,
  report_task_id  uuid NOT NULL REFERENCES public.tasks (task_id) ON DELETE CASCADE,
  event_id        uuid NOT NULL,
  -- true = placed by the automation after the event was split; cleared when a
  -- person saves the assignment (the "please re-check" marker).
  auto_routed     boolean NOT NULL DEFAULT false,
  assigned_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feedback_report_meetings_report ON public.feedback_report_meetings (report_task_id);
CREATE INDEX IF NOT EXISTS idx_feedback_report_meetings_event  ON public.feedback_report_meetings (event_id);

ALTER TABLE public.feedback_report_meetings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_report_meetings TO service_role;

-- ---- 2. Report maths -------------------------------------------------------------
-- Due = last eligible meeting's day + 10 (meeting_date is a "+00 wall clock",
-- so its UTC date IS the business day). Null with no dated meeting. Only an
-- Open report is touched — a closed report keeps its history.
CREATE OR REPLACE FUNCTION public.feedback_report_recompute_due(p_report uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_last date;
  v_due  timestamptz;
BEGIN
  SELECT max((m.meeting_date AT TIME ZONE 'UTC')::date) INTO v_last
  FROM public.feedback_report_meetings frm
  JOIN public.meetings m ON m.meeting_id = frm.meeting_id
  WHERE frm.report_task_id = p_report
    AND m.meeting_date IS NOT NULL
    AND public.feedback_meeting_is_eligible(m.meeting_status_label, m.state_label);

  v_due := CASE WHEN v_last IS NULL THEN NULL ELSE public.feedback_eastern_midnight(v_last + 10) END;

  UPDATE public.tasks
     SET scheduled_end = v_due, modified_on = now()
   WHERE task_id = p_report
     AND state_label = 'Open'
     AND scheduled_end IS DISTINCT FROM v_due;
END $$;

CREATE OR REPLACE FUNCTION public.feedback_event_recompute_due(p_event uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT task_id FROM public.tasks
            WHERE bcs_event_id = p_event AND feedback_report_seq IS NOT NULL LOOP
    PERFORM public.feedback_report_recompute_due(r.task_id);
  END LOOP;
END $$;

-- The report new meetings route to: highest sequence, preferring an Open one.
CREATE OR REPLACE FUNCTION public.feedback_event_latest_report(p_event uuid)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT task_id FROM public.tasks
   WHERE bcs_event_id = p_event AND feedback_report_seq IS NOT NULL
   ORDER BY (state_label = 'Open') DESC, feedback_report_seq DESC
   LIMIT 1
$$;

-- Create one Feedback report task for an event (the auto-create AND Split).
-- Max 3 per event; takes the lowest free sequence. Writes its own audit row.
CREATE OR REPLACE FUNCTION public.feedback_report_create(p_event uuid, p_context text DEFAULT 'automation')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  e      public.events%ROWTYPE;
  v_seq  int;
  v_id   uuid := gen_random_uuid();
  v_subj text;
BEGIN
  SELECT * INTO e FROM public.events WHERE event_id = p_event;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event % not found', p_event; END IF;
  IF NOT public.feedback_automation_in_scope(e.origin) THEN
    RAISE EXCEPTION 'Event % is not in scope for feedback automation (origin %)', p_event, e.origin;
  END IF;

  -- Serialise report creation per event (two splits at once cannot both take seq 2).
  PERFORM pg_advisory_xact_lock(hashtext('feedback_report:' || p_event::text));

  SELECT s INTO v_seq FROM generate_series(1, 3) s
   WHERE s NOT IN (SELECT feedback_report_seq FROM public.tasks
                    WHERE bcs_event_id = p_event AND feedback_report_seq IS NOT NULL)
   ORDER BY s LIMIT 1;
  IF v_seq IS NULL THEN RAISE EXCEPTION 'This event already has 3 feedback reports.'; END IF;

  v_subj := 'Feedback Report' || CASE WHEN v_seq > 1 THEN ' ' || chr(64 + v_seq) ELSE '' END
            || ' – ' || COALESCE(e.name, '(Unnamed event)');

  INSERT INTO public.tasks (
    task_id, origin, is_test, _raw, activity_type_code, priority_code, priority_label, subject,
    bcs_task_type_code, bcs_task_type_label, bcs_task_subtype_code, bcs_task_subtype_label,
    state_code, state_label, status_code, status_label,
    bcs_account_id, bcs_account_name, bcs_event_id, bcs_event_name,
    regarding_id, regarding_name, regarding_type,
    feedback_report_seq, created_by_name, modified_by_name, created_on, modified_on
  ) VALUES (
    v_id, 'dashboard', COALESCE(e.is_test, false), '{}'::jsonb, 'task', 1, 'Normal', v_subj,
    755860003, 'Outreach', 755860017, 'Feedback',
    0, 'Open', 2, 'Not Started',
    e.client_account_id, e.client_account_name, e.event_id, e.name,
    e.event_id, e.name, 'bcs_event',
    v_seq, 'System (automation)', 'System (automation)', now(), now()
  );

  INSERT INTO public.audit_log (action, entity, record_id, changes, context)
  VALUES ('create', 'tasks', v_id::text,
          jsonb_build_object('subject', v_subj, 'bcs_event_id', p_event, 'feedback_report_seq', v_seq,
                             'bcs_task_subtype_label', 'Feedback', 'state_label', 'Open'),
          'automation:feedback-report:' || p_context);
  RETURN v_id;
END $$;

-- ---- 3. Automation A — event created → report #1 --------------------------
CREATE OR REPLACE FUNCTION public.trg_events_auto_feedback_report()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_report uuid;
BEGIN
  IF NOT public.feedback_automation_in_scope(NEW.origin) THEN RETURN NULL; END IF;
  -- Idempotent: never a second auto-created report for the same event.
  IF EXISTS (SELECT 1 FROM public.tasks
              WHERE bcs_event_id = NEW.event_id AND feedback_report_seq IS NOT NULL) THEN
    RETURN NULL;
  END IF;

  v_report := public.feedback_report_create(NEW.event_id, 'event-created');

  INSERT INTO public.feedback_report_meetings (meeting_id, report_task_id, event_id)
  SELECT m.meeting_id, v_report, NEW.event_id
    FROM public.meetings m
   WHERE m.event_id = NEW.event_id
     AND public.feedback_meeting_is_eligible(m.meeting_status_label, m.state_label)
  ON CONFLICT (meeting_id) DO NOTHING;

  PERFORM public.feedback_report_recompute_due(v_report);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS events_auto_feedback_report ON public.events;
CREATE TRIGGER events_auto_feedback_report
  AFTER INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.trg_events_auto_feedback_report();

-- ---- 4. Automation B — meeting changes → routing + due dates ----------------
CREATE OR REPLACE FUNCTION public.trg_meetings_feedback_routing()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_eligible   boolean;
  v_current    uuid;
  v_map_event  uuid;
  v_report     uuid;
  v_reports    int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- The mapping row is already gone (FK cascade); recompute the event's reports.
    IF OLD.event_id IS NOT NULL THEN PERFORM public.feedback_event_recompute_due(OLD.event_id); END IF;
    RETURN NULL;
  END IF;

  -- Cheap exit for the sync: out-of-scope meetings never reach a report.
  IF NOT public.feedback_automation_in_scope(NEW.origin) THEN RETURN NULL; END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.event_id             IS NOT DISTINCT FROM OLD.event_id
     AND NEW.meeting_date         IS NOT DISTINCT FROM OLD.meeting_date
     AND NEW.meeting_status_label IS NOT DISTINCT FROM OLD.meeting_status_label
     AND NEW.state_label          IS NOT DISTINCT FROM OLD.state_label THEN
    RETURN NULL;
  END IF;

  v_eligible := public.feedback_meeting_is_eligible(NEW.meeting_status_label, NEW.state_label);
  SELECT report_task_id, event_id INTO v_current, v_map_event
    FROM public.feedback_report_meetings WHERE meeting_id = NEW.meeting_id;

  -- Cancelled / deactivated, or moved to another event → off its report.
  IF v_current IS NOT NULL AND (NOT v_eligible OR NEW.event_id IS DISTINCT FROM v_map_event) THEN
    DELETE FROM public.feedback_report_meetings WHERE meeting_id = NEW.meeting_id;
    PERFORM public.feedback_report_recompute_due(v_current);
    v_current := NULL;
  END IF;

  -- New / reinstated / moved-in and eligible → the event's LATEST report.
  IF v_eligible AND v_current IS NULL AND NEW.event_id IS NOT NULL THEN
    v_report := public.feedback_event_latest_report(NEW.event_id);
    IF v_report IS NOT NULL THEN
      SELECT count(*) INTO v_reports FROM public.tasks
       WHERE bcs_event_id = NEW.event_id AND feedback_report_seq IS NOT NULL;
      INSERT INTO public.feedback_report_meetings (meeting_id, report_task_id, event_id, auto_routed)
      VALUES (NEW.meeting_id, v_report, NEW.event_id, v_reports > 1)
      ON CONFLICT (meeting_id) DO NOTHING;
      v_current := v_report;
    END IF;
  END IF;

  -- A re-dated meeting moves its report's due date.
  IF v_current IS NOT NULL THEN PERFORM public.feedback_report_recompute_due(v_current); END IF;
  RETURN NULL;
END $$;

-- Lower-case name: fires AFTER the FK cascade triggers (RI_…) on delete.
DROP TRIGGER IF EXISTS meetings_feedback_routing ON public.meetings;
CREATE TRIGGER meetings_feedback_routing
  AFTER INSERT OR UPDATE OR DELETE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.trg_meetings_feedback_routing();

-- ---- 5. Automation C — report closed → review task -------------------------
CREATE OR REPLACE FUNCTION public.trg_tasks_feedback_close_review()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_id     uuid := gen_random_uuid();
  v_closed date;
  v_name   text;
  v_subj   text;
BEGIN
  IF NOT public.feedback_automation_in_scope(NEW.origin) THEN RETURN NULL; END IF;
  -- Idempotent: one review task per report, ever (re-close does nothing).
  IF EXISTS (SELECT 1 FROM public.tasks WHERE review_of_task_id = NEW.task_id) THEN RETURN NULL; END IF;

  v_closed := (COALESCE(NEW.actual_end, now()) AT TIME ZONE 'America/New_York')::date;
  v_name   := COALESCE(NEW.bcs_event_name, NEW.regarding_name, '(Unnamed event)');
  v_subj   := 'Feedback Report Pending Review – ' || v_name;

  INSERT INTO public.tasks (
    task_id, origin, is_test, _raw, activity_type_code, priority_code, priority_label, subject,
    bcs_task_type_code, bcs_task_type_label, bcs_task_subtype_code, bcs_task_subtype_label,
    state_code, state_label, status_code, status_label, scheduled_end,
    bcs_account_id, bcs_account_name, bcs_event_id, bcs_event_name,
    regarding_id, regarding_name, regarding_type,
    review_of_task_id, created_by_name, modified_by_name, created_on, modified_on
  ) VALUES (
    v_id, 'dashboard', COALESCE(NEW.is_test, false), '{}'::jsonb, 'task', 1, 'Normal', v_subj,
    755860003, 'Outreach', 755860028, 'Feedback Report Sent',
    0, 'Open', 2, 'Not Started', public.feedback_eastern_midnight(v_closed + 2),
    NEW.bcs_account_id, NEW.bcs_account_name, NEW.bcs_event_id, NEW.bcs_event_name,
    COALESCE(NEW.regarding_id, NEW.bcs_event_id), COALESCE(NEW.regarding_name, NEW.bcs_event_name),
    COALESCE(NEW.regarding_type, 'bcs_event'),
    NEW.task_id, 'System (automation)', 'System (automation)', now(), now()
  )
  ON CONFLICT DO NOTHING;

  IF FOUND THEN
    INSERT INTO public.audit_log (action, entity, record_id, changes, context)
    VALUES ('create', 'tasks', v_id::text,
            jsonb_build_object('subject', v_subj, 'review_of_task_id', NEW.task_id,
                               'bcs_task_subtype_label', 'Feedback Report Sent'),
            'automation:feedback-report:closed');
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tasks_feedback_close_review ON public.tasks;
CREATE TRIGGER tasks_feedback_close_review
  AFTER UPDATE OF state_label ON public.tasks
  FOR EACH ROW
  WHEN (NEW.bcs_task_subtype_label = 'Feedback'
        AND NEW.state_label = 'Completed'
        AND OLD.state_label IS DISTINCT FROM 'Completed')
  EXECUTE FUNCTION public.trg_tasks_feedback_close_review();

-- ---- 6. Split RPCs (called by the app after its own permission checks) ------
-- Add a report (no meetings yet; the app's assignment step moves some across).
CREATE OR REPLACE FUNCTION public.feedback_report_add(p_event uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  RETURN public.feedback_report_create(p_event, 'split');
END $$;

-- Replace the event's whole assignment. p_assignments = {"<meeting_id>": "<report_task_id>", …}
-- Every eligible meeting of the event must appear exactly once, on one of the
-- event's own reports; ineligible meetings may not be assigned.
CREATE OR REPLACE FUNCTION public.feedback_report_set_assignments(p_event uuid, p_assignments jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_missing int;
  v_bad     int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('feedback_report:' || p_event::text));

  SELECT count(*) INTO v_missing
    FROM public.meetings m
   WHERE m.event_id = p_event
     AND public.feedback_meeting_is_eligible(m.meeting_status_label, m.state_label)
     AND NOT (p_assignments ? m.meeting_id::text);
  IF v_missing > 0 THEN RAISE EXCEPTION 'Every meeting must be assigned to a report (% unassigned).', v_missing; END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_each_text(p_assignments) a
    LEFT JOIN public.meetings m ON m.meeting_id = a.key::uuid
    LEFT JOIN public.tasks t    ON t.task_id    = a.value::uuid
   WHERE m.meeting_id IS NULL OR m.event_id IS DISTINCT FROM p_event
      OR NOT public.feedback_meeting_is_eligible(m.meeting_status_label, m.state_label)
      OR t.task_id IS NULL OR t.bcs_event_id IS DISTINCT FROM p_event OR t.feedback_report_seq IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'The assignment includes % meeting(s) or report(s) that do not belong to this event.', v_bad; END IF;

  DELETE FROM public.feedback_report_meetings WHERE event_id = p_event;
  INSERT INTO public.feedback_report_meetings (meeting_id, report_task_id, event_id, auto_routed)
  SELECT a.key::uuid, a.value::uuid, p_event, false FROM jsonb_each_text(p_assignments) a;

  PERFORM public.feedback_event_recompute_due(p_event);
END $$;

-- Delete an UNCLAIMED, Open report; its meetings move to another report of the
-- same event (lowest sequence, Open first). The last report cannot go.
CREATE OR REPLACE FUNCTION public.feedback_report_delete(p_report uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  r        public.tasks%ROWTYPE;
  v_target uuid;
BEGIN
  SELECT * INTO r FROM public.tasks WHERE task_id = p_report AND feedback_report_seq IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That feedback report no longer exists.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('feedback_report:' || r.bcs_event_id::text));
  IF r.claimed_by_id IS NOT NULL OR r.bcs_claimed_by_id IS NOT NULL THEN
    RAISE EXCEPTION 'This report is claimed — release it before deleting.';
  END IF;
  IF r.state_label IS DISTINCT FROM 'Open' THEN RAISE EXCEPTION 'Only an open report can be deleted.'; END IF;

  SELECT task_id INTO v_target FROM public.tasks
   WHERE bcs_event_id = r.bcs_event_id AND feedback_report_seq IS NOT NULL AND task_id <> p_report
   ORDER BY (state_label = 'Open') DESC, feedback_report_seq ASC LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'An event must keep at least one feedback report.'; END IF;

  UPDATE public.feedback_report_meetings SET report_task_id = v_target, auto_routed = false
   WHERE report_task_id = p_report;
  DELETE FROM public.tasks WHERE task_id = p_report;
  PERFORM public.feedback_report_recompute_due(v_target);
  RETURN v_target;
END $$;

-- Only the app (service_role) may call these; never anon / signed-in clients.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'feedback_report_recompute_due(uuid)', 'feedback_event_recompute_due(uuid)',
    'feedback_report_create(uuid, text)', 'feedback_report_add(uuid)',
    'feedback_report_set_assignments(uuid, jsonb)', 'feedback_report_delete(uuid)',
    'trg_events_auto_feedback_report()', 'trg_meetings_feedback_routing()',
    'trg_tasks_feedback_close_review()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- ---- 7. v_feedback_pipeline — explicit pairing + per-report meeting stats ---
-- CREATE OR REPLACE with the SAME 20 columns in the SAME order and types, so
-- v_client_todo and every other reader is unaffected. Two changes only:
--   * pairs: a review task with review_of_task_id pairs with exactly that
--     report; the mutual-nearest created-date heuristic runs ONLY over tasks not
--     in an explicit pair (every Dynamics row — so Dynamics is unchanged).
--   * meeting_start / meeting_end / meeting_count: a report with a meeting
--     mapping counts ITS meetings (Confirmed); otherwise the event's, as before.
CREATE OR REPLACE VIEW public.v_feedback_pipeline AS
WITH tk AS (
  SELECT
    t.*,
    COALESCE(t.bcs_event_id, t.regarding_id) AS event_key
  FROM public.tasks t
  WHERE t.bcs_task_subtype_label IN ('Feedback', 'Feedback Report Sent')
),
fb AS (SELECT * FROM tk WHERE bcs_task_subtype_label = 'Feedback'),
rs AS (SELECT * FROM tk WHERE bcs_task_subtype_label = 'Feedback Report Sent'),
linked AS (
  -- EXPLICIT pairs (dashboard automation): review task → the report it reviews.
  SELECT r.review_of_task_id AS fb_id, r.task_id AS rs_id, r.event_key
  FROM rs r
  JOIN fb f ON f.task_id = r.review_of_task_id
),
fb_h AS (SELECT * FROM fb WHERE task_id NOT IN (SELECT fb_id FROM linked)),
rs_h AS (SELECT * FROM rs WHERE review_of_task_id IS NULL),
cand AS (
  SELECT
    f.task_id                                                   AS fb_id,
    r.task_id                                                   AS rs_id,
    f.event_key,
    ABS(EXTRACT(EPOCH FROM (f.created_on - r.created_on)))       AS dist
  FROM fb_h f
  JOIN rs_h r ON r.event_key = f.event_key
),
cand_ranked AS (
  SELECT
    cand.*,
    ROW_NUMBER() OVER (PARTITION BY fb_id ORDER BY dist ASC NULLS LAST, rs_id) AS rn_from_fb,
    ROW_NUMBER() OVER (PARTITION BY rs_id ORDER BY dist ASC NULLS LAST, fb_id) AS rn_from_rs
  FROM cand
),
pairs AS (
  SELECT fb_id, rs_id, event_key
  FROM cand_ranked
  WHERE rn_from_fb = 1 AND rn_from_rs = 1
  UNION ALL
  SELECT fb_id, rs_id, event_key FROM linked
),
mtg AS (
  SELECT
    m.event_id,
    min(m.meeting_date)   AS meeting_start,
    max(m.meeting_date)   AS meeting_end,
    count(*)::int         AS meeting_count
  FROM public.meetings m
  WHERE m.event_id IS NOT NULL
    AND m.meeting_status_label = 'Confirmed'
  GROUP BY m.event_id
),
rep_has_map AS (
  SELECT DISTINCT report_task_id FROM public.feedback_report_meetings
),
mtg_rep AS (
  SELECT
    frm.report_task_id,
    min(m.meeting_date)   AS meeting_start,
    max(m.meeting_date)   AS meeting_end,
    count(*)::int         AS meeting_count
  FROM public.feedback_report_meetings frm
  JOIN public.meetings m ON m.meeting_id = frm.meeting_id
  WHERE m.meeting_status_label = 'Confirmed'
  GROUP BY frm.report_task_id
),
in_progress AS (
  SELECT
    'in_progress'::text                         AS category,
    f.task_id,
    f.event_key                                 AS event_id,
    COALESCE(f.bcs_event_name, f.subject, '(Unnamed event)') AS event_name,
    f.bcs_account_id                            AS client_account_id,
    f.bcs_account_name                          AS client_account_name,
    f.crdfa_feedback_received_date              AS received_date,
    f.scheduled_end                             AS due_date,
    NULL::timestamptz                           AS fb_closed_date,
    (f.bcs_claimed_by_id IS NOT NULL)           AS claimed,
    f.bcs_claimed_by_id                         AS claimed_by_id,
    f.bcs_claimed_by_name                       AS claimed_by_name,
    (CURRENT_DATE - (f.crdfa_feedback_received_date AT TIME ZONE 'UTC')::date) AS days_in_stage
  FROM fb f
  WHERE f.state_label = 'Open'
    AND f.crdfa_feedback_received_date IS NOT NULL
),
pending_review AS (
  SELECT
    'pending_review'::text                      AS category,
    f.task_id,
    f.event_key                                 AS event_id,
    COALESCE(f.bcs_event_name, f.subject, '(Unnamed event)') AS event_name,
    f.bcs_account_id                            AS client_account_id,
    f.bcs_account_name                          AS client_account_name,
    NULL::timestamptz                           AS received_date,
    r.scheduled_end                             AS due_date,
    f.actual_end                                AS fb_closed_date,
    (f.bcs_claimed_by_id IS NOT NULL)           AS claimed,
    f.bcs_claimed_by_id                         AS claimed_by_id,
    f.bcs_claimed_by_name                       AS claimed_by_name,
    (CURRENT_DATE - (f.actual_end AT TIME ZONE 'UTC')::date) AS days_in_stage
  FROM pairs p
  JOIN fb f ON f.task_id = p.fb_id AND f.state_label = 'Completed'
  JOIN rs r ON r.task_id = p.rs_id AND r.state_label = 'Open'
),
combined AS (
  SELECT * FROM in_progress
  UNION ALL
  SELECT * FROM pending_review
)
SELECT
  c.category,
  c.task_id,
  c.event_id,
  c.event_name,
  c.client_account_id,
  c.client_account_name,
  a.ticker_symbol                               AS client_ticker,   -- position-locked (7th)
  a.sales_lead_primary_name                     AS account_manager_name,
  CASE WHEN hm.report_task_id IS NOT NULL THEN mr.meeting_start ELSE mt.meeting_start END AS meeting_start,
  CASE WHEN hm.report_task_id IS NOT NULL THEN mr.meeting_end   ELSE mt.meeting_end   END AS meeting_end,
  COALESCE(CASE WHEN hm.report_task_id IS NOT NULL THEN mr.meeting_count ELSE mt.meeting_count END, 0) AS meeting_count,
  c.received_date,
  c.due_date,
  c.fb_closed_date,
  c.claimed,
  c.claimed_by_id,
  c.claimed_by_name,
  c.days_in_stage
FROM combined c
LEFT JOIN public.accounts a ON a.account_id      = c.client_account_id
LEFT JOIN mtg mt            ON mt.event_id        = c.event_id
LEFT JOIN rep_has_map hm    ON hm.report_task_id  = c.task_id
LEFT JOIN mtg_rep mr        ON mr.report_task_id  = c.task_id
ORDER BY c.category, c.days_in_stage DESC NULLS LAST, c.client_account_name;

-- ---- 8. Check after running ----------------------------------------------------
-- Expect 0: no Dynamics task appears in an explicit pair, and the view still has
-- the same row count it had before for Dynamics rows.
--   SELECT count(*) FROM public.tasks WHERE origin = 'dynamics' AND review_of_task_id IS NOT NULL;
--   SELECT category, count(*) FROM public.v_feedback_pipeline GROUP BY 1;
--   SELECT count(*) FROM public.v_client_todo;   -- dependent view still reads

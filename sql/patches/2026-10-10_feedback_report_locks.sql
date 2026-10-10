-- =============================================================================
-- Patch: feedback report LOCKS — new meetings never auto-route into a claimed
--        (hard-locked) report
-- Date:  2026-10-10
--
-- WHY
--   A Feedback report that has been CLAIMED (tasks.claimed_by_id, or the legacy
--   bcs_claimed_by_id mirror) or is no longer Open is HARD-LOCKED: someone is
--   writing it, so its meeting set must not change under them. The app enforces
--   this on every manual move / add / delete (app/events/feedback-report-actions.ts,
--   rules in lib/feedback-reports/policy.ts). The one path the app does not
--   control is AUTO-ROUTING: trg_meetings_feedback_routing sends a new /
--   reinstated / moved-in meeting to feedback_event_latest_report(), which picks
--   the highest Open report with no regard for claims.
--
-- WHAT CHANGES
--   1. feedback_event_route_target(event) — the routing target:
--        a. the newest report that is Open AND unclaimed, preferring one whose
--           feedback is not yet in (no Feedback Received Date — a "warm" report
--           still accepts meetings, but an untouched one is the better home);
--        b. if every report is hard-locked and the event has fewer than 3, a NEW
--           split is created (feedback_report_create, the existing max-3 logic)
--           and the meeting goes there;
--        c. otherwise NULL: the meeting stays unassigned ("Not in a report" in
--           the Meetings & Reports panel) for a person to place. It is NEVER
--           added to a hard-locked report automatically.
--      An event with NO reports (created before the automation) is unchanged:
--      no report, no routing.
--   2. trg_meetings_feedback_routing restated VERBATIM from
--      sql/patches/2026-10-07b_feedback_report_automation.sql except the one
--      call: feedback_event_latest_report(...) → feedback_event_route_target(...).
--   feedback_event_latest_report is left in place (nothing else calls it).
--
-- No table or data changes; existing assignments are untouched. Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.feedback_event_route_target(p_event uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_report  uuid;
  v_reports int;
BEGIN
  SELECT task_id INTO v_report FROM public.tasks
   WHERE bcs_event_id = p_event AND feedback_report_seq IS NOT NULL
     AND state_label = 'Open'
     AND claimed_by_id IS NULL AND bcs_claimed_by_id IS NULL
   ORDER BY (crdfa_feedback_received_date IS NULL) DESC, feedback_report_seq DESC
   LIMIT 1;
  IF v_report IS NOT NULL THEN RETURN v_report; END IF;

  SELECT count(*) INTO v_reports FROM public.tasks
   WHERE bcs_event_id = p_event AND feedback_report_seq IS NOT NULL;
  -- Every report is locked: spawn the next split if the max-3 rule allows.
  IF v_reports BETWEEN 1 AND 2 THEN
    RETURN public.feedback_report_create(p_event, 'auto-split-locked');
  END IF;
  RETURN NULL;  -- leave it unassigned; never route into a locked report
END $$;

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

  -- New / reinstated / moved-in and eligible → the event's open, UNLOCKED report
  -- (2026-10-10: never a claimed one — see feedback_event_route_target).
  IF v_eligible AND v_current IS NULL AND NEW.event_id IS NOT NULL THEN
    v_report := public.feedback_event_route_target(NEW.event_id);
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

-- Only the app (service_role) / the trigger may call these.
REVOKE ALL ON FUNCTION public.feedback_event_route_target(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feedback_event_route_target(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.trg_meetings_feedback_routing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_meetings_feedback_routing() TO service_role;


-- ---- CHECK IT (run by hand after the patch) ---------------------------------
-- Reports per event with their lock state (claimed / received / open):
--
-- SELECT bcs_event_id, feedback_report_seq, state_label,
--        (claimed_by_id IS NOT NULL OR bcs_claimed_by_id IS NOT NULL) AS claimed,
--        crdfa_feedback_received_date IS NOT NULL AS received
--   FROM public.tasks WHERE feedback_report_seq IS NOT NULL
--  ORDER BY bcs_event_id, feedback_report_seq;
--
-- Where a new meeting on <event> would go (NULL = stays unassigned):
-- SELECT public.feedback_event_route_target('<event uuid>');   -- note: may create a split

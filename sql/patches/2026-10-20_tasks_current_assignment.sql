-- ===========================================================================
-- 2026-10-20_tasks_current_assignment.sql
--
-- ACTIONS ROW SCOPING (Tasks / Touchpoints / Notes). A task is visible to its
-- owner, its creator OR its CURRENT ASSIGNMENT (see
-- dashboard/lib/access/actions-scope-policy.ts). public.tasks has
-- bcs_current_assignment_id, but v_admin_tasks_all only exposed the NAME, so the
-- predicate could not match on it.
--
-- This appends ONE column, current_assignment_id, to the END of
-- v_admin_tasks_all. Everything above it is the 2026-09-11 definition verbatim
-- (checked against the LIVE view's column list on 2026-10-20: identical, 39
-- columns, same order). CREATE OR REPLACE VIEW can only ADD columns at the end;
-- if the live view has since drifted, this errors and changes nothing.
--
-- Until it is run, the app simply leaves the assignment check out — a task's
-- assignee who is neither owner, creator nor on the core team doesn't see it
-- yet (fewer rows, never more).
--
-- Run ONCE in the Supabase SQL editor. Safe to re-run.
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_admin_tasks_all AS
SELECT
  t.task_id,

  -- ---- identity ----
  NULLIF(btrim(t.subject), '')                        AS subject,
  NULLIF(btrim(t.description), '')                    AS description,

  -- ---- classification ----
  t.bcs_task_type_label                               AS task_type_label,
  t.bcs_task_subtype_label                            AS task_subtype_label,
  -- See PRIORITY note in the header: Rose field first, stock field as fallback.
  COALESCE(NULLIF(btrim(t.bcs_task_priority_label), ''), t.priority_label)
                                                      AS priority_label,
  t.priority_label                                    AS priority_stock_label,
  t.bcs_task_priority_label                           AS priority_rose_label,

  -- ---- state ----
  t.state_label,
  t.status_label,
  t.percent_complete,

  -- ---- dates ----
  t.scheduled_end                                     AS due_date,
  t.scheduled_start,
  t.actual_start,
  t.actual_end,

  -- ---- regarding ----
  t.regarding_name,
  t.regarding_type,
  CASE t.regarding_type
    WHEN 'bcs_event'   THEN 'Event'
    WHEN 'account'     THEN 'Client'
    WHEN 'bcs_project' THEN 'Project'
    WHEN 'contact'     THEN 'Contact'
    ELSE NULLIF(initcap(replace(COALESCE(t.regarding_type, ''), '_', ' ')), '')
  END                                                 AS regarding_type_label,

  -- ---- links ----
  t.bcs_account_id                                    AS client_account_id,
  t.bcs_account_name                                  AS client_account_name,
  a.ticker_symbol                                     AS client_ticker,
  t.bcs_event_id                                      AS event_id,
  t.bcs_event_name                                    AS event_name,

  -- ---- people ----
  t.owner_id,
  t.owner_name,
  t.created_by_name,
  t.modified_by_name,
  t.bcs_claimed_by_name                               AS claimed_by_name,
  t.bcs_current_assignment_name                       AS current_assignment_name,

  -- ---- workflow ----
  t.bcs_outreach_task_status_label                    AS outreach_status_label,
  t.bcs_drafting                                      AS drafting,
  t.bcs_draft_complete                                AS draft_complete,
  t.bcs_review_complete                               AS review_complete,
  t.bcs_processed                                     AS processed,
  t.bcs_feedback_received                             AS feedback_received,
  t.bcs_notified                                      AS notified,

  -- ---- system ----
  t.created_by_id,
  t.created_on,
  t.modified_on,

  -- ---- added 2026-10-20 (row scoping) ----
  t.bcs_current_assignment_id                         AS current_assignment_id
FROM public.tasks t
LEFT JOIN public.accounts a ON a.account_id = t.bcs_account_id;

GRANT SELECT ON public.v_admin_tasks_all TO service_role;

-- Verify:
--   SELECT count(*) FROM public.v_admin_tasks_all;                          -- unchanged
--   SELECT count(*) FROM public.v_admin_tasks_all WHERE current_assignment_id IS NOT NULL;

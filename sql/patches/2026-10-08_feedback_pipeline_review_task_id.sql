-- =============================================================================
-- 2026-10-08 — v_feedback_pipeline: add trailing column review_task_id
--
-- WHY. A Pending Review row is one row per FEEDBACK task, and task_id is that
-- Feedback task's id. The paired open "Feedback Report Sent" task (the one the
-- account team actually has to act on) was matched inside the view but never
-- returned, so My Dashboard's "Reports · Pending Review" card and the Feedback
-- Reports page's "open task" button opened the Feedback task instead. The app's
-- old fallback (tasks.review_of_task_id) only exists on dashboard-created
-- reports, so every Dynamics-paired report (e.g. KALU-US, BDC-US, EDV-CA,
-- NXE-CA) opened the wrong task.
--
-- WHAT. The view body is IDENTICAL to sql/patches/2026-10-07b (section 7) —
-- same CTEs, same 18 columns in the same order and types — plus ONE new
-- trailing column:
--   review_task_id uuid — pending_review rows: the paired OPEN Report Sent task
--                         (explicit automation pair or Dynamics mutual-nearest
--                         pair); in_progress rows: NULL.
-- Appending at the end is what CREATE OR REPLACE VIEW allows, so v_client_todo
-- and every other reader are unaffected.
--
-- APP. Safe to deploy before or after this runs: the app reads the column via
-- select('*') and falls back to task_id while it is absent.
--
-- RUN: once, in the Supabase SQL editor. Re-runnable.
-- =============================================================================

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
    (CURRENT_DATE - (f.crdfa_feedback_received_date AT TIME ZONE 'UTC')::date) AS days_in_stage,
    NULL::uuid                                  AS review_task_id
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
    (CURRENT_DATE - (f.actual_end AT TIME ZONE 'UTC')::date) AS days_in_stage,
    -- The paired OPEN "Feedback Report Sent" task — the one a Pending Review
    -- row should open. Explicit (automation) or mutual-nearest (Dynamics) pair.
    r.task_id                                   AS review_task_id
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
  c.days_in_stage,
  c.review_task_id                              -- NEW 2026-10-08, trailing
FROM combined c
LEFT JOIN public.accounts a ON a.account_id      = c.client_account_id
LEFT JOIN mtg mt            ON mt.event_id        = c.event_id
LEFT JOIN rep_has_map hm    ON hm.report_task_id  = c.task_id
LEFT JOIN mtg_rep mr        ON mr.report_task_id  = c.task_id
ORDER BY c.category, c.days_in_stage DESC NULLS LAST, c.client_account_name;

-- ---- Check after running ------------------------------------------------------
-- Every Pending Review row should now carry its Report Sent task; In Progress none.
--   SELECT category, count(*) AS rows, count(review_task_id) AS with_review_task
--   FROM public.v_feedback_pipeline GROUP BY 1;
--   -- expect pending_review: rows = with_review_task; in_progress: with_review_task = 0

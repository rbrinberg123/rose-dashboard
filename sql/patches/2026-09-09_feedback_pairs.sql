-- =============================================================================
-- Patch: Feedback Reports -- support MULTIPLE Feedback / Feedback Report Sent
--        task pairs per event in public.v_feedback_pipeline
-- Date: 2026-09-09
--
-- WHY
--   The view assumed ONE Feedback task and ONE Feedback Report Sent task per
--   event, and linked them at the EVENT level:
--
--     report_sent_open AS (
--       SELECT DISTINCT ON (event_key) ... FROM tk
--       WHERE bcs_task_subtype_label = 'Feedback Report Sent'
--         AND state_label = 'Open' ...
--     )
--
--   ~5% of events actually get a second (or further) pair created manually when
--   more reports are needed. DISTINCT ON (event_key) kept only ONE Report Sent
--   task for the whole event, so a second Completed Feedback task was either
--   mis-gated (paired against the OTHER pair's report) or dropped entirely.
--
-- WHAT CHANGED
--   report_sent_open is REPLACED by two ranked CTEs. Both task types are ranked
--   oldest-first within their event by created_on (Dynamics createdon, NULLS
--   LAST, task_id as the tiebreak), and the pair key is (event_key, pair_index):
--   the Nth-created Feedback task matches the Nth-created Report Sent task of
--   the same event. Pairing is by creation RANK (1st<->1st, 2nd<->2nd), not by
--   nearest timestamp -- the two tasks in a pair are created seconds-to-minutes
--   apart, so rank is the stable signal.
--
--   NOTE the state filter moved from the CTE into the JOIN. rs_ranked ranks ALL
--   Report Sent tasks (Open, Completed and Canceled alike) and the join then
--   requires r.state_label = 'Open'. Ranking only the Open ones would let a
--   pair-2 report become rank 1 once pair 1's report completed, and it would
--   then wrongly pair with Feedback #1.
--
--   Bucket MEANINGS are unchanged, now evaluated per PAIR:
--     in_progress    -- Feedback task Open AND bcs_feedback_received. Sourced
--                       from fb_ranked; needs no Report Sent partner, so each
--                       Feedback task in an event qualifies independently.
--     pending_review -- Feedback task Completed AND its PAIRED Report Sent task
--                       still Open. due_date is now the PAIRED report's
--                       scheduled_end, not an event-wide pick.
--     Done (dropped) -- paired Report Sent task Completed => join fails => gone.
--
--   Pairs are INDEPENDENT: pair 1 can sit in Pending Review while pair 2 is
--   still in Open, both visible at once. A later pair is never sequenced behind
--   an earlier one.
--
--   Unequal counts: a Completed Feedback whose pair_index has no Report Sent
--   partner does not reach Pending Review (unchanged inner-join behaviour); a
--   Report Sent task with no Feedback partner contributes nothing.
--
-- UNCHANGED
--   Tasks-table-only (no Confirmed-meeting requirement, no host/assignee
--   requirement), no recency floor, UTC basis for days_in_stage, and the mtg
--   LEFT JOIN that supplies the display-only meeting columns.
--
-- created_on is ALREADY a real synced column (sql/14_tasks_table.sql, mapped in
-- lib/sync/mappers.ts mapTask). No ALTER TABLE or backfill is required. The
-- NULLS LAST ordering degrades safely if any row is missing it.
--
-- CREATE OR REPLACE (not DROP) on purpose: the output column list, order and
-- types are byte-identical to the live view, and public.v_client_todo depends
-- on this view -- a DROP ... CASCADE would take v_client_todo with it.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_feedback_pipeline AS
WITH tk AS (
  -- Feedback + Feedback Report Sent tasks, each stamped with its event key
  -- (the event GUID, wherever it is stored on the task).
  SELECT
    t.*,
    COALESCE(t.regarding_id, t.bcs_event_id) AS event_key
  FROM public.tasks t
  WHERE t.bcs_task_subtype_label IN ('Feedback', 'Feedback Report Sent')
),
fb_ranked AS (
  -- Feedback tasks ranked oldest-first WITHIN their event: pair_index is "this
  -- is the Nth Feedback task created for this event". created_on is the synced
  -- Dynamics createdon; NULLS LAST keeps undated tasks at the end of the
  -- ranking rather than letting one seize pair 1.
  SELECT
    tk.*,
    ROW_NUMBER() OVER (
      PARTITION BY tk.event_key
      ORDER BY tk.created_on ASC NULLS LAST, tk.task_id
    ) AS pair_index
  FROM tk
  WHERE tk.bcs_task_subtype_label = 'Feedback'
),
rs_ranked AS (
  -- Report Sent tasks ranked the same way. The Nth Report Sent task of an event
  -- is the partner of the Nth Feedback task of that event.
  -- event_key IS NOT NULL because a NULL key can never satisfy the pair JOIN
  -- below (NULL = NULL is not true) -- the same exclusion the old CTE made.
  SELECT
    tk.*,
    ROW_NUMBER() OVER (
      PARTITION BY tk.event_key
      ORDER BY tk.created_on ASC NULLS LAST, tk.task_id
    ) AS pair_index
  FROM tk
  WHERE tk.bcs_task_subtype_label = 'Feedback Report Sent'
    AND tk.event_key IS NOT NULL
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
  FROM fb_ranked f
  WHERE f.bcs_task_subtype_label = 'Feedback'
    AND f.state_label = 'Open'
    AND COALESCE(f.bcs_feedback_received, false) = true
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
  FROM fb_ranked f
  -- Matched PAIR, not an event-wide pick: the Nth Feedback task joins the Nth
  -- Report Sent task of the SAME event. Inner join, so a Completed Feedback
  -- task whose pair_index has no Report Sent partner -- or whose partner is
  -- already Completed/Canceled -- produces no row.
  JOIN rs_ranked r
    ON  r.event_key   = f.event_key
    AND r.pair_index  = f.pair_index
    AND r.state_label = 'Open'
  WHERE f.bcs_task_subtype_label = 'Feedback'
    AND f.state_label = 'Completed'
    AND f.event_key IS NOT NULL
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
  -- Client stock ticker (accounts.ticker_symbol). Its position here — 7th, ahead
  -- of account_manager_name — is NOT cosmetic: it is where the LIVE view carries
  -- it, and CREATE OR REPLACE VIEW matches columns POSITIONALLY, so a patch that
  -- moved it is rejected outright ("cannot change name of view column"). Verified
  -- against information_schema on 2026-09-09; an earlier revision of this file had
  -- it last, which did not match the deployed view. The accounts join below feeds
  -- both this and account_manager_name.
  a.ticker_symbol                               AS client_ticker,
  a.sales_lead_primary_name                     AS account_manager_name,
  mt.meeting_start,
  mt.meeting_end,
  COALESCE(mt.meeting_count, 0)                 AS meeting_count,
  c.received_date,
  c.due_date,
  c.fb_closed_date,
  c.claimed,
  c.claimed_by_id,
  c.claimed_by_name,
  c.days_in_stage
FROM combined c
LEFT JOIN public.accounts a ON a.account_id = c.client_account_id
LEFT JOIN mtg mt            ON mt.event_id    = c.event_id
ORDER BY c.category, c.days_in_stage DESC NULLS LAST, c.client_account_name;

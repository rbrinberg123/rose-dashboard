-- =============================================================================
-- Patch: Feedback Reports -- pair Feedback <-> Feedback Report Sent by NEAREST
--        created_on (mutual nearest neighbour) within an event
-- Date: 2026-09-09
--
-- SUPERSEDES sql/patches/2026-09-09_feedback_pairs.sql (creation-RANK pairing).
-- Run THIS one. Do not run that one.
--
-- WHY
--   The shipped view assumed ONE Feedback task and ONE Feedback Report Sent task
--   per event and linked them at the EVENT level:
--
--     report_sent_open AS (
--       SELECT DISTINCT ON (event_key) ... FROM tk
--       WHERE bcs_task_subtype_label = 'Feedback Report Sent'
--         AND state_label = 'Open' ...
--     )
--
--   ~5% of events actually get a second (or further) pair created manually, and
--   events can also carry STRAY unpaired tasks. DISTINCT ON kept only one report
--   for the whole event, so a second Completed Feedback was mis-gated or dropped.
--
--   A creation-RANK pairing (1st<->1st, 2nd<->2nd) was tried and REJECTED: a stray
--   unpaired task shifts every subsequent rank, breaking alignment. See the QBE
--   worked example at the bottom of this header.
--
-- WHAT IT DOES NOW -- MUTUAL NEAREST NEIGHBOUR on created_on
--   Within each event: build every Feedback x Report Sent combination (cand), rank
--   each from both directions by the absolute creation-time gap (cand_ranked), and
--   keep a combination only when the two tasks are EACH OTHER'S closest
--   (rn_from_fb = 1 AND rn_from_rs = 1). One-to-one by construction, no recursion.
--
--   Rules this enforces:
--     * Each Feedback and each Report Sent is used in AT MOST ONE pair.
--     * NO distance cap -- a pair may be seconds or months apart; nearest wins.
--     * A task with no mutual-nearest partner is an ORPHAN and is not paired.
--     * Ties break on task_id; a NULL created_on gives a NULL dist, sorted LAST.
--
--   Bucket MEANINGS are unchanged, now evaluated per pair:
--     in_progress    -- Feedback task Open AND crdfa_feedback_received_date. Sourced
--                       straight from fb, INDEPENDENT of pairing: every qualifying
--                       Feedback task appears on its own, partner or not.
--     pending_review -- Feedback Completed AND its mutually-PAIRED Report Sent
--                       still Open. due_date is that paired report's scheduled_end.
--     Done (dropped) -- paired Report Sent Completed => inner join fails => gone.
--                       An orphan Completed Feedback likewise produces no row.
--
--   Pairs are INDEPENDENT: one pair can sit in Pending Review while another on the
--   same event is still in Open, both visible. No sequencing between pairs.
--
-- UNCHANGED
--   Tasks-table-only universe (no Confirmed-meeting, host or assignee requirement),
--   no recency floor, UTC basis for days_in_stage, and the mtg LEFT JOIN that
--   supplies the display-only meeting columns.
--
-- created_on is an existing synced column (sql/14_tasks_table.sql; mapped in
-- lib/sync/mappers.ts mapTask). No ALTER TABLE or backfill required.
--
-- COLUMN ORDER: client_ticker sits 7th, ahead of account_manager_name, matching the
-- LIVE view (verified against information_schema 2026-09-09). CREATE OR REPLACE
-- compares columns positionally and rejects a reorder, and public.v_client_todo
-- depends on this view, so a DROP ... CASCADE would take v_client_todo with it.
--
-- WORKED EXAMPLE -- event 0fff8e98-cb26-f111-8341-0022483460ce (QBE), real tasks:
--   R1 4eb5c46b  Report Sent  2026-05-04 19:29:08  due 6/17  Completed
--   FA d03316ee  Feedback     2026-06-05 15:19:27  due 6/14  Completed
--   R2 9044b8f6  Report Sent  2026-06-05 15:19:40  due 6/16  Completed
--   FB aca78372  Feedback     2026-09-09 14:26:31  due 6/14  Completed
--   R3 a88f2974  Report Sent  2026-09-09 14:26:37  due 7/16  Open
--
--   Mutual nearest => FA<->R2 (13s) and FB<->R3 (6s); R1 has no mutual partner.
--   FA<->R2: both Completed          -> no row (done)
--   FB<->R3: FB Completed, R3 Open   -> ONE Pending Review row, due 7/16
--   R1:      orphan                  -> no row
--   Open bucket: empty (both Feedback tasks are Completed)
-- =============================================================================

CREATE OR REPLACE VIEW public.v_feedback_pipeline AS
WITH tk AS (
  -- Feedback + Feedback Report Sent tasks, each stamped with its event key
  -- (the event GUID, wherever it is stored on the task).
  SELECT
    t.*,
    COALESCE(t.bcs_event_id, t.regarding_id) AS event_key
  FROM public.tasks t
  WHERE t.bcs_task_subtype_label IN ('Feedback', 'Feedback Report Sent')
),
fb AS (SELECT * FROM tk WHERE bcs_task_subtype_label = 'Feedback'),
rs AS (SELECT * FROM tk WHERE bcs_task_subtype_label = 'Feedback Report Sent'),
cand AS (
  -- Every Feedback x Report Sent combination WITHIN an event, with the absolute
  -- gap between their creation times. The join on event_key also drops tasks
  -- with a NULL key (NULL = NULL is not true), so those are never candidates.
  SELECT
    f.task_id                                                   AS fb_id,
    r.task_id                                                   AS rs_id,
    f.event_key,
    ABS(EXTRACT(EPOCH FROM (f.created_on - r.created_on)))       AS dist
  FROM fb f
  JOIN rs r ON r.event_key = f.event_key
),
cand_ranked AS (
  -- Rank each candidate from BOTH directions: how close is this report to that
  -- feedback, and how close is that feedback to this report.
  SELECT
    cand.*,
    ROW_NUMBER() OVER (PARTITION BY fb_id ORDER BY dist ASC NULLS LAST, rs_id) AS rn_from_fb,
    ROW_NUMBER() OVER (PARTITION BY rs_id ORDER BY dist ASC NULLS LAST, fb_id) AS rn_from_rs
  FROM cand
),
pairs AS (
  -- MUTUAL nearest neighbour: keep a combination only when the two tasks are
  -- each other's closest. That makes the matching one-to-one (each task appears
  -- in at most one pair) without recursion, and leaves any task without a mutual
  -- partner unpaired -- an orphan, which simply never reaches a bucket.
  SELECT fb_id, rs_id, event_key, dist
  FROM cand_ranked
  WHERE rn_from_fb = 1 AND rn_from_rs = 1
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
  -- Independent of pairing: every qualifying Feedback task stands on its own,
  -- whether or not it has a Report Sent partner.
  FROM fb f
  WHERE f.state_label = 'Open'
    -- crdfa_* date, NOT the legacy bcs_feedback_received boolean: that boolean
    -- reads true on tasks whose CRM "Feedback Received" toggle is No (task
    -- 930c699d). Changed 2026-09-09; see sql/03_views.sql for the full note.
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
  -- Walks the mutual-nearest pairing: a Completed Feedback whose PAIRED report
  -- is still Open. Both joins are inner, so an orphan Feedback, or one whose
  -- partner is already Completed/Canceled (= done), produces no row.
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

-- =============================================================================
-- Patch: task -> event grouping key now prefers bcs_event_id over regarding_id
-- Date: 2026-09-09
--
-- THE CHANGE, in one line:
--     COALESCE(t.regarding_id, t.bcs_event_id)   -- before (wrong)
--     COALESCE(t.bcs_event_id, t.regarding_id)   -- after
--
-- WHY
--   regarding_id is Dataverse's POLYMORPHIC "regarding" lookup: it can point at
--   an account, a contact or an event. bcs_event_id is Rose's explicit "this
--   task belongs to this event" field. Preferring regarding_id therefore grouped
--   some feedback tasks under an ACCOUNT id, splitting them from their own event
--   and corrupting the Feedback pairing.
--
--   Real example: task 930c699d, "Feedback for DSFIR - Part 2 September" --
--   bcs_event_id is the DSFIR-NL event, regarding_id is the account.
--
-- BLAST RADIUS
--   The flip is a NO-OP for every task where bcs_event_id IS NULL, or where it
--   already equals regarding_id: COALESCE returns the same value either way.
--   ONLY tasks carrying two DIFFERENT non-null values change key -- reported as
--   exactly 23 across the system, and each re-homes to its correct event.
--   Confirm with the queries at the bottom of this file.
--
-- SCOPE -- this is the ONLY place the task->event key is derived.
--   v_feedback_pipeline      FIXED here (and in sql/03_views.sql).
--   v_client_todo            no change needed: it reads v_feedback_pipeline for
--                            its feedback counts, so it inherits the fix. Its own
--                            tasks CTE groups by bcs_account_id, not by event.
--   v_client_onboarding      no change needed: groups tasks by bcs_account_id.
--   v_feedback_outstanding   no change needed: meetings-based, reads no tasks.
--   v_feedback_manager       already keyed on t.bcs_event_id directly (legacy,
--                            unused by any page).
--   v_client_marketing_status already keyed on t.bcs_event_id directly.
--
-- SUPERSEDES the same view in sql/patches/2026-09-09_feedback_nearest_pairs.sql,
-- which has also been corrected. Running EITHER gives the fixed view; running
-- this one is enough. (Do NOT run 2026-09-09_feedback_pairs.sql -- older,
-- rank-based pairing, already banner-marked.)
--
-- COLUMN ORDER: client_ticker sits 7th, matching the live view. CREATE OR
-- REPLACE compares positionally and v_client_todo depends on this view, so a
-- DROP ... CASCADE would take v_client_todo with it.
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


-- =============================================================================
-- VERIFICATION -- run these; they are the ones this patch could not self-check.
--
-- Q1. THE 23. Every task whose key actually changes, with old vs new key and
--     the event each one re-homes to. Also proves the new key resolves to a REAL
--     event: a NULL event_name means bcs_event_id points at nothing in
--     public.events, which is a red flag worth investigating before trusting it.
-- =============================================================================
SELECT t.task_id,
       t.subject,
       t.bcs_task_subtype_label            AS subtype,
       t.regarding_id                      AS old_key,
       t.bcs_event_id                      AS new_key,
       e.name                              AS resulting_event,
       a.name                              AS old_key_matches_account,
       CASE WHEN e.event_id IS NULL THEN 'NO MATCHING EVENT -- INVESTIGATE'
            ELSE 'ok' END                  AS new_key_status
FROM public.tasks t
LEFT JOIN public.events   e ON e.event_id   = t.bcs_event_id
LEFT JOIN public.accounts a ON a.account_id = t.regarding_id
WHERE t.bcs_event_id IS NOT NULL
  AND t.regarding_id IS NOT NULL
  AND t.bcs_event_id <> t.regarding_id
ORDER BY e.name NULLS FIRST, t.subject;

-- Q2. BEFORE/AFTER COUNTS. Run the "before" block BEFORE applying the view
--     above, and the same block after; the two feedback buckets should move only
--     among the 23 tasks' clients.
SELECT category, count(*) AS rows
FROM public.v_feedback_pipeline
GROUP BY category ORDER BY category;

SELECT sum(open_reports)     AS todo_open_reports,
       sum(open_collections) AS todo_open_collections
FROM public.v_client_todo;

SELECT count(*) AS onboarding_active_clients
FROM public.v_client_onboarding;

-- Q3. WORKED EXAMPLE -- the DSFIR event. Expect all six tasks on ONE event_key
--     after the fix (0cd7a2c0...), and three pairs.
SELECT t.task_id, t.subject, t.bcs_task_subtype_label AS subtype,
       t.state_label, t.bcs_feedback_received, t.created_on,
       COALESCE(t.regarding_id, t.bcs_event_id) AS key_before,
       COALESCE(t.bcs_event_id, t.regarding_id) AS key_after
FROM public.tasks t
WHERE t.bcs_task_subtype_label IN ('Feedback', 'Feedback Report Sent')
  -- Prefix match on the key, so no full uuid has to be pasted in. Cast to text
  -- first: a partial uuid is not a valid uuid literal and '<placeholder>'::uuid
  -- fails with 22P02 before the query ever runs.
  AND COALESCE(t.bcs_event_id, t.regarding_id)::text LIKE '0cd7a2c0%'
ORDER BY t.created_on;

-- Q4. REGRESSION -- the QBE event should be unchanged.
SELECT category, task_id, due_date
FROM public.v_feedback_pipeline
WHERE event_id = '0fff8e98-cb26-f111-8341-0022483460ce'
ORDER BY category;
-- Expect exactly one row: pending_review, task aca78372..., due 2026-07-16.

-- =============================================================================
-- Patch: feedback "received" signal + meaningful _synced_at
-- Date: 2026-09-09
--
-- TWO INDEPENDENT CHANGES. Part A rewrites one view; Part B adds triggers to the
-- nine mirror tables. Neither depends on the other; both are safe to re-run.
--
-- -----------------------------------------------------------------------------
-- PART A -- the Open bucket keys on crdfa_feedback_received_date
--
--   before:  state_label = 'Open' AND COALESCE(bcs_feedback_received,false)=true
--   after:   state_label = 'Open' AND crdfa_feedback_received_date IS NOT NULL
--
--   bcs_feedback_received is stale: it reads true on tasks whose CRM "Feedback
--   Received" toggle is actually No -- real case, task 930c699d, DSFIR "Part 2
--   September". crdfa_feedback_received_date is the field the CRM form reflects.
--
--   It also makes membership agree with DISPLAY. received_date and days_in_stage
--   were ALREADY computed from crdfa_feedback_received_date, so a bcs-only row
--   appeared in Open with a blank "FB Received" cell and a null "Waiting"
--   figure. One field now drives both, so that cannot recur.
--
--   EXPECTED: Open 11 -> 10, dropping exactly task 930c699d. pending_review is
--   untouched (it keys off task completion + a paired open report, never the
--   received signal). Confirm with the queries at the bottom.
--
-- -----------------------------------------------------------------------------
-- PART B -- _synced_at becomes LAST SYNCED
--
--   _synced_at is DEFAULT now(), and a DEFAULT fires only on INSERT. No mapper
--   writes the column, and the sync upserts only mapped columns, so ON CONFLICT
--   DO UPDATE never touched it. It was therefore an INSERT timestamp: every row
--   edited in Dynamics after its first mirror insert showed
--   modified_on > _synced_at forever, even when the sync had re-pulled it
--   correctly every ten minutes since. That made the obvious staleness test
--   useless -- it flagged every ever-edited row. (This is what the "425 stale
--   tasks" reading actually measured.)
--
--   A trigger rather than nine mapper edits: uniform, automatic, and it cannot
--   be forgotten when a tenth entity is added. BEFORE INSERT as well as UPDATE
--   so the column has exactly one writer; on insert it sets the same value the
--   DEFAULT would have, so insert behaviour is unchanged.
--
--   AFTER THIS, modified_on > _synced_at is a REAL staleness signal -- but only
--   for rows touched from here on. Existing rows keep their old insert-time
--   stamp until their next sync, so expect the "stale" count to look unchanged
--   at first and drain as records are re-pulled. To reset the baseline in one
--   go, force a full re-pull (see content/docs/08-runbook.md):
--       UPDATE sync_runs SET last_synced_at = NULL WHERE entity_name = 'tasks';
--   then run a sync.
-- =============================================================================


-- ---- PART A ----------------------------------------------------------------
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
  --
  -- MEMBERSHIP KEYS ON crdfa_feedback_received_date, NOT the legacy
  -- bcs_feedback_received boolean (changed 2026-09-09). That boolean is stale in
  -- Dynamics: it reads true on tasks whose CRM "Feedback Received" toggle is
  -- actually No -- real case, task 930c699d (DSFIR "Part 2 September"). The
  -- crdfa_* date is the field the CRM form now reflects.
  --
  -- It also makes membership agree with what the row DISPLAYS: received_date and
  -- days_in_stage above are already computed from crdfa_feedback_received_date,
  -- so a bcs-only row used to appear in Open with a blank FB Received cell and a
  -- null Waiting figure. Same field for both now, so that cannot recur.
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


-- ---- PART B ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_synced_at()
RETURNS trigger AS $$
BEGIN
  NEW._synced_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounts_touch_synced_at ON public.accounts;
CREATE TRIGGER accounts_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

-- SUPERSEDED 2026-09-16 -- the users trigger below was WRONG and is removed.
-- public.users has no _synced_at column (it uses first_seen_at/last_seen_at),
-- so this trigger made every users upsert throw
--   record "new" has no field "_synced_at"
-- and the systemusers sync failed every run from 2026-09-11 to 2026-09-16.
-- Dropped by sql/patches/2026-09-16_drop_users_synced_at_trigger.sql.
-- DO NOT re-enable when re-running this patch.
--
-- DROP TRIGGER IF EXISTS users_touch_synced_at ON public.users;
-- CREATE TRIGGER users_touch_synced_at
--   BEFORE INSERT OR UPDATE ON public.users
--   FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

DROP TRIGGER IF EXISTS meetings_touch_synced_at ON public.meetings;
CREATE TRIGGER meetings_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

DROP TRIGGER IF EXISTS touchpoints_touch_synced_at ON public.touchpoints;
CREATE TRIGGER touchpoints_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.touchpoints
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

DROP TRIGGER IF EXISTS client_notes_touch_synced_at ON public.client_notes;
CREATE TRIGGER client_notes_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.client_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

DROP TRIGGER IF EXISTS contracts_touch_synced_at ON public.contracts;
CREATE TRIGGER contracts_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

DROP TRIGGER IF EXISTS tasks_touch_synced_at ON public.tasks;
CREATE TRIGGER tasks_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

DROP TRIGGER IF EXISTS new_vacationrequest_touch_synced_at ON public.new_vacationrequest;
CREATE TRIGGER new_vacationrequest_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.new_vacationrequest
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

DROP TRIGGER IF EXISTS events_touch_synced_at ON public.events;
CREATE TRIGGER events_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();


-- =============================================================================
-- VERIFICATION
--
-- V1. Part A before/after. Run BEFORE applying, then again after.
--     Expect in_progress 11 -> 10; pending_review unchanged.
-- =============================================================================
SELECT category, count(*) AS rows
FROM public.v_feedback_pipeline
GROUP BY category ORDER BY category;

-- V2. The row that should drop, and the ten that should stay. Reads tasks
--     directly, so it gives the same answer before or after the view is applied.
SELECT t.task_id,
       t.subject,
       t.bcs_feedback_received                        AS legacy_flag,
       t.crdfa_feedback_received_date                 AS current_date_field,
       CASE WHEN t.crdfa_feedback_received_date IS NOT NULL
            THEN 'stays in Open' ELSE 'DROPS from Open' END AS effect
FROM public.tasks t
WHERE t.bcs_task_subtype_label = 'Feedback'
  AND t.state_label = 'Open'
ORDER BY effect, t.subject;
-- Expect 11 rows: 10 "stays in Open", and 930c699d as the single "DROPS".

-- V3. Disagreement between the two fields, across ALL feedback tasks -- how far
--     the legacy flag has drifted. Worth a look even though only Open tasks
--     affect the bucket.
SELECT count(*) FILTER (WHERE bcs_feedback_received IS TRUE
                          AND crdfa_feedback_received_date IS NULL)  AS flag_true_no_date,
       count(*) FILTER (WHERE COALESCE(bcs_feedback_received,false) = false
                          AND crdfa_feedback_received_date IS NOT NULL) AS date_but_flag_false,
       count(*)                                                      AS all_feedback_tasks
FROM public.tasks
WHERE bcs_task_subtype_label = 'Feedback';

-- V4. Part B — the nine triggers exist.
SELECT event_object_table AS table_name, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public' AND trigger_name LIKE '%touch_synced_at'
ORDER BY event_object_table, event_manipulation;
-- Expect 18 rows: 9 tables x {INSERT, UPDATE}.

-- V5. Part B — prove it stamps. Harmless no-op update on one row.
UPDATE public.tasks SET subject = subject
WHERE task_id = '930c699d-6ba5-f111-b8de-3833c5ef9c33';
SELECT task_id, modified_on, _synced_at, _synced_at > modified_on AS fresh
FROM public.tasks WHERE task_id = '930c699d-6ba5-f111-b8de-3833c5ef9c33';
-- _synced_at should now be "just now" and fresh = true.

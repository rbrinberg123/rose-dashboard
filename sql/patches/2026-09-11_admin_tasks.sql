-- =============================================================================
-- Patch: CRM -> Tasks. The third CRM admin table, after Meetings and Events.
-- Date: 2026-09-11
--
-- CREATES
--   1. Indexes on the filter / sort / default-view columns
--   2. v_admin_tasks_all             -- the list + drawer view, joined to accounts
--   3. v_admin_tasks_filter_options  -- distinct values for the five dropdowns
--   4. task_saved_views              -- saved views, same shape as meetings/events
--
-- SECURITY. v_admin_tasks_all is UNSCOPED, exactly like v_admin_meetings_all and
-- v_admin_events_all: it returns every client's tasks to whoever can read it, and
-- the page reads it with the service-role key (RLS bypassed). The gate is the
-- route -- lib/access-control.ts ADMIN_ONLY_ROUTES makes /tasks super-user-only
-- and NOT grantable through the Roles matrix -- plus a server-side re-check in
-- app/tasks/page.tsx and in every server action before anything is fetched.
-- Do not reuse this view on a row-scoped page.
--
-- ── FIELD SOURCING NOTES (read these; one is a deliberate deviation) ────────
--
--   PRIORITY IS bcs_task_priority_label FIRST, NOT priority_label.
--   The brief said "priority_label (fall back to bcs_task_priority_label)".
--   Taken literally that produces a CONSTANT column: measured on all 3,920 live
--   rows, priority_label is 'Normal' on every single one and is never null, so
--   COALESCE(priority_label, bcs_task_priority_label) can only ever return
--   'Normal' and the fallback is unreachable. The Rose-specific field is where
--   the signal actually is: bcs_task_priority_label is High on 2,060 rows and
--   Medium on 24 (null on the remaining 1,836).
--   So the precedence is INVERTED here on purpose:
--       COALESCE(NULLIF(btrim(bcs_task_priority_label), ''), t.priority_label)
--   which yields High 2,060 / Normal 1,836 / Medium 24 -- a column worth
--   showing. Both raw columns are also exposed (priority_stock_label and
--   priority_rose_label) so a saved view can filter either one directly, and
--   nothing is hidden by the choice.
--   If the literal reading was actually intended, swap the two arguments below
--   and the column becomes a constant again.
--
--   REGARDING TYPE IS TRANSLATED. tasks.regarding_type holds raw Dataverse
--   entity names -- bcs_event (2,163), account (1,562), bcs_project (4),
--   contact (1). regarding_type_label maps those to Event / Client / Project /
--   Contact for display; the raw column is kept alongside it.
--
--   EMPTY BUT REAL. actual_start is 0% populated across all 3,920 live tasks.
--   It is exposed anyway because it is a field the drawer asks for -- it will
--   fill in if the CRM starts writing it. bcs_claimed_by_name is 9% and
--   bcs_current_assignment_name 41%; both are real, just sparse.
--
--   OWNER IS NOT ALWAYS A PERSON. owner_name carries a mix of full names
--   ("Katie Murphy"), two-letter staff codes ("JS", "YL") and queue names
--   ("CRM", "Feedback Reports") -- 22 distinct values, of which only 5 owner_ids
--   resolve to a public.users row. The view exposes both id and name and lets
--   the page decide how to paint it; see the owner renderer note in
--   dashboard/lib/tasks/spec.ts.
--
-- SAFE TO RE-RUN.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Indexes
--    idx_tasks_bcs_account, idx_tasks_bcs_event, idx_tasks_regarding,
--    idx_tasks_scheduled_start, idx_tasks_status and idx_tasks_modified_on
--    already exist (sql/14_tasks_table.sql). These cover what this page adds:
--    the default view, the sort, and the five dropdowns.
-- ---------------------------------------------------------------------------

-- The default view is state_label = 'Open' (530 of 3,920 rows) sorted by due
-- date, so the pair serves the filter AND the sort in one index scan.
CREATE INDEX IF NOT EXISTS idx_tasks_state_due
  ON public.tasks (state_label, scheduled_end);

-- state_label on its own, for the built-in views that select it alone.
CREATE INDEX IF NOT EXISTS idx_tasks_state_label
  ON public.tasks (state_label);

-- Due Date: the default sort column, and a filterable date on its own.
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_end
  ON public.tasks (scheduled_end);

-- The Task Type and Sub-type dropdowns. NOTE the existing idx_tasks_task_type
-- is on bcs_task_type_CODE; the page filters on the LABEL, which that index
-- cannot serve.
CREATE INDEX IF NOT EXISTS idx_tasks_task_type_label
  ON public.tasks (bcs_task_type_label);

CREATE INDEX IF NOT EXISTS idx_tasks_task_subtype_label
  ON public.tasks (bcs_task_subtype_label);

-- The Owner dropdown, which filters on the id (expanded across alias groups).
CREATE INDEX IF NOT EXISTS idx_tasks_owner_id
  ON public.tasks (owner_id);

-- The Client dropdown. idx_tasks_bcs_account already covers this; restated with
-- IF NOT EXISTS so this patch stands alone if 14_tasks_table.sql has drifted.
CREATE INDEX IF NOT EXISTS idx_tasks_bcs_account
  ON public.tasks (bcs_account_id);

-- ---------------------------------------------------------------------------
-- 2. v_admin_tasks_all
--    One row per task, joined to accounts for the client link + ticker.
--    LEFT JOIN so a task with no account (3 of 3,920) still appears.
--
--    Column names are the app-facing ones: client_account_id / _name / _ticker
--    match what v_admin_events_all calls them, so the shared ticker renderer and
--    the account-team merge work unchanged.
-- ---------------------------------------------------------------------------

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
  t.modified_on
FROM public.tasks t
LEFT JOIN public.accounts a ON a.account_id = t.bcs_account_id;

GRANT SELECT ON public.v_admin_tasks_all TO service_role;

-- ---------------------------------------------------------------------------
-- 3. v_admin_tasks_filter_options
--    Same (kind, value, label, count) shape as the meetings and events options
--    views, read straight off public.tasks so the dropdowns never scan the
--    joined view. Five kinds: client, task_type, subtype, owner, status.
--
--    Owners are keyed by CANONICAL user id -- two people in this CRM carry
--    duplicate systemuser records, and a raw-id filter would split them.
--    public.canonical_user_id falls back to the id itself when there is no
--    alias row, which is what the 17 non-staff owner ids (queues, codes) get.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_admin_tasks_filter_options AS
  -- Clients, keyed by account id (two accounts could share a display name).
  SELECT
    'client'::text                                    AS kind,
    t.bcs_account_id::text                            AS value,
    min(t.bcs_account_name)                           AS label,
    count(*)::bigint                                  AS task_count
  FROM public.tasks t
  WHERE t.bcs_account_id IS NOT NULL
    AND NULLIF(btrim(t.bcs_account_name), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'task_type'::text                                 AS kind,
    btrim(t.bcs_task_type_label)                      AS value,
    btrim(t.bcs_task_type_label)                      AS label,
    count(*)::bigint                                  AS task_count
  FROM public.tasks t
  WHERE NULLIF(btrim(t.bcs_task_type_label), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'subtype'::text                                   AS kind,
    btrim(t.bcs_task_subtype_label)                   AS value,
    btrim(t.bcs_task_subtype_label)                   AS label,
    count(*)::bigint                                  AS task_count
  FROM public.tasks t
  WHERE NULLIF(btrim(t.bcs_task_subtype_label), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  -- Owners, keyed by CANONICAL user id -- see the note above.
  SELECT
    'owner'::text                                     AS kind,
    public.canonical_user_id(t.owner_id)::text        AS value,
    min(t.owner_name)                                 AS label,
    count(*)::bigint                                  AS task_count
  FROM public.tasks t
  WHERE t.owner_id IS NOT NULL
    AND NULLIF(btrim(t.owner_name), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'status'::text                                    AS kind,
    btrim(t.status_label)                             AS value,
    btrim(t.status_label)                             AS label,
    count(*)::bigint                                  AS task_count
  FROM public.tasks t
  WHERE NULLIF(btrim(t.status_label), '') IS NOT NULL
  GROUP BY 1, 2;

GRANT SELECT ON public.v_admin_tasks_filter_options TO service_role;

-- ---------------------------------------------------------------------------
-- 4. task_saved_views
--    Identical shape and identical rules to meeting_saved_views and
--    event_saved_views. The APP CODE is shared (one parameterised module
--    enforces all three), so only the storage is duplicated -- see
--    dashboard/lib/table-views/saved-views.ts.
--
--    RLS on, zero policies => only service_role reaches it. The anon key that
--    ships in the browser gets nothing. Authorisation for the service-role path
--    lives in the app; the constraints below are the database backstop.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.task_saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('system', 'personal')),
  owner_user_id uuid REFERENCES public.users(user_id),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  config        jsonb NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT task_saved_views_owner_matches_scope CHECK (
    (scope = 'system'   AND owner_user_id IS NULL) OR
    (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS task_saved_views_one_personal_default
  ON public.task_saved_views (owner_user_id)
  WHERE scope = 'personal' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS task_saved_views_one_system_default
  ON public.task_saved_views (scope)
  WHERE scope = 'system' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS task_saved_views_personal_name
  ON public.task_saved_views (owner_user_id, lower(btrim(name)))
  WHERE scope = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS task_saved_views_system_name
  ON public.task_saved_views (lower(btrim(name)))
  WHERE scope = 'system';

CREATE INDEX IF NOT EXISTS idx_task_saved_views_scope_owner
  ON public.task_saved_views (scope, owner_user_id);

DROP TRIGGER IF EXISTS task_saved_views_touch_updated_at ON public.task_saved_views;
CREATE TRIGGER task_saved_views_touch_updated_at
  BEFORE UPDATE ON public.task_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.task_saved_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_saved_views TO service_role;

-- Check it:
--   SELECT count(*) FROM public.v_admin_tasks_all;                       -- 3920
--   SELECT count(*) FROM public.v_admin_tasks_all
--     WHERE state_label = 'Open';                                        -- ~530
--   SELECT kind, count(*) AS options FROM public.v_admin_tasks_filter_options
--     GROUP BY 1 ORDER BY 1;
--     -- client ~200, owner ~22, status 4, subtype 24, task_type 5
--   SELECT priority_label, count(*) FROM public.v_admin_tasks_all
--     GROUP BY 1 ORDER BY 2 DESC;      -- High 2060 / Normal 1836 / Medium 24

-- =============================================================================
-- Patch: CRM -> Notes. The fifth CRM admin table, after Meetings, Events,
--        Tasks and Touches.
-- Date: 2026-09-15
--
-- CREATES
--   1. Indexes on the filter / sort / default-view columns
--   2. v_admin_notes_all             -- list + drawer view, joined to accounts
--   3. v_admin_notes_filter_options  -- distinct values for the five dropdowns
--   4. note_saved_views              -- saved views, same shape as the others
--
-- SECURITY. v_admin_notes_all is UNSCOPED, exactly like v_admin_meetings_all,
-- v_admin_events_all, v_admin_tasks_all and v_admin_touchpoints_all: it returns
-- every client's notes to whoever can read it, and the page reads it with the
-- service-role key (RLS bypassed). These are the firm's candid internal
-- assessments of each client -- "At Risk", risk drivers, action steps -- so this
-- is the most sensitive of the five CRM tables. The gate is the route --
-- lib/access-control.ts ADMIN_ONLY_ROUTES makes /notes super-user-only and NOT
-- grantable through the Roles matrix -- plus a server-side re-check in
-- app/notes/page.tsx and in every server action before anything is fetched.
-- Do not reuse this view on a row-scoped page.
--
-- ── WHAT public.client_notes IS ────────────────────────────────────────────
-- The mirror of the Dynamics `bcs_clientnote` entity: a monthly client-review
-- record, one per client per review cycle. 693 live rows spanning note_date
-- 2026-02-04 .. 2026-09-11 -- the whole archive is about seven months old.
--
-- ── FIELD SOURCING NOTES (five traps; all measured on the 693 live rows) ───
--
--   1. TRAILING NEWLINES IN THE CLASSIFIER FIELDS. status_text and
--      primary_risk_driver are typed into Dynamics with a trailing newline about
--      half the time, so the RAW columns hold "Stable" and "Stable\n" as two
--      different values. Untrimmed, status_text has 13 distinct values and
--      primary_risk_driver 32 -- and every dropdown would show each choice twice.
--      btrim collapses them to 8 and 21:
--        status_text        Stable 357 / At Risk 110 / New Client 21 / Lost 18 /
--                           Strong 3 / "At Risk." 2 / Pause 1 / null 181
--        primary_risk_driver None 106 / Execution-Meeting Volume 48 / Mining 34 /
--                           IR-Leadership Turnover 27 / ... / null 372
--      Both are btrim'd in the view and the filter-options view btrims to match.
--      RESIDUAL, NOT FIXED: "At Risk." (2 rows) stays distinct from "At Risk"
--      after trimming -- that is a real typo in the source, not whitespace, and
--      silently merging it would be the view editing the CRM's data.
--
--   2. THE NOTE BODY IS BETTER IN _raw THAN IN ITS OWN COLUMN. The mirror
--      flattens `bcs_notestext` into notes_text, but Dynamics ALSO carries
--      `bcs_notes`, which holds the same note with its line breaks intact.
--      notes_text has them collapsed, so a note reads as one run-on paragraph
--      with arbitrary wraps. They differ on 435 of 693 rows. Example:
--        notes_text  "Status: Stable Overall Sentiment: All good; need to
--                     execute on new intro mtgs\nPrimary Risk Driver: ..."
--        bcs_notes   "Status: Stable\nOverall Sentiment: All good; need to
--                     execute on new intro mtgs\nPrimary Risk Driver: ..."
--      So note_body = COALESCE(bcs_notes from _raw, notes_text), and the raw
--      notes_text is exposed alongside it for comparison. The drawer renders
--      note_body with whitespace preserved, which is the whole point.
--
--   3. OWNER IS A REAL PERSON, BUT HAS NO NAME COLUMN. Unlike Touches -- where
--      owner is a per-account team -- here `_ownerid_value@...lookuplogicalname`
--      is "systemuser" on every row and the owner is genuinely the note's author:
--      Grace Andonian (364) and Robert Brinberg (329). But the mapper
--      (lib/sync/mappers.ts mapClientNote) takes only `owner_id` and never the
--      name, so owner_name has to come out of _raw. created_by is the same two
--      people; modified_by is Grace Andonian or "CRM Administration".
--      Note the two owner_ids do NOT resolve against public.users, so the name
--      cannot be recovered by joining -- _raw is the only source.
--
--   4. state_label AND status_label ARE CONSTANTS. Both are "Active" on all 693
--      rows. They are exposed but hidden by default. The status that actually
--      carries meaning is status_text (trap 1), which is a free-text Rose field,
--      not a Dynamics option set.
--
--   5. DATE COLUMNS ARE `date`, AND ARE LIFTED TO EASTERN MIDNIGHT HERE.
--      note_date and action_deadline are plain `date`s, but the shared filter
--      grammar (lib/table-views/query.ts resolveDateValue) resolves every date
--      filter to the UTC instant of an EASTERN midnight -- e.g. "on or after
--      2026-09-15" becomes '2026-09-15T04:00:00Z'. Comparing a bare `date`
--      against that casts the date to UTC midnight, which is four hours EARLIER,
--      so a note dated the 15th would be excluded from "on or after the 15th".
--      Both columns are therefore converted to timestamptz AT Eastern midnight,
--      which makes them behave exactly like the timestamptz dates on the other
--      four CRM tables and round-trip correctly through the Eastern formatter.
--
--   ALSO WORTH KNOWING, not fixed:
--     * 25 rows are EMPTY SHELLS -- no note_date, no client, no body, no name.
--       They are incomplete records in the CRM. The default view filters on
--       note_date, so it drops all 25; that is a feature, not data loss.
--     * `name` is the REVIEW CYCLE, not a per-note title: 10 distinct values,
--       "Client Review - June 2026" (104) down to two "Test" rows. Exposed as
--       review_cycle and offered as a dropdown.
--     * action_deadline has two 1931 dates (Oddity Tech Ltd.) -- obvious typos in
--       the CRM, left alone.
--     * These _raw lookups are ~0% populated, so nothing is sourced from them:
--       _bcs_acctmgr_value, _bcs_assoc_value, _bcs_log_value, _bcs_secmgr_value,
--       _createdonbehalfby_value, overriddencreatedon.
--
-- SAFE TO RE-RUN.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Indexes
--    idx_client_notes_client (client_account_id, note_date DESC) and
--    idx_client_notes_modified already exist (sql/01_mirror_tables.sql). These
--    cover what this page adds: the default sort and the five dropdowns.
--
--    The three btrim() indexes are EXPRESSION indexes, matching the btrim the
--    view applies -- a plain index on the raw column could not serve a filter on
--    the trimmed value. btrim(text) is immutable, so this is allowed.
-- ---------------------------------------------------------------------------

-- The default sort. The existing index leads with client_account_id and cannot
-- serve an unfiltered ORDER BY note_date DESC.
CREATE INDEX IF NOT EXISTS idx_client_notes_note_date
  ON public.client_notes (note_date DESC);

-- The Owner dropdown, which filters on the id (expanded across alias groups).
CREATE INDEX IF NOT EXISTS idx_client_notes_owner_id
  ON public.client_notes (owner_id);

-- The Status dropdown. See trap 1 for why this is on the trimmed value.
CREATE INDEX IF NOT EXISTS idx_client_notes_status_text
  ON public.client_notes (btrim(status_text));

-- The Risk Driver dropdown.
CREATE INDEX IF NOT EXISTS idx_client_notes_risk_driver
  ON public.client_notes (btrim(primary_risk_driver));

-- The Review Cycle dropdown.
CREATE INDEX IF NOT EXISTS idx_client_notes_review_cycle
  ON public.client_notes (btrim(name));

-- ---------------------------------------------------------------------------
-- 2. v_admin_notes_all
--    One row per note, joined to accounts for the client link + ticker.
--    LEFT JOIN so the 25 client-less shells still appear in "All notes".
--
--    Column names are the app-facing ones: client_account_id / _name / _ticker
--    match what the other admin views call them, so the shared ticker renderer
--    works unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_admin_notes_all AS
SELECT
  cn.note_id,

  -- ---- the note ----
  -- `name` is the review CYCLE, not a title -- see the notes above.
  NULLIF(btrim(cn.name), '')                          AS review_cycle,
  -- See trap 5: lifted to Eastern midnight so date filters line up with the
  -- shared grammar, and round-trip correctly through the Eastern formatter.
  (cn.note_date::timestamp AT TIME ZONE 'America/New_York')
                                                      AS note_date,
  -- See trap 2: the _raw copy keeps its line breaks; notes_text does not.
  COALESCE(
    NULLIF(btrim(cn._raw ->> 'bcs_notes'), ''),
    NULLIF(btrim(cn.notes_text), '')
  )                                                   AS note_body,
  -- The flattened column as stored, for comparison against note_body.
  NULLIF(btrim(cn.notes_text), '')                    AS notes_text,

  -- ---- assessment (both btrim'd -- see trap 1) ----
  NULLIF(btrim(cn.status_text), '')                   AS status_text,
  NULLIF(btrim(cn.primary_risk_driver), '')           AS primary_risk_driver,

  -- ---- action ----
  NULLIF(btrim(cn.action_step), '')                   AS action_step,
  -- Staff INITIALS, sometimes several ("LW/RB"). Not a resolvable person id.
  NULLIF(btrim(cn.action_owner), '')                  AS action_owner,
  (cn.action_deadline::timestamp AT TIME ZONE 'America/New_York')
                                                      AS action_deadline,

  -- ---- links ----
  cn.client_account_id,
  cn.client_account_name,
  a.ticker_symbol                                     AS client_ticker,

  -- ---- people (all three sourced from _raw -- see trap 3) ----
  cn.owner_id,
  NULLIF(btrim(cn._raw ->> '_ownerid_value@OData.Community.Display.V1.FormattedValue'), '')
                                                      AS owner_name,
  NULLIF(cn._raw ->> '_createdby_value', '')::uuid    AS created_by_id,
  NULLIF(btrim(cn._raw ->> '_createdby_value@OData.Community.Display.V1.FormattedValue'), '')
                                                      AS created_by_name,
  NULLIF(btrim(cn._raw ->> '_modifiedby_value@OData.Community.Display.V1.FormattedValue'), '')
                                                      AS modified_by_name,

  -- ---- system ----
  -- The rolling window behind the default view. Today it selects 668 of 693:
  -- every dated note, since the archive is only seven months old. What it
  -- actually removes is the 25 undated empty shells.
  (cn.note_date >= ((now() AT TIME ZONE 'America/New_York')::date - interval '12 months'))
                                                      AS is_recent,
  -- Constant 'Active' on every live row; exposed, hidden by default.
  cn.state_label,
  cn.status_label,
  cn.created_on,
  cn.modified_on,
  cn._synced_at
FROM public.client_notes cn
LEFT JOIN public.accounts a ON a.account_id = cn.client_account_id;

GRANT SELECT ON public.v_admin_notes_all TO service_role;

-- ---------------------------------------------------------------------------
-- 3. v_admin_notes_filter_options
--    Same (kind, value, label, count) shape as the other options views, read
--    straight off public.client_notes so the dropdowns never scan the joined
--    view. Five kinds: client, status, risk, owner, cycle.
--
--    Every text kind btrims, matching the view -- otherwise "Stable" and
--    "Stable\n" would appear as two separate choices and each would return only
--    part of the rows. See trap 1.
--
--    Owners are keyed by CANONICAL user id, as on the other pages, so a person
--    with duplicate systemuser records is not split across two choices. The
--    LABEL comes out of _raw, because client_notes has no owner_name column.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_admin_notes_filter_options AS
  -- Clients, keyed by account id (two accounts could share a display name).
  SELECT
    'client'::text                                    AS kind,
    cn.client_account_id::text                        AS value,
    min(cn.client_account_name)                       AS label,
    count(*)::bigint                                  AS note_count
  FROM public.client_notes cn
  WHERE cn.client_account_id IS NOT NULL
    AND NULLIF(btrim(cn.client_account_name), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'status'::text                                    AS kind,
    btrim(cn.status_text)                             AS value,
    btrim(cn.status_text)                             AS label,
    count(*)::bigint                                  AS note_count
  FROM public.client_notes cn
  WHERE NULLIF(btrim(cn.status_text), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'risk'::text                                      AS kind,
    btrim(cn.primary_risk_driver)                     AS value,
    btrim(cn.primary_risk_driver)                     AS label,
    count(*)::bigint                                  AS note_count
  FROM public.client_notes cn
  WHERE NULLIF(btrim(cn.primary_risk_driver), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  -- The note's author. Label from _raw -- see trap 3.
  SELECT
    'owner'::text                                     AS kind,
    public.canonical_user_id(cn.owner_id)::text       AS value,
    min(btrim(cn._raw ->> '_ownerid_value@OData.Community.Display.V1.FormattedValue'))
                                                      AS label,
    count(*)::bigint                                  AS note_count
  FROM public.client_notes cn
  WHERE cn.owner_id IS NOT NULL
    AND NULLIF(btrim(cn._raw ->> '_ownerid_value@OData.Community.Display.V1.FormattedValue'), '')
        IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  -- The monthly review cycle, e.g. "Client Review - June 2026".
  SELECT
    'cycle'::text                                     AS kind,
    btrim(cn.name)                                    AS value,
    btrim(cn.name)                                    AS label,
    count(*)::bigint                                  AS note_count
  FROM public.client_notes cn
  WHERE NULLIF(btrim(cn.name), '') IS NOT NULL
  GROUP BY 1, 2;

GRANT SELECT ON public.v_admin_notes_filter_options TO service_role;

-- ---------------------------------------------------------------------------
-- 4. note_saved_views
--    Identical shape and identical rules to meeting_saved_views,
--    event_saved_views, task_saved_views and touchpoint_saved_views. The APP
--    CODE is shared (one parameterised module enforces all five), so only the
--    storage is duplicated -- see dashboard/lib/table-views/saved-views.ts.
--
--    RLS on, zero policies => only service_role reaches it. The anon key that
--    ships in the browser gets nothing. Authorisation for the service-role path
--    lives in the app; the constraints below are the database backstop.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.note_saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('system', 'personal')),
  owner_user_id uuid REFERENCES public.users(user_id),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  config        jsonb NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT note_saved_views_owner_matches_scope CHECK (
    (scope = 'system'   AND owner_user_id IS NULL) OR
    (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS note_saved_views_one_personal_default
  ON public.note_saved_views (owner_user_id)
  WHERE scope = 'personal' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS note_saved_views_one_system_default
  ON public.note_saved_views (scope)
  WHERE scope = 'system' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS note_saved_views_personal_name
  ON public.note_saved_views (owner_user_id, lower(btrim(name)))
  WHERE scope = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS note_saved_views_system_name
  ON public.note_saved_views (lower(btrim(name)))
  WHERE scope = 'system';

CREATE INDEX IF NOT EXISTS idx_note_saved_views_scope_owner
  ON public.note_saved_views (scope, owner_user_id);

DROP TRIGGER IF EXISTS note_saved_views_touch_updated_at ON public.note_saved_views;
CREATE TRIGGER note_saved_views_touch_updated_at
  BEFORE UPDATE ON public.note_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.note_saved_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_saved_views TO service_role;

-- Check it:
--   SELECT count(*) FROM public.v_admin_notes_all;                        -- 693
--   SELECT count(*) FROM public.v_admin_notes_all WHERE is_recent;        -- 668
--   SELECT count(*) FROM public.v_admin_notes_all
--     WHERE owner_name IS NOT NULL;                                       -- 693
--   SELECT count(*) FROM public.v_admin_notes_all WHERE note_body IS NOT NULL; -- 650
--
--   SELECT kind, count(*) AS options FROM public.v_admin_notes_filter_options
--     GROUP BY 1 ORDER BY 1;
--     -- client 111, cycle 9, owner 2, risk 20, status 7
--
--   -- Proof that the btrim mattered: this must return ONE row, not two.
--   SELECT value, note_count FROM public.v_admin_notes_filter_options
--     WHERE kind = 'status' AND value = 'Stable';                        -- 357

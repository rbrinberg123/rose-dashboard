-- =============================================================================
-- Patch: CRM -> Touchpoints. The fourth CRM admin table, after Meetings,
--        Events and Tasks.
-- Date: 2026-09-15
--
-- CREATES
--   1. Indexes on the filter / sort / default-view columns
--   2. v_admin_touchpoints_all            -- list + drawer view, joined to accounts
--   3. v_admin_touchpoints_filter_options -- distinct values for the five dropdowns
--   4. touchpoint_saved_views             -- saved views, same shape as the others
--
-- SECURITY. v_admin_touchpoints_all is UNSCOPED, exactly like v_admin_meetings_all,
-- v_admin_events_all and v_admin_tasks_all: it returns every client's touchpoints
-- to whoever can read it, and the page reads it with the service-role key (RLS
-- bypassed). The gate is the route -- lib/access-control.ts ADMIN_ONLY_ROUTES makes
-- /touchpoints super-user-only and NOT grantable through the Roles matrix -- plus a
-- server-side re-check in app/touchpoints/page.tsx and in every server action before
-- anything is fetched. Do not reuse this view on a row-scoped page.
--
-- ── WHAT public.touchpoints ACTUALLY IS ────────────────────────────────────
-- The mirror of the Dynamics `phonecall` entity (lib/sync/entities.ts maps
-- phonecalls -> touchpoints), relabelled because Rose logs every client contact
-- as one, not just calls. 1,141 live rows, scheduled_start spanning 2024-05-03
-- to 2026-09-15. 25 flattened columns plus _raw.
--
-- ── FIELD SOURCING NOTES (read these; three are traps) ─────────────────────
--
--   OWNER IS A TEAM, NOT A PERSON -- AND IT DUPLICATES THE CLIENT.
--   In _raw, `_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname` is the
--   literal string "team" on every row, and the formatted value is the CLIENT's
--   name: this CRM owns each phonecall by a per-account team named after the
--   account. Measured: owner_name has 142 distinct values, all of them account
--   names; it equals client_account_name on 375 of 400 sampled rows; and NONE of
--   20 probed owner_ids resolves to a public.users row.
--   So `owner_name` is NOT a staff member and filtering by it would just be a
--   second, worse Client filter. It is exposed as `owner_team_name` -- named for
--   what it is -- and is available-but-hidden in the column catalog.
--   The real person on a touchpoint is CREATED BY (23 distinct staff, 100%
--   populated), which is what the page's People filter uses instead. See the
--   note in dashboard/lib/touchpoints/filters.ts.
--
--   THERE IS NO CONTACT PERSON ANYWHERE. The brief asked for contact/investor.
--   It does not exist in this entity: `regarding_id` is the ACCOUNT on 399 of
--   400 sampled rows (`_regardingobjectid_value@...lookuplogicalname` = "account"),
--   there is no contact lookup, and the sync does not expand the activityparty
--   collections, so `from`/`to` are absent from _raw entirely. The closest thing
--   is `contact_type_label` -- WHICH ROLE was spoken to, not who: IRO / CEO / CFO
--   / Other, a MULTI-SELECT stored semicolon-joined ("CFO; IRO"), 13 distinct
--   combinations, populated on 49% of rows. It is exposed and filterable as-is.
--
--   DIRECTION IS A CONSTANT. direction_code is `true` on all 1,141 rows and the
--   Dynamics formatted value is "Outgoing". `direction_label` is derived anyway
--   (the brief asked for direction, and an inbound row would render correctly if
--   one ever arrived) but it carries no signal today, so it is NOT a default
--   column and NOT a dropdown. The column that does carry direction-ish signal is
--   status_label: Open 1,090 / Made 50 / Received 1.
--
--   OTHER CONSTANT / EMPTY FIELDS, exposed but hidden, so nobody re-derives them:
--     actual_duration_minutes  30 on every populated row (98%)
--     scheduled_end            identical to scheduled_start on every row
--     regarding_id             the account id again (see above)
--   And these _raw fields are 0% populated across all 1,141 rows, so nothing is
--   sourced from them: phonenumber, bcs_calldisposition, category, subcategory,
--   actualstart, senton, _bcs_mastercompany_value, _createdonbehalfby_value.
--
--   MODIFIED BY IS SOURCED FROM _raw. The mirror flattens created_by but not
--   modified_by, and the drawer wants both. `_modifiedby_value` and its formatted
--   value are 100% present in _raw (17 distinct people), so the view digs them
--   out. This is the ONLY _raw-sourced pair here; everything else is a real
--   column. The list query never selects _raw -- these are plain view columns by
--   the time the page sees them.
--
--   is_recent IS THE ROLLING DEFAULT-VIEW FLAG. The shared filter grammar only
--   understands `$today`, `$tomorrow` and frozen YYYY-MM-DD literals
--   (lib/table-views/query.ts resolveDateValue), so a "last 12 months" preset
--   cannot be expressed as a saved date filter without it silently freezing to
--   the day it was written. Computing the window in the VIEW keeps the default
--   genuinely rolling and needs no change to the shared machinery. 645 of 1,141
--   rows are inside it today.
--
-- SAFE TO RE-RUN.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Indexes
--    idx_touchpoints_client (client_account_id, scheduled_start DESC),
--    idx_touchpoints_owner and idx_touchpoints_modified already exist
--    (sql/01_mirror_tables.sql). These cover what this page adds: the default
--    sort, and the dropdowns that are not already served.
-- ---------------------------------------------------------------------------

-- The default sort and the rolling 12-month default view both read this column
-- on its own; the existing index leads with client_account_id and cannot serve
-- an unfiltered ORDER BY scheduled_start DESC.
CREATE INDEX IF NOT EXISTS idx_touchpoints_scheduled_start
  ON public.touchpoints (scheduled_start DESC);

-- The Type dropdown.
CREATE INDEX IF NOT EXISTS idx_touchpoints_type_label
  ON public.touchpoints (touchpoint_type_label);

-- The Contact Type dropdown.
CREATE INDEX IF NOT EXISTS idx_touchpoints_contact_type_label
  ON public.touchpoints (contact_type_label);

-- The People dropdown, which filters on created_by_id (expanded across alias
-- groups), NOT on owner_id -- see the OWNER note in the header.
CREATE INDEX IF NOT EXISTS idx_touchpoints_created_by_id
  ON public.touchpoints (created_by_id);

-- The Status dropdown, and state_label for saved views that select it alone.
CREATE INDEX IF NOT EXISTS idx_touchpoints_status_label
  ON public.touchpoints (status_label);

CREATE INDEX IF NOT EXISTS idx_touchpoints_state_label
  ON public.touchpoints (state_label);

-- ---------------------------------------------------------------------------
-- 2. v_admin_touchpoints_all
--    One row per touchpoint, joined to accounts for the client link + ticker.
--    LEFT JOIN so the 2% of rows with no account still appear.
--
--    Column names are the app-facing ones: client_account_id / _name / _ticker
--    match what v_admin_events_all and v_admin_tasks_all call them, so the shared
--    ticker renderer works unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_admin_touchpoints_all AS
SELECT
  t.touchpoint_id,

  -- ---- identity ----
  NULLIF(btrim(t.subject), '')                        AS subject,
  NULLIF(btrim(t.description), '')                    AS description,

  -- ---- classification ----
  t.touchpoint_type_label,
  -- Multi-select, semicolon-joined ("CFO; IRO"). A ROLE, never a person.
  t.contact_type_label,
  t.state_label,
  t.status_label,
  -- Constant "Outgoing" on live data; derived anyway. See the DIRECTION note.
  CASE
    WHEN t.direction_code IS TRUE  THEN 'Outgoing'
    WHEN t.direction_code IS FALSE THEN 'Incoming'
    ELSE NULL
  END                                                 AS direction_label,

  -- ---- dates ----
  -- scheduled_start is the touchpoint's date: 99% populated, 2024-05 to 2026-09.
  t.scheduled_start                                   AS touchpoint_date,
  t.scheduled_end,
  t.actual_duration_minutes                           AS duration_minutes,
  -- The rolling window behind the default view. See the is_recent note.
  (t.scheduled_start >= (now() - interval '12 months')) AS is_recent,
  t.created_on,
  t.modified_on,

  -- ---- links ----
  t.client_account_id,
  t.client_account_name,
  a.ticker_symbol                                     AS client_ticker,
  -- The account id again on 399 of 400 sampled rows; kept for auditing.
  t.regarding_id,

  -- ---- people ----
  -- CREATED BY is the actual staff member -- see the OWNER note in the header.
  t.created_by_id,
  t.created_by_name,
  -- Sourced from _raw: the mirror flattens created_by but not modified_by.
  NULLIF(btrim(t._raw ->> '_modifiedby_value@OData.Community.Display.V1.FormattedValue'), '')
                                                      AS modified_by_name,
  NULLIF(t._raw ->> '_modifiedby_value', '')::uuid    AS modified_by_id,
  -- A per-account TEAM named after the client, NOT a person. Named for what it
  -- is so nobody mistakes it for a staff column.
  t.owner_id                                          AS owner_team_id,
  t.owner_name                                        AS owner_team_name,

  -- ---- raw codes (available-but-hidden; for auditing a label) ----
  t.touchpoint_type_code,
  t.contact_type_code,
  t.state_code,
  t.status_code,
  t.direction_code,
  t._synced_at
FROM public.touchpoints t
LEFT JOIN public.accounts a ON a.account_id = t.client_account_id;

GRANT SELECT ON public.v_admin_touchpoints_all TO service_role;

-- ---------------------------------------------------------------------------
-- 3. v_admin_touchpoints_filter_options
--    Same (kind, value, label, count) shape as the meetings, events and tasks
--    options views, read straight off public.touchpoints so the dropdowns never
--    scan the joined view. Five kinds: client, type, contact_type, created_by,
--    status.
--
--    NOTE there is no `owner` kind, deliberately: owner is the per-account team
--    and such a dropdown would duplicate `client`. See the OWNER note.
--
--    created_by is keyed by CANONICAL user id -- two people in this CRM carry
--    duplicate systemuser records, and a raw-id filter would split them.
--    public.canonical_user_id falls back to the id itself when there is no alias
--    row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_admin_touchpoints_filter_options AS
  -- Clients, keyed by account id (two accounts could share a display name).
  SELECT
    'client'::text                                    AS kind,
    t.client_account_id::text                         AS value,
    min(t.client_account_name)                        AS label,
    count(*)::bigint                                  AS touchpoint_count
  FROM public.touchpoints t
  WHERE t.client_account_id IS NOT NULL
    AND NULLIF(btrim(t.client_account_name), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'type'::text                                      AS kind,
    btrim(t.touchpoint_type_label)                    AS value,
    btrim(t.touchpoint_type_label)                    AS label,
    count(*)::bigint                                  AS touchpoint_count
  FROM public.touchpoints t
  WHERE NULLIF(btrim(t.touchpoint_type_label), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  -- The whole multi-select combination is the value, because that is what the
  -- column literally holds and an `eq` filter has to match it exactly. 13 combos.
  SELECT
    'contact_type'::text                              AS kind,
    btrim(t.contact_type_label)                       AS value,
    btrim(t.contact_type_label)                       AS label,
    count(*)::bigint                                  AS touchpoint_count
  FROM public.touchpoints t
  WHERE NULLIF(btrim(t.contact_type_label), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  -- The real staff member. Keyed by CANONICAL user id -- see the note above.
  SELECT
    'created_by'::text                                AS kind,
    public.canonical_user_id(t.created_by_id)::text   AS value,
    min(t.created_by_name)                            AS label,
    count(*)::bigint                                  AS touchpoint_count
  FROM public.touchpoints t
  WHERE t.created_by_id IS NOT NULL
    AND NULLIF(btrim(t.created_by_name), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'status'::text                                    AS kind,
    btrim(t.status_label)                             AS value,
    btrim(t.status_label)                             AS label,
    count(*)::bigint                                  AS touchpoint_count
  FROM public.touchpoints t
  WHERE NULLIF(btrim(t.status_label), '') IS NOT NULL
  GROUP BY 1, 2;

GRANT SELECT ON public.v_admin_touchpoints_filter_options TO service_role;

-- ---------------------------------------------------------------------------
-- 4. touchpoint_saved_views
--    Identical shape and identical rules to meeting_saved_views,
--    event_saved_views and task_saved_views. The APP CODE is shared (one
--    parameterised module enforces all four), so only the storage is duplicated
--    -- see dashboard/lib/table-views/saved-views.ts.
--
--    RLS on, zero policies => only service_role reaches it. The anon key that
--    ships in the browser gets nothing. Authorisation for the service-role path
--    lives in the app; the constraints below are the database backstop.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.touchpoint_saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('system', 'personal')),
  owner_user_id uuid REFERENCES public.users(user_id),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  config        jsonb NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT touchpoint_saved_views_owner_matches_scope CHECK (
    (scope = 'system'   AND owner_user_id IS NULL) OR
    (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS touchpoint_saved_views_one_personal_default
  ON public.touchpoint_saved_views (owner_user_id)
  WHERE scope = 'personal' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS touchpoint_saved_views_one_system_default
  ON public.touchpoint_saved_views (scope)
  WHERE scope = 'system' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS touchpoint_saved_views_personal_name
  ON public.touchpoint_saved_views (owner_user_id, lower(btrim(name)))
  WHERE scope = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS touchpoint_saved_views_system_name
  ON public.touchpoint_saved_views (lower(btrim(name)))
  WHERE scope = 'system';

CREATE INDEX IF NOT EXISTS idx_touchpoint_saved_views_scope_owner
  ON public.touchpoint_saved_views (scope, owner_user_id);

DROP TRIGGER IF EXISTS touchpoint_saved_views_touch_updated_at ON public.touchpoint_saved_views;
CREATE TRIGGER touchpoint_saved_views_touch_updated_at
  BEFORE UPDATE ON public.touchpoint_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.touchpoint_saved_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.touchpoint_saved_views TO service_role;

-- Check it:
--   SELECT count(*) FROM public.v_admin_touchpoints_all;                  -- 1141
--   SELECT count(*) FROM public.v_admin_touchpoints_all WHERE is_recent;  -- ~645
--   SELECT kind, count(*) AS options FROM public.v_admin_touchpoints_filter_options
--     GROUP BY 1 ORDER BY 1;
--     -- client ~141, contact_type 13, created_by 23, status 3, type 6
--   SELECT count(*) FROM public.v_admin_touchpoints_all
--     WHERE modified_by_name IS NOT NULL;                                 -- 1141
--   SELECT direction_label, count(*) FROM public.v_admin_touchpoints_all
--     GROUP BY 1;                                                         -- Outgoing 1141

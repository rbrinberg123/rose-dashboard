-- =============================================================================
-- Patch: CRM -> Clients. The seventh CRM admin table, after Meetings, Events,
--        Tasks, Touches, Notes and Contacts.
-- Date: 2026-09-17
--
-- PREREQUISITE: public.accounts already exists (sql/01_mirror_tables.sql, plus
-- the provenance columns added by sql/patches/2026-09-16_flatten_raw_fields.sql).
-- This patch only adds a read layer on top of it. It creates NO columns and
-- flattens NOTHING out of `_raw`.
--
-- CREATES
--   1. Indexes on the filter / sort columns this page adds
--   2. v_admin_accounts_all             -- list + drawer view
--   3. v_admin_accounts_filter_options  -- distinct values for the 11 dropdowns
--   4. account_saved_views              -- saved views, same shape as the others
--
-- -- THIS IS NOT THE PORTFOLIO TABLE ----------------------------------------
-- /portfolio (v_client_portfolio) is the ANALYTICS rollup: active clients only,
-- joined to meetings/contracts/notes, carrying meeting counts, retainers, open
-- slots and a note status. THIS page is the RECORD itself -- every account row
-- in the CRM mirror, active and inactive, with its own flattened fields, saved
-- views and a record drawer. They answer different questions and neither
-- replaces the other. Nothing here reads or changes v_client_portfolio.
--
-- -- ONLY ALREADY-FLATTENED COLUMNS ------------------------------------------
-- Every column below is a real column on public.accounts. `_raw` is NOT read by
-- this view, and the ~40 unflattened accounts content fields (the staff-initials
-- cluster, address1_*, ...) are deliberately still absent -- that is a separate,
-- dedicated accounts flatten pass. The two DERIVED columns (region_label,
-- market_cap_label) are CASE expressions over flattened columns, copied verbatim
-- from v_client_portfolio; they read no jsonb.
--
-- -- THE ACCOUNT TEAM IS DISPLAYED, NOT DECIDED -------------------------------
-- The team name columns below are passed through from Dynamics exactly as they
-- sit on `accounts`. There is a SECOND, dashboard-owned team table
-- (public.account_team_members, sql/patches/2026-09-15_account_team_members.sql)
-- which is setup-only and wired to nothing. WHICH of the two becomes the source
-- of truth is an open question and is NOT settled here. This page shows the
-- Dynamics fields, read-only, the same ones the Portfolio and Events avatar
-- clusters already draw from.
--
-- SECURITY. v_admin_accounts_all is UNSCOPED, exactly like its six siblings: it
-- returns every client to whoever can read it, and the page reads it with the
-- service-role key (RLS bypassed). The gate is the route --
-- lib/access-control.ts ADMIN_ONLY_ROUTES makes /accounts super-user-only and
-- NOT grantable through the Roles matrix -- plus a server-side re-check in
-- app/accounts/page.tsx and in every server action before anything is fetched.
-- Do not reuse this view on a row-scoped page.
--
-- NOTE: `_raw` is deliberately NOT exposed by the list. The drawer's own
-- single-row query reads it straight off public.accounts; see
-- app/accounts/actions.ts.
--
-- SAFE TO RE-RUN.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Indexes
--    sql/01_mirror_tables.sql already created: name, ticker_symbol,
--    (state_code, status_code) and modified_on DESC. Those cover the default
--    sort ("Active clients", by name) and the Active/Inactive dropdown. What
--    follows is only what THIS page adds -- the label dropdowns and the
--    last-activity sort.
--
--    accounts is ~228 rows, so none of these changes a plan today; they are here
--    so the page does not start seq-scanning if the mirror grows an order of
--    magnitude.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_accounts_sector_label
  ON public.accounts (sector_label);

CREATE INDEX IF NOT EXISTS idx_accounts_client_status_label
  ON public.accounts (client_status_label);

CREATE INDEX IF NOT EXISTS idx_accounts_hq_country_name
  ON public.accounts (hq_country_name);

CREATE INDEX IF NOT EXISTS idx_accounts_market_cap_b
  ON public.accounts (market_cap_b);

-- The account-team dropdowns filter on the NAME columns (see the options view
-- below for why the name and not the id).
CREATE INDEX IF NOT EXISTS idx_accounts_sales_lead_primary_name
  ON public.accounts (sales_lead_primary_name);
CREATE INDEX IF NOT EXISTS idx_accounts_secondary_manager_name
  ON public.accounts (secondary_manager_name);
CREATE INDEX IF NOT EXISTS idx_accounts_associate_name
  ON public.accounts (associate_name);
CREATE INDEX IF NOT EXISTS idx_accounts_feedback_report_name
  ON public.accounts (feedback_report_name);
CREATE INDEX IF NOT EXISTS idx_accounts_logistics_coordinator_name
  ON public.accounts (logistics_coordinator_name);

-- The "most recently touched" alternate sort.
CREATE INDEX IF NOT EXISTS idx_accounts_last_touchpoint_date
  ON public.accounts (last_touchpoint_date DESC);

-- ---------------------------------------------------------------------------
-- 2. v_admin_accounts_all
--    One row per account. NO JOINS AT ALL -- the row IS the client, so unlike
--    the six sibling views there is nothing to resolve a client link against.
--    That is also why the account-team columns can be read straight off the row
--    rather than bulk-merged in the page the way app/events/page.tsx has to.
--
--    THE THREE ALIASES AT THE TOP (client_account_id / client_account_name /
--    client_ticker) are the same three names every other admin view exposes, so
--    the app's shared ticker renderer and the shared /client-detail link work
--    here unchanged. On this entity they are just the account's own id, name and
--    ticker under the app-facing names.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_admin_accounts_all AS
SELECT
  a.account_id,

  -- ---- the app-facing client triple (see the note above) ----
  a.account_id                                        AS client_account_id,
  a.name                                              AS client_account_name,
  NULLIF(btrim(a.ticker_symbol), '')                  AS client_ticker,

  -- ---- identity ----
  a.name,
  NULLIF(btrim(a.ticker_symbol), '')                  AS ticker_symbol,
  NULLIF(btrim(a.ipreo_ticker), '')                   AS ipreo_ticker,
  NULLIF(btrim(a.website_url), '')                    AS website_url,
  NULLIF(btrim(a.email), '')                          AS email,
  a.company_master_id,
  NULLIF(btrim(a.company_master_name), '')            AS company_master_name,

  -- ---- classification ----
  NULLIF(btrim(a.client_status_label), '')            AS client_status_label,
  a.client_status_code,
  NULLIF(btrim(a.sector_label), '')                   AS sector_label,
  NULLIF(btrim(a.industry_option_label), '')          AS industry_option_label,
  NULLIF(btrim(a.fs_sector), '')                      AS fs_sector,
  NULLIF(btrim(a.fs_industry), '')                    AS fs_industry,
  NULLIF(btrim(a.exchange_label), '')                 AS exchange_label,

  -- ---- size ----
  a.market_cap_b,
  -- (!) COPIED VERBATIM FROM v_client_portfolio, INCLUDING ITS NULL HANDLING.
  --     A client with NO market cap on record lands in 'Micro', not in an
  --     "Unknown" bucket. That is what Portfolio has always shown, and the two
  --     client tables disagreeing about the same client would be worse than the
  --     quirk. `market_cap_b` itself is exposed right above, so anyone who needs
  --     to tell "genuinely tiny" from "not recorded" can put that column on
  --     screen. (v_client_stats_by_market_cap uses 'Unknown' for NULL instead --
  --     that is a deliberate, pre-existing difference, not a bug introduced
  --     here.)
  CASE
    WHEN a.market_cap_b IS NULL          THEN 'Micro'
    WHEN a.market_cap_b >= 200           THEN 'Mega'
    WHEN a.market_cap_b >= 10            THEN 'Large'
    WHEN a.market_cap_b >= 2             THEN 'Mid'
    WHEN a.market_cap_b >= 0.3           THEN 'Small'
    ELSE                                       'Micro'
  END                                                 AS market_cap_label,

  -- ---- geography ----
  NULLIF(btrim(a.hq_country_name), '')                AS hq_country_name,
  -- Also copied verbatim from v_client_portfolio, so a client's region reads the
  -- same on both client tables. Note the ELSE: an unrecognised or missing
  -- country falls into EMEA rather than into its own bucket. Same quirk, same
  -- reason as above -- `hq_country_name` is exposed so the raw value is
  -- reachable.
  CASE
    WHEN a.hq_country_name IN (
      'United States','USA','US','Canada','Mexico','Bermuda','Brazil','Argentina',
      'Chile','Colombia','Peru','Venezuela','Ecuador','Bolivia','Uruguay','Paraguay',
      'Costa Rica','Panama','Guatemala','Honduras','Nicaragua','El Salvador','Cuba',
      'Dominican Republic','Puerto Rico'
    ) THEN 'Americas'
    WHEN a.hq_country_name IN (
      'Australia','Japan','Singapore','China','Hong Kong','India','South Korea',
      'New Zealand','Taiwan'
    ) THEN 'APAC'
    ELSE 'EMEA'
  END                                                 AS region_label,
  NULLIF(btrim(a.city), '')                           AS city,
  NULLIF(btrim(a.state_province), '')                 AS state_province,
  NULLIF(btrim(a.country), '')                        AS country,

  -- ---- account team (Dynamics fields, passed through, read-only) ----
  a.sales_lead_primary_id,
  NULLIF(btrim(a.sales_lead_primary_name), '')        AS sales_lead_primary_name,
  a.secondary_manager_id,
  NULLIF(btrim(a.secondary_manager_name), '')         AS secondary_manager_name,
  a.associate_id,
  NULLIF(btrim(a.associate_name), '')                 AS associate_name,
  a.feedback_report_id,
  NULLIF(btrim(a.feedback_report_name), '')           AS feedback_report_name,
  a.logistics_coordinator_id,
  NULLIF(btrim(a.logistics_coordinator_name), '')     AS logistics_coordinator_name,
  a.targeting_id,
  NULLIF(btrim(a.targeting_name), '')                 AS targeting_name,
  a.teaser_id,
  NULLIF(btrim(a.teaser_name), '')                    AS teaser_name,
  a.primary_contact_id,
  NULLIF(btrim(a.primary_contact_name), '')           AS primary_contact_name,
  a.owner_id,
  NULLIF(btrim(a.owner_name), '')                     AS owner_name,

  -- ---- engagement ----
  -- (!) THESE ARE DYNAMICS' OWN ROLLUPS, PASSED THROUGH. They are computed in
  --     the CRM, not here, and they are known to lag what public.meetings /
  --     public.events actually contain. Treat them as "what the CRM believes",
  --     which is exactly what a system-of-record page should show. Do NOT use
  --     them as a source for reporting numbers -- Portfolio computes its own
  --     counts off public.meetings for that reason.
  a.current_event_id,
  NULLIF(btrim(a.current_event_name), '')             AS current_event_name,
  a.current_project_id,
  NULLIF(btrim(a.current_project_name), '')           AS current_project_name,
  a.last_touchpoint_date,
  a.next_touchpoint_date,
  a.last_event_date,
  a.next_event_date,
  a.ongoing_event_date,
  a.last_targeting_date,
  a.last_teaser_date,
  a.days_since_last_review,
  a.original_start_date,
  a.onboarding_call,
  a.last_data_upload,
  a.teach_in,
  a.teach_in_date,
  a.shareholder_report_received_date,

  -- ---- flags ----
  a.do_not_call,
  a.ir_only,
  a.bda_peers,
  a.calendar,
  a.calendar_confirmed,
  a.distro,
  a.meeting_history_received,
  a.mgmt_review,
  a.recurring_call_scheduled,
  a.report,
  a.rep_short_interest,
  a.sh_report,

  -- ---- free text ----
  NULLIF(btrim(a.dietary_restrictions), '')           AS dietary_restrictions,
  NULLIF(btrim(a.onboarding_notes), '')               AS onboarding_notes,
  NULLIF(btrim(a.peers), '')                          AS peers,

  -- ---- status ----
  -- The toggle the default view filters on. Computed here, re-evaluated on
  -- every query, so it can never freeze into a saved filter.
  --
  -- NOTE which Active this is: accounts.state_code, the Dynamics statecode --
  -- the same field ~15 places in sql/03_views.sql already filter on. It is NOT
  -- public.account_status (the dashboard-owned flag, which is setup-only and
  -- read by nothing but /admin/account-teams), and it is NOT
  -- client_status_label, which is a separate Rose business field that disagrees
  -- with the Dynamics state on 33 accounts. Both of the others are exposed as
  -- their own columns so the disagreement is visible rather than hidden.
  (a.state_code = 0)                                  AS is_active,
  a.state_code,
  NULLIF(btrim(a.state_label), '')                    AS state_label,
  a.status_code,
  NULLIF(btrim(a.status_label), '')                   AS status_label,

  -- ---- system ----
  a.created_by_id,
  NULLIF(btrim(a.created_by_name), '')                AS created_by_name,
  a.modified_by_id,
  NULLIF(btrim(a.modified_by_name), '')               AS modified_by_name,
  a.created_on,
  a.modified_on,
  a._synced_at
FROM public.accounts a;

GRANT SELECT ON public.v_admin_accounts_all TO service_role;

-- ---------------------------------------------------------------------------
-- 3. v_admin_accounts_filter_options
--    Same (kind, value, label, count) shape as the other options views.
--
--    READ OFF v_admin_accounts_all, NOT off public.accounts -- the one options
--    view in the set that does. Two of the eleven kinds (region, market_cap) are
--    DERIVED, and a dropdown offering a bucket the list cannot match is a dead
--    option. Reading the view is what guarantees the two CASE expressions are
--    evaluated once, in one place. The cost argument that sends the sibling
--    views to the base table does not apply: accounts is ~228 rows and the view
--    joins nothing.
--
--    THE FIVE ACCOUNT-TEAM KINDS ARE KEYED ON THE NAME, NOT THE USER ID. That is
--    deliberate and it is what removes the alias-expansion step the Meetings /
--    Notes filters need: two people in this CRM carry duplicate systemuser
--    records, so filtering on an id silently returns half of someone's clients.
--    Filtering on the display name unions the duplicates for free. The trade is
--    that two DIFFERENT people sharing a name would merge -- nobody in this
--    directory does, and a name collision is visible in the dropdown whereas a
--    split id is not.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_admin_accounts_filter_options AS
  -- Active / Inactive, keyed by the Dynamics state code (0 = Active).
  SELECT
    'state'::text                                     AS kind,
    v.state_code::text                                AS value,
    COALESCE(min(v.state_label),
             CASE WHEN v.state_code = 0 THEN 'Active' ELSE 'Inactive' END) AS label,
    count(*)::bigint                                  AS account_count
  FROM public.v_admin_accounts_all v
  WHERE v.state_code IS NOT NULL
  GROUP BY 1, 2, v.state_code

  UNION ALL

  -- The Rose business field. Deliberately a SEPARATE dropdown from `state`:
  -- Current/Past is not the same question as Active/Inactive and the two
  -- disagree on 33 accounts.
  SELECT 'client_status'::text, v.client_status_label, v.client_status_label,
         count(*)::bigint
  FROM public.v_admin_accounts_all v
  WHERE v.client_status_label IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT 'sector'::text, v.sector_label, v.sector_label, count(*)::bigint
  FROM public.v_admin_accounts_all v
  WHERE v.sector_label IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT 'industry'::text, v.industry_option_label, v.industry_option_label,
         count(*)::bigint
  FROM public.v_admin_accounts_all v
  WHERE v.industry_option_label IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  -- Derived. Never NULL (the CASE has an ELSE), so no NULL guard.
  SELECT 'region'::text, v.region_label, v.region_label, count(*)::bigint
  FROM public.v_admin_accounts_all v
  GROUP BY 1, 2

  UNION ALL

  -- Derived. Never NULL either -- see the NULL-handling warning on the CASE.
  SELECT 'market_cap'::text, v.market_cap_label, v.market_cap_label, count(*)::bigint
  FROM public.v_admin_accounts_all v
  GROUP BY 1, 2

  UNION ALL

  SELECT 'account_manager'::text, v.sales_lead_primary_name, v.sales_lead_primary_name,
         count(*)::bigint
  FROM public.v_admin_accounts_all v
  WHERE v.sales_lead_primary_name IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT 'secondary'::text, v.secondary_manager_name, v.secondary_manager_name,
         count(*)::bigint
  FROM public.v_admin_accounts_all v
  WHERE v.secondary_manager_name IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT 'associate'::text, v.associate_name, v.associate_name, count(*)::bigint
  FROM public.v_admin_accounts_all v
  WHERE v.associate_name IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT 'feedback'::text, v.feedback_report_name, v.feedback_report_name,
         count(*)::bigint
  FROM public.v_admin_accounts_all v
  WHERE v.feedback_report_name IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT 'logistics'::text, v.logistics_coordinator_name, v.logistics_coordinator_name,
         count(*)::bigint
  FROM public.v_admin_accounts_all v
  WHERE v.logistics_coordinator_name IS NOT NULL
  GROUP BY 1, 2;

GRANT SELECT ON public.v_admin_accounts_filter_options TO service_role;

-- ---------------------------------------------------------------------------
-- 4. account_saved_views
--    Identical shape and identical rules to meeting_saved_views,
--    event_saved_views, task_saved_views, touchpoint_saved_views,
--    note_saved_views and contact_saved_views. The APP CODE is shared (one
--    parameterised module enforces all seven), so only the storage is duplicated
--    -- see dashboard/lib/table-views/saved-views.ts.
--
--    THE NAME. Chosen to sit with its six siblings and to stay clear of the two
--    other account-keyed owned tables: public.account_team_members (per account
--    AND role) and public.account_status (the owned Active/Inactive flag). This
--    table is per SAVED VIEW and has nothing to do with either; it never
--    references them and nothing about this page reads or writes them.
--
--    NO SEED ROW. The "Active clients" default view is a BUILT-IN, defined in
--    code at lib/accounts/spec.ts, exactly like every other entity's presets:
--    built-ins always exist, cannot be edited or deleted, and need no seeding
--    step that a fresh database could miss. This table holds only the views
--    people create themselves.
--
--    RLS on, zero policies => only service_role reaches it. The anon key that
--    ships in the browser gets nothing. Authorisation for the service-role path
--    lives in the app; the constraints below are the database backstop.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('system', 'personal')),
  owner_user_id uuid REFERENCES public.users(user_id),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  config        jsonb NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT account_saved_views_owner_matches_scope CHECK (
    (scope = 'system'   AND owner_user_id IS NULL) OR
    (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS account_saved_views_one_personal_default
  ON public.account_saved_views (owner_user_id)
  WHERE scope = 'personal' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS account_saved_views_one_system_default
  ON public.account_saved_views (scope)
  WHERE scope = 'system' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS account_saved_views_personal_name
  ON public.account_saved_views (owner_user_id, lower(btrim(name)))
  WHERE scope = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS account_saved_views_system_name
  ON public.account_saved_views (lower(btrim(name)))
  WHERE scope = 'system';

CREATE INDEX IF NOT EXISTS idx_account_saved_views_scope_owner
  ON public.account_saved_views (scope, owner_user_id);

DROP TRIGGER IF EXISTS account_saved_views_touch_updated_at ON public.account_saved_views;
CREATE TRIGGER account_saved_views_touch_updated_at
  BEFORE UPDATE ON public.account_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.account_saved_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_saved_views TO service_role;

-- Check it:
--   SELECT count(*) FROM public.v_admin_accounts_all;                  -- 228 on 2026-09-17
--   SELECT count(*) FROM public.v_admin_accounts_all WHERE is_active;  -- 107 on 2026-09-17
--
--   -- The eleven dropdowns, and how many choices each offers:
--   SELECT kind, count(*) AS options, sum(account_count) AS rows_covered
--     FROM public.v_admin_accounts_filter_options GROUP BY 1 ORDER BY 1;
--
--   -- The buckets must match Portfolio's for every ACTIVE client, or the two
--   -- client tables have drifted. Expect zero rows:
--   SELECT v.account_id, v.name, v.market_cap_label, p.market_cap_label,
--          v.region_label, p.region_label
--     FROM public.v_admin_accounts_all v
--     JOIN public.v_client_portfolio p ON p.account_id = v.account_id
--    WHERE v.market_cap_label IS DISTINCT FROM p.market_cap_label
--       OR v.region_label     IS DISTINCT FROM p.region_label;
--
--   -- How far the Dynamics state and the Rose business field disagree (the
--   -- reason they are two separate dropdowns). Expect ~33 rows:
--   SELECT state_label, client_status_label, count(*)
--     FROM public.v_admin_accounts_all
--    WHERE (state_code = 0) <> (client_status_label = 'Current')
--    GROUP BY 1, 2 ORDER BY 3 DESC;

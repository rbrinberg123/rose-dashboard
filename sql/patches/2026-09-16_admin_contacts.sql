-- =============================================================================
-- Patch: CRM -> Contacts. The sixth CRM admin table, after Meetings, Events,
--        Tasks, Touches and Notes.
-- Date: 2026-09-16
--
-- PREREQUISITE: sql/23_contacts_table.sql must have been run first (it creates
-- public.contacts). This patch only adds the read layer on top of it.
--
-- CREATES
--   1. Indexes on the filter / sort columns this page adds
--   2. v_admin_contacts_all             -- list + drawer view, joined to accounts
--   3. v_admin_contacts_filter_options  -- distinct values for the ten dropdowns
--   4. contact_saved_views              -- saved views, same shape as the others
--
-- SECURITY. v_admin_contacts_all is UNSCOPED, exactly like its five siblings: it
-- returns every contact at every client to whoever can read it, and the page
-- reads it with the service-role key (RLS bypassed). It is also the only CRM
-- table that is mostly PERSONAL data -- names, job titles, employers, and the
-- do-not-call flag -- so treat it accordingly. The gate is the route --
-- lib/access-control.ts ADMIN_ONLY_ROUTES makes /contacts super-user-only and
-- NOT grantable through the Roles matrix -- plus a server-side re-check in
-- app/contacts/page.tsx and in every server action before anything is fetched.
-- Do not reuse this view on a row-scoped page.
--
-- NOTE: `_raw` is deliberately NOT exposed by the list. The drawer's own
-- single-row query selects it explicitly; see app/contacts/actions.ts.
--
-- ── THE CLIENT LINK IS PROVISIONAL ─────────────────────────────────────────
-- public.contacts carries TWO candidate links to a client account and does not
-- yet know which is canonical (see the header of sql/23_contacts_table.sql):
--   * parent_customer_id        <- _parentcustomerid_value       ("Company Name")
--   * company_master_record_id  <- _bcs_companymasterrecord_value ("Master Company Record")
--
-- THIS VIEW USES parent_customer_id, and isolates that choice inside the
-- `link` LATERAL below so switching is a ONE-LINE change with no other edit
-- anywhere in the view or the app. Both candidates are exposed as columns
-- regardless, so the comparison query in 05-sync-and-integrations.md can be run
-- against real rows once the sync has populated the table.
--
-- parentcustomerid is POLYMORPHIC in Dynamics -- it points at either an account
-- or a contact -- so the join is guarded on parent_customer_type = 'account'.
-- Without that guard a contact whose parent is another contact could collide
-- with an account id and surface the wrong client.
--
-- ── THE TABLE MAY BE EMPTY WHEN THIS RUNS ──────────────────────────────────
-- contacts is populated by the sync, not by this patch. Every object here is
-- correct against an empty table, and the page renders an empty state rather
-- than an error (lib/table-views/query.ts availableColumns returns null for a
-- view with no rows, which means "assume every column exists").
--
-- SAFE TO RE-RUN.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Indexes
--    sql/23_contacts_table.sql already created: modified_on, parent_customer_id,
--    company_master_record_id, state_code, last_name, ticker_symbol. These cover
--    what this PAGE adds -- the default sort and the label dropdowns.
-- ---------------------------------------------------------------------------

-- The default sort ("Active contacts", most recently active first).
CREATE INDEX IF NOT EXISTS idx_contacts_last_activity_time
  ON public.contacts (last_activity_time DESC);

-- The label dropdowns.
CREATE INDEX IF NOT EXISTS idx_contacts_contact_type
  ON public.contacts (contact_type_label);
CREATE INDEX IF NOT EXISTS idx_contacts_industry
  ON public.contacts (industry_label);
CREATE INDEX IF NOT EXISTS idx_contacts_internal_assignment
  ON public.contacts (internal_assignment_label);
CREATE INDEX IF NOT EXISTS idx_contacts_lead_state
  ON public.contacts (lead_state_label);

-- ---------------------------------------------------------------------------
-- 2. v_admin_contacts_all
--    One row per contact, joined to accounts for the client link + ticker.
--    LEFT JOIN throughout, so a contact with no client -- or one whose parent is
--    another contact rather than an account -- still appears.
--
--    Column names are the app-facing ones: client_account_id / _name / _ticker
--    match what the other admin views call them, so the shared ticker renderer
--    works unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_admin_contacts_all AS
SELECT
  c.contact_id,

  -- ---- the person ----
  NULLIF(btrim(c.full_name), '')                      AS full_name,
  NULLIF(btrim(c.first_name), '')                     AS first_name,
  NULLIF(btrim(c.last_name), '')                      AS last_name,
  NULLIF(btrim(c.job_title), '')                      AS job_title,

  -- ---- client link: BOTH candidates, always exposed ----
  c.parent_customer_id,
  NULLIF(btrim(c.parent_customer_name), '')           AS parent_customer_name,
  c.parent_customer_type,
  c.company_master_record_id,
  NULLIF(btrim(c.company_master_record_name), '')     AS company_master_record_name,

  -- ---- the RESOLVED client, from whichever candidate `link` picked ----
  --      These three are what the app's shared ticker renderer reads.
  a.account_id                                        AS client_account_id,
  a.name                                              AS client_account_name,
  a.ticker_symbol                                     AS client_ticker,

  -- ---- profile ----
  NULLIF(btrim(c.contact_type_label), '')             AS contact_type_label,
  NULLIF(btrim(c.industry_label), '')                 AS industry_label,
  NULLIF(btrim(c.internal_assignment_label), '')      AS internal_assignment_label,
  NULLIF(btrim(c.lead_state_label), '')               AS lead_state_label,
  NULLIF(btrim(c.state_for_address_label), '')        AS state_for_address_label,
  NULLIF(btrim(c.previous_company), '')               AS previous_company,
  NULLIF(btrim(c.ticker_symbol), '')                  AS ticker_symbol,

  -- ---- flags ----
  c.ir_only,
  c.poc,
  c.do_not_call,
  c.distribution_list,
  c.ex_employee,

  -- ---- activity ----
  NULLIF(btrim(c.last_activity_subject), '')          AS last_activity_subject,
  NULLIF(btrim(c.last_activity_type_label), '')       AS last_activity_type_label,
  c.last_activity_time,
  -- verified_on is a plain `date`. Lifted to Eastern midnight for the same
  -- reason notes.note_date is (see sql/patches/2026-09-15_admin_notes.sql trap
  -- 5): the shared filter grammar resolves date filters to the UTC instant of an
  -- Eastern midnight, and comparing a bare date against that is four hours off.
  (c.verified_on::timestamp AT TIME ZONE 'America/New_York')
                                                      AS verified_on,

  -- ---- status ----
  -- The toggle the default view filters on. Computed here, re-evaluated on
  -- every query, so it can never freeze into a saved filter.
  (c.state_code = 0)                                  AS is_active,
  c.state_code,
  c.state_label,
  c.status_code,
  c.status_label,

  -- ---- system ----
  c.created_on,
  c.modified_on,
  c._synced_at
FROM public.contacts c

-- ═══ CLIENT LINK — THE ONE PLACE TO CHANGE ═══════════════════════════════
-- To switch the page from "Company Name" to "Master Company Record", replace
-- the single CASE expression below with:
--     SELECT c.company_master_record_id AS account_key
-- Nothing else in this view, and nothing in the app, needs to change: every
-- downstream column reads `a.*`, and the app only ever sees client_account_id /
-- client_account_name / client_ticker.
LEFT JOIN LATERAL (
  SELECT CASE
           WHEN c.parent_customer_type = 'account' THEN c.parent_customer_id
         END AS account_key
) link ON true
-- ═════════════════════════════════════════════════════════════════════════
LEFT JOIN public.accounts a ON a.account_id = link.account_key;

GRANT SELECT ON public.v_admin_contacts_all TO service_role;

-- ---------------------------------------------------------------------------
-- 3. v_admin_contacts_filter_options
--    Same (kind, value, label, count) shape as the other options views, read
--    straight off public.contacts so the dropdowns never scan the joined view.
--
--    Ten kinds: client, contact_type, industry, internal_assignment, lead_state,
--    state, and the four boolean flags.
--
--    THE BOOLEAN KINDS emit 'true'/'false' as the VALUE and Yes/No as the label;
--    lib/contacts/filters.ts converts back to a real boolean before querying.
--    They are listed as options views rather than hardcoded in the client so an
--    all-false flag simply offers no "Yes" choice instead of a dead one.
--
--    THE CLIENT KIND is keyed by parent_customer_id and deliberately does NOT
--    filter on parent_customer_type. If the type annotation were ever missing
--    the dropdown would silently empty out; filtering is on the id, which is
--    exact either way.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_admin_contacts_filter_options AS
  -- Clients, keyed by the parent-customer id (two could share a display name).
  SELECT
    'client'::text                                    AS kind,
    c.parent_customer_id::text                        AS value,
    min(btrim(c.parent_customer_name))                AS label,
    count(*)::bigint                                  AS contact_count
  FROM public.contacts c
  WHERE c.parent_customer_id IS NOT NULL
    AND NULLIF(btrim(c.parent_customer_name), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'contact_type'::text, btrim(c.contact_type_label), btrim(c.contact_type_label),
    count(*)::bigint
  FROM public.contacts c
  WHERE NULLIF(btrim(c.contact_type_label), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'industry'::text, btrim(c.industry_label), btrim(c.industry_label),
    count(*)::bigint
  FROM public.contacts c
  WHERE NULLIF(btrim(c.industry_label), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'internal_assignment'::text, btrim(c.internal_assignment_label),
    btrim(c.internal_assignment_label), count(*)::bigint
  FROM public.contacts c
  WHERE NULLIF(btrim(c.internal_assignment_label), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'lead_state'::text, btrim(c.lead_state_label), btrim(c.lead_state_label),
    count(*)::bigint
  FROM public.contacts c
  WHERE NULLIF(btrim(c.lead_state_label), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  -- Active / Inactive, keyed by the Dynamics state code (0 = Active).
  SELECT
    'state'::text,
    c.state_code::text,
    COALESCE(min(btrim(c.state_label)), CASE WHEN c.state_code = 0 THEN 'Active' ELSE 'Inactive' END),
    count(*)::bigint
  FROM public.contacts c
  WHERE c.state_code IS NOT NULL
  GROUP BY 1, 2, c.state_code

  UNION ALL

  SELECT 'ir_only'::text, c.ir_only::text,
         CASE WHEN c.ir_only THEN 'Yes' ELSE 'No' END, count(*)::bigint
  FROM public.contacts c WHERE c.ir_only IS NOT NULL GROUP BY 1, 2, c.ir_only

  UNION ALL

  SELECT 'poc'::text, c.poc::text,
         CASE WHEN c.poc THEN 'Yes' ELSE 'No' END, count(*)::bigint
  FROM public.contacts c WHERE c.poc IS NOT NULL GROUP BY 1, 2, c.poc

  UNION ALL

  SELECT 'do_not_call'::text, c.do_not_call::text,
         CASE WHEN c.do_not_call THEN 'Yes' ELSE 'No' END, count(*)::bigint
  FROM public.contacts c WHERE c.do_not_call IS NOT NULL GROUP BY 1, 2, c.do_not_call

  UNION ALL

  SELECT 'distribution_list'::text, c.distribution_list::text,
         CASE WHEN c.distribution_list THEN 'Yes' ELSE 'No' END, count(*)::bigint
  FROM public.contacts c WHERE c.distribution_list IS NOT NULL
  GROUP BY 1, 2, c.distribution_list;

GRANT SELECT ON public.v_admin_contacts_filter_options TO service_role;

-- ---------------------------------------------------------------------------
-- 4. contact_saved_views
--    Identical shape and identical rules to meeting_saved_views,
--    event_saved_views, task_saved_views, touchpoint_saved_views and
--    note_saved_views. The APP CODE is shared (one parameterised module enforces
--    all six), so only the storage is duplicated -- see
--    dashboard/lib/table-views/saved-views.ts.
--
--    NO SEED ROW. The "Active contacts" default view is a BUILT-IN, defined in
--    code at lib/contacts/spec.ts, exactly like every other entity's presets:
--    built-ins always exist, cannot be edited or deleted, and need no seeding
--    step that a fresh database could miss. This table holds only the views
--    people create themselves.
--
--    RLS on, zero policies => only service_role reaches it. The anon key that
--    ships in the browser gets nothing. Authorisation for the service-role path
--    lives in the app; the constraints below are the database backstop.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.contact_saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('system', 'personal')),
  owner_user_id uuid REFERENCES public.users(user_id),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  config        jsonb NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_saved_views_owner_matches_scope CHECK (
    (scope = 'system'   AND owner_user_id IS NULL) OR
    (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_saved_views_one_personal_default
  ON public.contact_saved_views (owner_user_id)
  WHERE scope = 'personal' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS contact_saved_views_one_system_default
  ON public.contact_saved_views (scope)
  WHERE scope = 'system' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS contact_saved_views_personal_name
  ON public.contact_saved_views (owner_user_id, lower(btrim(name)))
  WHERE scope = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS contact_saved_views_system_name
  ON public.contact_saved_views (lower(btrim(name)))
  WHERE scope = 'system';

CREATE INDEX IF NOT EXISTS idx_contact_saved_views_scope_owner
  ON public.contact_saved_views (scope, owner_user_id);

DROP TRIGGER IF EXISTS contact_saved_views_touch_updated_at ON public.contact_saved_views;
CREATE TRIGGER contact_saved_views_touch_updated_at
  BEFORE UPDATE ON public.contact_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.contact_saved_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_saved_views TO service_role;

-- Check it (all zeroes until the sync has run -- that is expected, not a fault):
--   SELECT count(*) FROM public.v_admin_contacts_all;
--   SELECT count(*) FROM public.v_admin_contacts_all WHERE is_active;
--
--   -- Does the client link actually resolve? This is THE question the page was
--   -- built to answer. Compare the two candidates against our 228 accounts:
--   SELECT
--     count(*)                                                    AS contacts,
--     count(parent_customer_id)                                   AS parent_populated,
--     count(company_master_record_id)                             AS master_populated,
--     count(client_account_id)                                    AS parent_resolves_to_account,
--     count(*) FILTER (WHERE company_master_record_id IN
--       (SELECT account_id FROM public.accounts))                 AS master_resolves_to_account
--   FROM public.v_admin_contacts_all;
--   -- If master_resolves_to_account beats parent_resolves_to_account by a wide
--   -- margin, switch the LATERAL above (one line) and re-check.
--
--   SELECT kind, count(*) AS options FROM public.v_admin_contacts_filter_options
--     GROUP BY 1 ORDER BY 1;

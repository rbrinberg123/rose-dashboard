-- =============================================================================
-- Patch: Account team for DASHBOARD-created clients -- one source of truth
-- Date:  2026-10-02
--
-- THE BUG
--   A team set on a dashboard-created client (Admin -> Account Teams) was saved
--   to public.account_team_members but showed almost nowhere. Every reader
--   except the Clients-list role columns -- the Clients "Client" avatar cluster,
--   the record drawer, the team filters, Portfolio, Client Detail, Profiles,
--   Events, and row scoping -- reads the team from the account row's own
--   lookups (accounts.sales_lead_primary_id/_name and friends). For a Dynamics
--   client the sync fills those; for a dashboard client NOTHING did, so they
--   stayed NULL and the saved team was invisible.
--
-- THE MODEL (one source of truth per origin -- the same ownership fence as
-- every other dashboard write; see docs 22-cutover-ownership-boundary.md)
--   origin = 'dashboard'  account_team_members is CANONICAL. The account row's
--                         six team lookups are a DERIVED projection of it,
--                         maintained ONLY by the trigger below -- never written
--                         by hand, by the client form, or by the sync (which
--                         never touches dashboard rows).
--   origin = 'dynamics'   the Dynamics lookups (synced) stay authoritative until
--                         cutover. Their account_team_members rows are a
--                         2026-09-15 seed copy that has since drifted (20 slots
--                         differ, 29 missing as of 2026-10-02), so they are NOT
--                         displayed. Dynamics data is never altered here.
--
--   role -> account lookup (same map as the seed and
--   lib/access/account-team-policy.ts):
--     account_manager -> sales_lead_primary_*     secondary_manager -> secondary_manager_*
--     feedback_report -> feedback_report_*        associate -> associate_*
--     memo -> teaser_*                            logistics -> logistics_coordinator_*
--
--   A role holding several people (allowed, none today) projects its first
--   person A->Z onto the single lookup; the Clients list role column still
--   shows all of them.
--
-- SIDE EFFECT (deliberate): row scoping reads these lookups, so a person set as
-- e.g. Account Manager of a dashboard client now gets that client in their
-- scoped pages -- exactly the rule Dynamics clients already follow.
--
-- Also re-points v_admin_accounts_all's team_* columns to the same model.
-- Safe to re-run.
-- =============================================================================

-- ---- 1. Projection: account_team_members -> the dashboard account row --------
CREATE OR REPLACE FUNCTION public.project_account_team(p_account_id uuid)
RETURNS void AS $$
  WITH pick AS (
    SELECT DISTINCT ON (atm.role)
      atm.role,
      atm.user_id,
      COALESCE(NULLIF(btrim(u.display_name), ''), u.email) AS name
    FROM public.account_team_members atm
    JOIN public.users u ON u.user_id = atm.user_id
    WHERE atm.account_id = p_account_id
    ORDER BY atm.role, COALESCE(NULLIF(btrim(u.display_name), ''), u.email)
  )
  UPDATE public.accounts a SET
    sales_lead_primary_id      = (SELECT user_id FROM pick WHERE role = 'account_manager'),
    sales_lead_primary_name    = (SELECT name    FROM pick WHERE role = 'account_manager'),
    secondary_manager_id       = (SELECT user_id FROM pick WHERE role = 'secondary_manager'),
    secondary_manager_name     = (SELECT name    FROM pick WHERE role = 'secondary_manager'),
    feedback_report_id         = (SELECT user_id FROM pick WHERE role = 'feedback_report'),
    feedback_report_name       = (SELECT name    FROM pick WHERE role = 'feedback_report'),
    associate_id               = (SELECT user_id FROM pick WHERE role = 'associate'),
    associate_name             = (SELECT name    FROM pick WHERE role = 'associate'),
    teaser_id                  = (SELECT user_id FROM pick WHERE role = 'memo'),
    teaser_name                = (SELECT name    FROM pick WHERE role = 'memo'),
    logistics_coordinator_id   = (SELECT user_id FROM pick WHERE role = 'logistics'),
    logistics_coordinator_name = (SELECT name    FROM pick WHERE role = 'logistics')
  WHERE a.account_id = p_account_id
    AND a.origin = 'dashboard';   -- NEVER a Dynamics row
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION public.account_team_members_project()
RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.project_account_team(OLD.account_id);
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id) THEN
    PERFORM public.project_account_team(NEW.account_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS account_team_members_project ON public.account_team_members;
CREATE TRIGGER account_team_members_project
  AFTER INSERT OR UPDATE OR DELETE ON public.account_team_members
  FOR EACH ROW EXECUTE FUNCTION public.account_team_members_project();

-- Backfill every existing dashboard client (repairs teams already saved).
SELECT public.project_account_team(account_id) FROM public.accounts WHERE origin = 'dashboard';

-- ---- 2. v_admin_accounts_all: team_* follow the same model --------------------
-- Identical to 2026-10-02_accounts_default_view.sql except the six team_*
-- expressions.
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
  -- CHANGED 2026-09-23: the PRIMARY address (Dynamics address1_*) first, then
  -- the address2_* block the mapper used to read. address2's country is typed
  -- into its COUNTY field in this CRM (address2_country is empty on every row).
  COALESCE(NULLIF(btrim(a.address1_city), ''),  NULLIF(btrim(a.city), ''))           AS city,
  COALESCE(NULLIF(btrim(a.address1_state), ''), NULLIF(btrim(a.state_province), '')) AS state_province,
  COALESCE(NULLIF(btrim(a.address1_country), ''), NULLIF(btrim(a.country), ''),
           NULLIF(btrim(a.address2_county), ''))                                     AS country,

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
  a._synced_at,

  -- ---- NEW in 2026-09-23g, appended last ----
  COALESCE(NULLIF(btrim(a.address1_line1), ''), NULLIF(btrim(a.address2_line1), ''))             AS street,
  COALESCE(NULLIF(btrim(a.address1_postal_code), ''), NULLIF(btrim(a.address2_postal_code), '')) AS postal_code,
  NULLIF(btrim(a.phone), '')                          AS phone,
  NULLIF(btrim(a.secondary_exchange_label), '')       AS secondary_exchange_label,
  NULLIF(btrim(a.hq_state_label), '')                 AS hq_state_label,
  NULLIF(btrim(a.reporting_frequency_label), '')      AS reporting_frequency_label,
  a.timezone_code,
  a.meeting_slot_minutes,
  NULLIF(btrim(a.meeting_platform_pref), '')          AS meeting_platform_pref,
  a.div_yield,
  NULLIF(btrim(a.targeting_parameters), '')           AS targeting_parameters,
  NULLIF(btrim(a.additional_notes), '')               AS additional_notes,
  a.estimates,
  a.include_admin,
  a.exclude_from_distribution,
  a.contact_ir_only,
  a.origin,
  a.is_test,

  -- ---- NEW in 2026-10-02, appended last ----
  -- Account team, one column per role: account_team_members for DASHBOARD
  -- clients (all assignees), the live Dynamics lookup for Dynamics clients
  -- (changed in 2026-10-02b).
  CASE WHEN a.origin = 'dashboard' THEN tm.team_account_manager ELSE NULLIF(btrim(a.sales_lead_primary_name), '') END AS team_account_manager,
  CASE WHEN a.origin = 'dashboard' THEN tm.team_secondary_manager ELSE NULLIF(btrim(a.secondary_manager_name), '') END AS team_secondary_manager,
  CASE WHEN a.origin = 'dashboard' THEN tm.team_feedback_report ELSE NULLIF(btrim(a.feedback_report_name), '') END AS team_feedback_report,
  CASE WHEN a.origin = 'dashboard' THEN tm.team_associate ELSE NULLIF(btrim(a.associate_name), '') END AS team_associate,
  CASE WHEN a.origin = 'dashboard' THEN tm.team_memo ELSE NULLIF(btrim(a.teaser_name), '') END AS team_memo,
  CASE WHEN a.origin = 'dashboard' THEN tm.team_logistics ELSE NULLIF(btrim(a.logistics_coordinator_name), '') END AS team_logistics,
  -- Last activity, both origins.
  tk.last_memo_at,
  tk.last_targeting_at,
  tp.last_touchpoint_at
FROM public.accounts a
LEFT JOIN (
  SELECT
    atm.account_id,
    string_agg(u.name, ', ' ORDER BY u.name) FILTER (WHERE atm.role = 'account_manager')   AS team_account_manager,
    string_agg(u.name, ', ' ORDER BY u.name) FILTER (WHERE atm.role = 'secondary_manager') AS team_secondary_manager,
    string_agg(u.name, ', ' ORDER BY u.name) FILTER (WHERE atm.role = 'feedback_report')   AS team_feedback_report,
    string_agg(u.name, ', ' ORDER BY u.name) FILTER (WHERE atm.role = 'associate')         AS team_associate,
    string_agg(u.name, ', ' ORDER BY u.name) FILTER (WHERE atm.role = 'memo')              AS team_memo,
    string_agg(u.name, ', ' ORDER BY u.name) FILTER (WHERE atm.role = 'logistics')         AS team_logistics
  FROM public.account_team_members atm
  JOIN LATERAL (
    SELECT COALESCE(NULLIF(btrim(us.display_name), ''), us.email) AS name
    FROM public.users us
    WHERE us.user_id = atm.user_id
  ) u ON true
  GROUP BY atm.account_id
) tm ON tm.account_id = a.account_id
LEFT JOIN (
  SELECT
    t.bcs_account_id                                                          AS account_id,
    max(t.actual_end) FILTER (WHERE t.bcs_task_subtype_label = 'Marketing Memo') AS last_memo_at,
    max(t.actual_end) FILTER (WHERE t.bcs_task_subtype_label = 'Targeting')      AS last_targeting_at
  FROM public.tasks t
  WHERE t.bcs_task_subtype_label IN ('Marketing Memo', 'Targeting')
    AND t.state_label IS DISTINCT FROM 'Canceled'
    AND t.bcs_account_id IS NOT NULL
  GROUP BY t.bcs_account_id
) tk ON tk.account_id = a.account_id
LEFT JOIN (
  SELECT
    p.client_account_id     AS account_id,
    max(p.scheduled_start)  AS last_touchpoint_at
  FROM public.touchpoints p
  WHERE p.client_account_id IS NOT NULL
    AND p.scheduled_start <= now()
  GROUP BY p.client_account_id
) tp ON tp.account_id = a.account_id;

GRANT SELECT ON public.v_admin_accounts_all TO service_role;

-- ---- Verify ------------------------------------------------------------------
-- Every dashboard client's own lookups now match its team table:
-- SELECT a.name, a.sales_lead_primary_name, a.secondary_manager_name,
--        v.team_account_manager, v.team_secondary_manager
--   FROM public.accounts a JOIN public.v_admin_accounts_all v USING (account_id)
--  WHERE a.origin = 'dashboard';

-- =============================================================================
-- Patch: Account Team columns -- a delimiter that can never split a name
-- Date:  2026-10-02 (c)
--
-- THE BUG
--   The Clients list drew "Scott Grossman, CFA" as TWO bubbles ("Scott Grossman"
--   + "CFA"). v_admin_accounts_all's team_* columns joined several assignees with
--   ', ', and the list's cell renderer split on ", " -- so a comma INSIDE one
--   person's name split them in two. Two users have a comma in their name today:
--   "Scott Grossman, CFA" and "# Lewis, Tyler".
--
--   The DATA was never wrong: accounts.*_name are single-person fields (one
--   lookup id + its name), written by the Dynamics sync as the full name and by
--   the 2026-10-02b trigger the same way. Nothing else splits them.
--
-- THE FIX (format rule for the team_* columns)
--   Several assignees are joined with a LINE FEED, chr(10), and every name has
--   any CR/LF replaced by a space first, so each token is guaranteed
--   delimiter-free. Commas inside names are kept. The renderer splits on the
--   same character (TEAM_NAME_SEPARATOR in lib/accounts/spec.ts). A single
--   assignee (every row today) contains no separator and is never split.
--   chr() is used rather than a backslash escape so the file has no
--   line-ending-sensitive literals.
--
-- Identical to 2026-10-02b's view except those two expressions. No data
-- change, no trigger change, no backfill needed. Safe to re-run.
-- =============================================================================

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
    string_agg(u.name, chr(10) ORDER BY u.name) FILTER (WHERE atm.role = 'account_manager')   AS team_account_manager,
    string_agg(u.name, chr(10) ORDER BY u.name) FILTER (WHERE atm.role = 'secondary_manager') AS team_secondary_manager,
    string_agg(u.name, chr(10) ORDER BY u.name) FILTER (WHERE atm.role = 'feedback_report')   AS team_feedback_report,
    string_agg(u.name, chr(10) ORDER BY u.name) FILTER (WHERE atm.role = 'associate')         AS team_associate,
    string_agg(u.name, chr(10) ORDER BY u.name) FILTER (WHERE atm.role = 'memo')              AS team_memo,
    string_agg(u.name, chr(10) ORDER BY u.name) FILTER (WHERE atm.role = 'logistics')         AS team_logistics
  FROM public.account_team_members atm
  JOIN LATERAL (
    SELECT replace(replace(COALESCE(NULLIF(btrim(us.display_name), ''), us.email), chr(13), ' '), chr(10), ' ') AS name
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

-- ---- Verify ----------------------------------------------------------------
-- SELECT name, team_account_manager, team_secondary_manager
--   FROM public.v_admin_accounts_all WHERE ticker_symbol = 'TCRM';

-- =============================================================================
-- Patch: Clients (accounts) full-field pass — flatten the intrinsic _raw-only
--        fields, fix the address source, rewrite v_admin_accounts_all
-- Date:  2026-09-23
--
-- WHY
--   Add New Client / edit makes accounts a live dashboard-authored entity, and
--   the record must be fully fillable ("form field set = drawer field set").
--   An audit of all 228 accounts' _raw found populated client-record fields
--   with NO column. The intrinsic ones are flattened here; rollups, Dynamics
--   system constants and the staff/team cluster are deliberately NOT (the
--   account-team source of truth is a separate, deferred decision).
--
--   Flattened (populated count of 228):
--     phone (telephone1, 10) · secondary_exchange_code/_label (bcs_secondaryexchange, 23)
--     hq_state_code/_label (bcs_state, 61) · reporting_frequency_code/_label (bcs_frequency, 45)
--     timezone_code (bcs_timezone, 38 = Dynamics time-zone index) · meeting_slot_minutes (bcs_mtgslots, 34)
--     meeting_platform_pref (bcs_mtgplatformpref, 36) · div_yield (bcs_divyield, 157)
--     targeting_parameters (bcs_targetingparameters, 30) · additional_notes (crdfa_additionalnotes, 55)
--     estimates (bcs_estimates, 108) · include_admin (bcs_includeadmin, 85)
--     exclude_from_distribution (bcs_excludefromdistribution, 76) · contact_ir_only (new_contactironly, 105)
--
--   ADDRESS: the mapper read address2_* only. Measured:
--     address1: line1 34 · city 159 · state 8 · postal 21 · country 11
--     address2: line1 119 · city 121 · state 114 · postal 89 · country 0 (!) · county 88
--   address2's country is typed into its COUNTY field, so the existing
--   country column was empty on every account. Flattened address1_* (the
--   Dynamics PRIMARY block) plus address2 line1/postal/county; the view now
--   shows the PRIMARY address with address2 as the fallback. The client form
--   edits the address1 (primary) block.
--
-- VIEWS
--   v_admin_accounts_all — restated from sql/patches/2026-09-17_admin_accounts.sql
--     (verified against live: same 88 columns, same order). Changed: city /
--     state_province / country now COALESCE address1 -> address2. Appended:
--     street, postal_code and the flattened fields, plus origin / is_test.
--   v_live_outreach — restated from 2026-09-23f (RUN 23f FIRST). Only change:
--     div_yield reads the new column, falling back to _raw.
--
-- ORDER — RUN THIS BEFORE THE CODE SHIPS (and after 23f)
--   mapAccount now writes these columns; without them every accounts sync fails.
--
-- Safe to re-run.
-- =============================================================================


-- ---- PART A -- columns --------------------------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS address1_line1            text,
  ADD COLUMN IF NOT EXISTS address1_city             text,
  ADD COLUMN IF NOT EXISTS address1_state            text,
  ADD COLUMN IF NOT EXISTS address1_postal_code      text,
  ADD COLUMN IF NOT EXISTS address1_country          text,
  ADD COLUMN IF NOT EXISTS address2_line1            text,
  ADD COLUMN IF NOT EXISTS address2_postal_code      text,
  ADD COLUMN IF NOT EXISTS address2_county           text,
  ADD COLUMN IF NOT EXISTS phone                     text,
  ADD COLUMN IF NOT EXISTS secondary_exchange_code   integer,
  ADD COLUMN IF NOT EXISTS secondary_exchange_label  text,
  ADD COLUMN IF NOT EXISTS hq_state_code             integer,
  ADD COLUMN IF NOT EXISTS hq_state_label            text,
  ADD COLUMN IF NOT EXISTS reporting_frequency_code  integer,
  ADD COLUMN IF NOT EXISTS reporting_frequency_label text,
  ADD COLUMN IF NOT EXISTS timezone_code             integer,
  ADD COLUMN IF NOT EXISTS meeting_slot_minutes      integer,
  ADD COLUMN IF NOT EXISTS meeting_platform_pref     text,
  ADD COLUMN IF NOT EXISTS div_yield                 numeric,
  ADD COLUMN IF NOT EXISTS targeting_parameters      text,
  ADD COLUMN IF NOT EXISTS additional_notes          text,
  ADD COLUMN IF NOT EXISTS estimates                 boolean,
  ADD COLUMN IF NOT EXISTS include_admin             boolean,
  ADD COLUMN IF NOT EXISTS exclude_from_distribution boolean,
  ADD COLUMN IF NOT EXISTS contact_ir_only           boolean;


-- ---- PART B -- backfill from _raw (dynamics accounts only) -----------------
BEGIN;
ALTER TABLE public.accounts DISABLE TRIGGER accounts_touch_synced_at;

UPDATE public.accounts SET
  address1_line1            = NULLIF(btrim(_raw ->> 'address1_line1'), ''),
  address1_city             = NULLIF(btrim(_raw ->> 'address1_city'), ''),
  address1_state            = NULLIF(btrim(_raw ->> 'address1_stateorprovince'), ''),
  address1_postal_code      = NULLIF(btrim(_raw ->> 'address1_postalcode'), ''),
  address1_country          = NULLIF(btrim(_raw ->> 'address1_country'), ''),
  address2_line1            = NULLIF(btrim(_raw ->> 'address2_line1'), ''),
  address2_postal_code      = NULLIF(btrim(_raw ->> 'address2_postalcode'), ''),
  address2_county           = NULLIF(btrim(_raw ->> 'address2_county'), ''),
  phone                     = NULLIF(btrim(_raw ->> 'telephone1'), ''),
  secondary_exchange_code   = CASE WHEN _raw ->> 'bcs_secondaryexchange' ~ '^-?[0-9]+$' THEN (_raw ->> 'bcs_secondaryexchange')::int END,
  secondary_exchange_label  = NULLIF(btrim(_raw ->> 'bcs_secondaryexchange@OData.Community.Display.V1.FormattedValue'), ''),
  hq_state_code             = CASE WHEN _raw ->> 'bcs_state' ~ '^-?[0-9]+$' THEN (_raw ->> 'bcs_state')::int END,
  hq_state_label            = NULLIF(btrim(_raw ->> 'bcs_state@OData.Community.Display.V1.FormattedValue'), ''),
  reporting_frequency_code  = CASE WHEN _raw ->> 'bcs_frequency' ~ '^-?[0-9]+$' THEN (_raw ->> 'bcs_frequency')::int END,
  reporting_frequency_label = NULLIF(btrim(_raw ->> 'bcs_frequency@OData.Community.Display.V1.FormattedValue'), ''),
  timezone_code             = CASE WHEN _raw ->> 'bcs_timezone' ~ '^-?[0-9]+$' THEN (_raw ->> 'bcs_timezone')::int END,
  meeting_slot_minutes      = CASE WHEN _raw ->> 'bcs_mtgslots' ~ '^-?[0-9]+$' THEN (_raw ->> 'bcs_mtgslots')::int END,
  meeting_platform_pref     = NULLIF(btrim(_raw ->> 'bcs_mtgplatformpref'), ''),
  div_yield                 = CASE WHEN _raw ->> 'bcs_divyield' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (_raw ->> 'bcs_divyield')::numeric END,
  targeting_parameters      = NULLIF(btrim(_raw ->> 'bcs_targetingparameters'), ''),
  additional_notes          = NULLIF(btrim(_raw ->> 'crdfa_additionalnotes'), ''),
  estimates                 = CASE lower(NULLIF(btrim(_raw ->> 'bcs_estimates'), '')) WHEN 'true' THEN true WHEN 'false' THEN false END,
  include_admin             = CASE lower(NULLIF(btrim(_raw ->> 'bcs_includeadmin'), '')) WHEN 'true' THEN true WHEN 'false' THEN false END,
  exclude_from_distribution = CASE lower(NULLIF(btrim(_raw ->> 'bcs_excludefromdistribution'), '')) WHEN 'true' THEN true WHEN 'false' THEN false END,
  contact_ir_only           = CASE lower(NULLIF(btrim(_raw ->> 'new_contactironly'), '')) WHEN 'true' THEN true WHEN 'false' THEN false END
WHERE _raw IS NOT NULL
  AND origin = 'dynamics';

ALTER TABLE public.accounts ENABLE TRIGGER accounts_touch_synced_at;
COMMIT;


-- ---- PART C -- v_admin_accounts_all -------------------------------------------
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
  a.is_test
FROM public.accounts a;

GRANT SELECT ON public.v_admin_accounts_all TO service_role;


-- ---- PART D -- v_live_outreach (div_yield from the column) -----------------
CREATE OR REPLACE VIEW public.v_live_outreach AS
SELECT
  e.event_id,
  e.name                                          AS event_name,
  e.client_account_id,
  COALESCE(e.client_account_name, a.name)         AS client_account_name,
  COALESCE(a.ticker_symbol, e.client_ticker)      AS ticker,
  a.industry_option_label                         AS industry,
  -- CHANGED 2026-09-23g: the flattened column (settable on dashboard clients), _raw fallback.
  COALESCE(a.div_yield, NULLIF(a._raw ->> 'bcs_divyield', '')::numeric) AS div_yield,
  a.market_cap_b,
  e.sales_lead_primary_name                       AS sales_lead_name,
  e.urgency_label                                 AS urgency,
  (e.of_slots - COALESCE(cm.cnt, 0))              AS slots_remaining,
  e.of_slots,
  e.dates                                         AS event_dates,
  e.event_location,
  CASE
    WHEN e.event_location ILIKE '%virtual%' AND e.event_location ILIKE '%live%' THEN 'Hybrid'
    WHEN e.event_location ILIKE '%virtual%' THEN 'Virtual'
    WHEN e.event_location ILIKE '%live%'    THEN 'Live'
    ELSE NULL
  END                                             AS event_mode,
  -- Canonical client health flag (At Risk / Stable / Lost / New Client / Strong),
  -- computed the SAME way v_client_portfolio.recent_note does: "last non-blank
  -- status wins" — the client's most-recent client_notes row THAT ACTUALLY SET a
  -- status, normalized to one of the five canonical flags. A newer note with a
  -- blank status is ignored here (it does not clear the flag). Sourcing it
  -- identically keeps "At Risk" meaning the same thing here as on the Portfolio
  -- page. NULL when the client has never had a note with a non-blank status.
  ns.note_status                                  AS client_status_label,
  -- Earliest contract start for this client (any contract state), and the derived
  -- "new client" flag: a contract began within the last 6 months. Together they
  -- drive the Live Outreach priority tier and the "New Client" flag.
  ec.earliest_contract_start,
  (ec.earliest_contract_start IS NOT NULL
     AND ec.earliest_contract_start >= (CURRENT_DATE - INTERVAL '6 months')) AS is_new_client,
  COALESCE(cm.cnt, 0)                             AS confirmed_meeting_count,
  COALESCE(cm.meetings, '[]'::jsonb)              AS confirmed_meetings
FROM public.events e
LEFT JOIN public.accounts a ON a.account_id = e.client_account_id
-- Latest NON-BLANK client-note status flag (mirrors v_client_portfolio's
-- recent_note CTE, one client at a time). Same ranking (note_date, then
-- modified_on, then created_on — all DESC), but restricted to notes that actually
-- set a status, so a newer blank note does not clear the flag and the value agrees
-- with the Portfolio page.
LEFT JOIN LATERAL (
  SELECT s.note_status
  FROM (
    SELECT
      CASE
        WHEN lower(btrim(n.status_text)) LIKE 'at risk%'    THEN 'At Risk'
        WHEN lower(btrim(n.status_text)) LIKE 'stable%'     THEN 'Stable'
        WHEN lower(btrim(n.status_text)) LIKE 'lost%'       THEN 'Lost'
        WHEN lower(btrim(n.status_text)) LIKE 'new client%' THEN 'New Client'
        WHEN lower(btrim(n.status_text)) LIKE 'strong%'     THEN 'Strong'
        ELSE NULLIF(btrim(n.status_text, E' \t\n\r'), '')
      END AS note_status,
      n.note_date,
      n.modified_on,
      n.created_on
    FROM public.client_notes n
    WHERE n.client_account_id = e.client_account_id
  ) s
  WHERE s.note_status IS NOT NULL   -- only notes that actually set a status
  ORDER BY s.note_date DESC, s.modified_on DESC NULLS LAST, s.created_on DESC NULLS LAST
  LIMIT 1
) ns ON true
-- Earliest contract start across ALL of the client's contracts (any state).
LEFT JOIN LATERAL (
  SELECT MIN(k.contract_start_date) AS earliest_contract_start
  FROM public.contracts k
  WHERE k.client_account_id = e.client_account_id
) ec ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS cnt,
    jsonb_agg(
      jsonb_build_object(
        'meeting_id',       m.meeting_id,
        'meeting_date',     m.meeting_date,
        'institution_name', m.institution_name,
        'contact',          m.investor_text,
        'created_on',       m.created_on
      )
      ORDER BY m.meeting_date
    ) AS meetings
  FROM public.meetings m
  WHERE m.event_id = e.event_id
    AND m.meeting_status_label = 'Confirmed'
) cm ON true
WHERE e.event_state_label = 'Live Outreach'
  -- Exclude deactivated events. state_label is the Dataverse statecode
  -- ('Active' = 0 / 'Inactive' = 1), distinct from the event_state_label
  -- workflow field above. Only Active events should appear on the page.
  AND e.state_label = 'Active'
  -- Exclude Mining events. bcs_mining is a Dynamics Yes/No toggle on the event,
  -- added 2026-09-21; it is null/absent on events not yet re-synced since, so
  -- COALESCE treats null / missing / blank as false and only events explicitly
  -- ticked Mining = Yes are dropped. Activates automatically as the team ticks
  -- the box (ticking modifies the event, so the incremental sync refetches it).
  -- CHANGED 2026-09-23: read the flattened `mining` column (settable on
  -- dashboard events), falling back to _raw for any row the backfill missed.
  AND COALESCE(e.mining, NULLIF(e._raw ->> 'bcs_mining', '')::boolean, false) = false
ORDER BY a.ticker_symbol NULLS LAST, e.name;


-- ---- CHECK IT (run by hand after the patch) ---------------------------------
-- 1. Backfill coverage. Expect roughly: address1_city 159, address2_line1 119,
--    phone 10, div_yield 157, additional_notes 55, estimates 108.
--
-- SELECT count(address1_city) a1_city, count(address2_line1) a2_line1, count(phone) phone,
--        count(div_yield) div_yield, count(additional_notes) notes, count(estimates) estimates
-- FROM public.accounts;
--
-- 2. Same row count in the view as the table.
--
-- SELECT count(*) FROM public.v_admin_accounts_all;
-- SELECT count(*) FROM public.accounts;
--
-- 3. Address now resolves on more clients (was 121 city / 114 state / 0 country).
--
-- SELECT count(city) city, count(state_province) state, count(country) country, count(street) street
-- FROM public.v_admin_accounts_all;
--
-- 4. Live Outreach unchanged by this patch (compare with the count before PART D).
--
-- SELECT count(*) FROM public.v_live_outreach;

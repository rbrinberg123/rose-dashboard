-- =============================================================================
-- Patch: client status = the EFFECTIVE Client Health rating
-- Date:  2026-10-15
--
-- WHAT
--   A client's status everywhere in the app is now its effective Client Health
--   rating: client_health_assessments.override_rating ?? ai_rating, the final
--   value the Client Health page shows. Codes: '3' High Risk, '2' Monitor,
--   'Management / IR Change', '1' Healthy; NULL = No Rating.
--
--   The old notes-driven status (latest client_notes.status_text normalised to
--   At Risk / Lost / New Client / Stable / Strong) is RETIRED from these views.
--
--   1. v_client_portfolio: APPENDS health_rating. The recent_note CTE is
--      removed; note_status / note_status_date stay in place (so CREATE OR
--      REPLACE needs no DROP) but are now always NULL and unread by the app.
--   2. v_live_outreach: APPENDS health_rating. The notes lateral join is
--      removed; client_status_label stays in place, always NULL, unread.
--   3. v_client_stats_by_status: the Client Statistics donut now buckets by
--      health_rating in the Client Health order (High Risk, Monitor,
--      Management / IR Change, Healthy, then No Rating). Same columns as before
--      (bucket, count, display_order); bucket is now the rating CODE, or
--      'No Rating'.
--
-- WHAT IT DOES NOT DO
--   No data changes, no drops. client_notes.status_text (the history) is
--   untouched, and so is v_client_detail_recent_note (the Client Detail note
--   card still shows each note's own recorded status as history).
--   accounts.client_status_label (Current / Past) is unrelated and untouched.
--
-- The two view bodies are copied from their latest patches
-- (2026-09-22_portfolio_meetings_ytd.sql, 2026-09-23g_accounts_full_fields.sql
-- PART D). If the live view has drifted from those files, CREATE OR REPLACE
-- fails with "cannot change name of view column" and, because everything runs
-- in one transaction, nothing is changed. Report the error rather than forcing it.
--
-- SAFE TO RE-RUN. Run ONCE in the Supabase SQL editor.
-- See dashboard/content/docs/29-client-status.md.
-- =============================================================================

BEGIN;

-- ---- 1. v_client_portfolio --------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_portfolio AS
WITH meeting_agg AS (
  SELECT
    client_account_id,
    COUNT(*) FILTER (
      WHERE meeting_date >= CURRENT_DATE - interval '365 days'
        AND meeting_date <= CURRENT_DATE
    ) AS meetings_last_365d,
    COUNT(*) FILTER (
      WHERE meeting_date >= date_trunc('year', CURRENT_DATE)
        AND meeting_date <= CURRENT_DATE
    ) AS meetings_ytd,
    COUNT(*) FILTER (
      WHERE meeting_date >= CURRENT_DATE - interval '90 days'
        AND meeting_date <= CURRENT_DATE
    ) AS meetings_last_90d,
    COUNT(*) FILTER (
      WHERE meeting_date > now()
        AND meeting_date <= now() + interval '3 months'
    ) AS meetings_next_3m,
    COUNT(DISTINCT institution_name) FILTER (
      WHERE meeting_date >= CURRENT_DATE - interval '365 days'
        AND meeting_date <= CURRENT_DATE
        AND institution_name IS NOT NULL
    ) AS unique_institutions_last_365d,
    MAX(meeting_date) FILTER (WHERE meeting_date <= CURRENT_DATE) AS last_meeting_date,
    MIN(meeting_date) FILTER (
      WHERE (meeting_date AT TIME ZONE 'America/New_York')::date
              >= (now() AT TIME ZONE 'America/New_York')::date
    ) AS next_meeting_date
  FROM public.meetings
  WHERE meeting_status_label = 'Confirmed'
  GROUP BY client_account_id
),
client_institution AS (
  SELECT
    client_account_id,
    institution_name,
    COUNT(*)::int AS pair_meetings
  FROM public.meetings
  WHERE meeting_status_label = 'Confirmed'
    AND client_account_id IS NOT NULL
    AND institution_name IS NOT NULL
  GROUP BY client_account_id, institution_name
),
intro_agg AS (
  SELECT
    client_account_id,
    COUNT(*)::int                          AS intro_meetings,
    (SUM(pair_meetings) - COUNT(*))::int   AS followup_meetings
  FROM client_institution
  GROUP BY client_account_id
),
event_confirmed AS (
  SELECT event_id, COUNT(*)::int AS confirmed_meetings
  FROM public.meetings
  WHERE meeting_status_label = 'Confirmed'
    AND event_id IS NOT NULL
  GROUP BY event_id
),
open_slot_agg AS (
  SELECT
    e.client_account_id,
    SUM(GREATEST(e.of_slots - COALESCE(ec.confirmed_meetings, 0), 0))::int AS open_slots
  FROM public.events e
  LEFT JOIN event_confirmed ec ON ec.event_id = e.event_id
  WHERE e.state_label = 'Active'
    AND e.event_state_label IN ('Pre-Launch', 'Live Outreach', 'Meetings Ongoing')
    AND e.client_account_id IS NOT NULL
    AND e.of_slots IS NOT NULL
  GROUP BY e.client_account_id
),
recent_contract AS (
  SELECT DISTINCT ON (client_account_id)
    client_account_id,
    quarterly_retainer
  FROM public.contracts
  WHERE state_code = 0
  ORDER BY client_account_id, contract_start_date DESC
)
SELECT
  a.account_id,
  a.name,
  a.ticker_symbol,
  a.sales_lead_primary_name,

  a.market_cap_b,
  CASE
    WHEN a.market_cap_b IS NULL          THEN 'Micro'
    WHEN a.market_cap_b >= 200           THEN 'Mega'
    WHEN a.market_cap_b >= 10            THEN 'Large'
    WHEN a.market_cap_b >= 2             THEN 'Mid'
    WHEN a.market_cap_b >= 0.3           THEN 'Small'
    ELSE                                       'Micro'
  END AS market_cap_label,

  a.hq_country_name,
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
  END AS region_label,

  a.sector_label,

  rc.quarterly_retainer,
  CASE WHEN rc.quarterly_retainer IS NOT NULL
       THEN rc.quarterly_retainer * 4
       ELSE NULL END AS annualized_retainer,

  COALESCE(ma.meetings_last_365d, 0)::int            AS meetings_last_365d,
  COALESCE(ma.meetings_last_90d, 0)::int             AS meetings_last_90d,
  COALESCE(ma.unique_institutions_last_365d, 0)::int AS unique_institutions_last_365d,
  ma.last_meeting_date::date                         AS last_meeting_date,

  a.last_event_date::date       AS last_event_date,
  a.last_touchpoint_date::date  AS last_note_date,

  a.state_label AS account_state,

  -- RETIRED 2026-10-15 (notes-driven status). Kept as NULL columns so this view
  -- can still be replaced without a DROP; the app reads health_rating instead.
  NULL::text AS note_status,
  NULL::date AS note_status_date,

  COALESCE(ma.meetings_next_3m, 0)::int AS meetings_next_3m,

  COALESCE(os.open_slots, 0)::int        AS open_slots,
  COALESCE(ia.intro_meetings, 0)::int    AS intro_meetings,
  COALESCE(ia.followup_meetings, 0)::int AS followup_meetings,

  ma.next_meeting_date::date AS next_meeting_date,

  COALESCE(ma.meetings_ytd, 0)::int AS meetings_ytd,

  -- APPENDED (2026-10-15). The client's status: the EFFECTIVE Client Health
  -- rating (override wins over AI). NULL = No Rating. Must stay at the end.
  COALESCE(cha.override_rating, cha.ai_rating) AS health_rating

FROM public.accounts a
LEFT JOIN meeting_agg ma ON ma.client_account_id = a.account_id
LEFT JOIN recent_contract rc ON rc.client_account_id = a.account_id
LEFT JOIN intro_agg ia ON ia.client_account_id = a.account_id
LEFT JOIN open_slot_agg os ON os.client_account_id = a.account_id
LEFT JOIN public.client_health_assessments cha ON cha.account_id = a.account_id
WHERE a.state_label = 'Active';


-- ---- 2. v_live_outreach -----------------------------------------------------
CREATE OR REPLACE VIEW public.v_live_outreach AS
SELECT
  e.event_id,
  e.name                                          AS event_name,
  e.client_account_id,
  COALESCE(e.client_account_name, a.name)         AS client_account_name,
  COALESCE(a.ticker_symbol, e.client_ticker)      AS ticker,
  a.industry_option_label                         AS industry,
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
  -- RETIRED 2026-10-15 (notes-driven status). Kept as a NULL column so this
  -- view can still be replaced without a DROP; the app reads health_rating.
  NULL::text                                      AS client_status_label,
  ec.earliest_contract_start,
  (ec.earliest_contract_start IS NOT NULL
     AND ec.earliest_contract_start >= (CURRENT_DATE - INTERVAL '6 months')) AS is_new_client,
  COALESCE(cm.cnt, 0)                             AS confirmed_meeting_count,
  COALESCE(cm.meetings, '[]'::jsonb)              AS confirmed_meetings,
  -- APPENDED (2026-10-15). Effective Client Health rating (override wins over
  -- AI); '3' = High Risk feeds the "High Priority" flag. Must stay at the end.
  COALESCE(cha.override_rating, cha.ai_rating)    AS health_rating
FROM public.events e
LEFT JOIN public.accounts a ON a.account_id = e.client_account_id
LEFT JOIN public.client_health_assessments cha ON cha.account_id = e.client_account_id
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
  AND e.state_label = 'Active'
  AND COALESCE(e.mining, NULLIF(e._raw ->> 'bcs_mining', '')::boolean, false) = false
ORDER BY a.ticker_symbol NULLS LAST, e.name;


-- ---- 3. v_client_stats_by_status ---------------------------------------------
CREATE OR REPLACE VIEW public.v_client_stats_by_status AS
SELECT
  COALESCE(p.health_rating, 'No Rating'::text) AS bucket,
  COUNT(*)::int AS count,
  CASE COALESCE(p.health_rating, 'No Rating'::text)
    WHEN '3'                      THEN 1   -- High Risk
    WHEN '2'                      THEN 2   -- Monitor
    WHEN 'Management / IR Change' THEN 3
    WHEN '1'                      THEN 4   -- Healthy
    WHEN 'No Rating'              THEN 99
    ELSE 50
  END AS display_order
FROM public.v_client_portfolio p
GROUP BY COALESCE(p.health_rating, 'No Rating'::text)
ORDER BY display_order;

COMMIT;

-- ---- CHECK IT (run by hand) ---------------------------------------------------
-- 1. Every active client shows the same rating as the Client Health page.
--    EXPECT ZERO ROWS.
-- SELECT p.name, p.health_rating, COALESCE(c.override_rating, c.ai_rating) AS ch
-- FROM public.v_client_portfolio p
-- LEFT JOIN public.client_health_assessments c ON c.account_id = p.account_id
-- WHERE p.health_rating IS DISTINCT FROM COALESCE(c.override_rating, c.ai_rating);
--
-- 2. The donut sums to the active client count.
-- SELECT bucket, count FROM public.v_client_stats_by_status;
-- SELECT count(*) FROM public.v_client_portfolio;

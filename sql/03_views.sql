-- =============================================================================
-- 03_views.sql
--
-- Computed views that power each dashboard surface.
-- Run after 01_mirror_tables.sql and 02_rose_owned_tables.sql.
-- =============================================================================

DROP VIEW IF EXISTS public.v_client_statistics CASCADE;
DROP VIEW IF EXISTS public.v_pipeline_30d CASCADE;
DROP VIEW IF EXISTS public.v_contract_renewals CASCADE;
DROP VIEW IF EXISTS public.v_feedback_overall CASCADE;
DROP VIEW IF EXISTS public.v_feedback_by_analyst CASCADE;
DROP VIEW IF EXISTS public.v_feedback_by_client CASCADE;
DROP VIEW IF EXISTS public.v_analyst_activity CASCADE;
DROP VIEW IF EXISTS public.v_client_portfolio CASCADE;
DROP VIEW IF EXISTS public.v_client_quarterly_pnl CASCADE;
DROP VIEW IF EXISTS public.v_meeting_costs CASCADE;
DROP VIEW IF EXISTS public.v_productivity_detail_summary CASCADE;
DROP VIEW IF EXISTS public.v_analyst_monthly_activity CASCADE;
DROP VIEW IF EXISTS public.v_productivity_detail_institutions CASCADE;
DROP VIEW IF EXISTS public.v_contract_management CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_summary CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_quarterly CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_top_institutions CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_institutions CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_reach_depth CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_top_hosts CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_recent_meetings CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_active_contract CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_recent_note CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_touchpoints CASCADE;
DROP VIEW IF EXISTS public.v_institution_summary CASCADE;
DROP VIEW IF EXISTS public.v_institution_detail_summary CASCADE;
DROP VIEW IF EXISTS public.v_institution_detail_quarterly CASCADE;
DROP VIEW IF EXISTS public.v_institution_detail_top_clients CASCADE;
DROP VIEW IF EXISTS public.v_institution_detail_style CASCADE;
DROP VIEW IF EXISTS public.v_institution_detail_top_hosts CASCADE;
DROP VIEW IF EXISTS public.v_institution_detail_recent_meetings CASCADE;
DROP VIEW IF EXISTS public.v_relationships CASCADE;
DROP VIEW IF EXISTS public.v_productivity_person_meeting CASCADE;
DROP VIEW IF EXISTS public.v_productivity_person_manager_stats CASCADE;


-- -----------------------------------------------------------------------------
-- v_meeting_costs
-- Per-meeting labor cost using the salary schedule and cost assumptions
-- in effect on the meeting date.
--
-- Cost formula:
--   loaded_annual = (salary + bonus) * benefits_multiplier
--   hourly        = loaded_annual / work_hours_per_year
--   booker_cost   = booker_hourly * booker_hours_per_meeting_base
--                   (no in-person premium — booking effort is the same
--                    whether the meeting ends up live or virtual)
--   host_cost     = host_hourly * host_hours_per_meeting_base
--                   * (in_person_multiplier if is_in_person else 1.0)
--   meeting_cost  = booker_cost + host_cost
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_meeting_costs AS
WITH params AS (
  SELECT * FROM public.cost_assumptions WHERE id = 1
),
booker_salary AS (
  SELECT
    m.meeting_id,
    s.annual_salary,
    s.annual_bonus,
    s.benefits_multiplier
  FROM public.meetings m
  LEFT JOIN public.salary_schedule s
    ON s.user_id = m.booker_id
    AND m.meeting_date::date >= s.effective_from
    AND m.meeting_date::date <= COALESCE(s.effective_to, DATE '9999-12-31')
),
host_salary AS (
  SELECT
    m.meeting_id,
    s.annual_salary,
    s.annual_bonus,
    s.benefits_multiplier
  FROM public.meetings m
  LEFT JOIN public.salary_schedule s
    ON s.user_id = m.host_id
    AND m.meeting_date::date >= s.effective_from
    AND m.meeting_date::date <= COALESCE(s.effective_to, DATE '9999-12-31')
)
SELECT
  m.meeting_id,
  m.meeting_date,
  m.client_account_id,
  m.client_account_name,
  m.booker_id,
  m.booker_name,
  m.host_id,
  m.host_name,
  m.is_in_person,
  m.meeting_status_label,

  EXTRACT(YEAR FROM m.meeting_date)::int AS period_year,
  EXTRACT(QUARTER FROM m.meeting_date)::int AS period_quarter,

  -- Booker cost — no in-person premium, booking effort is format-agnostic.
  CASE
    WHEN bs.annual_salary IS NULL THEN 0
    ELSE
      ((bs.annual_salary + bs.annual_bonus) * bs.benefits_multiplier
        / p.work_hours_per_year)
      * p.booker_hours_per_meeting_base
  END AS booker_cost,

  -- Host cost — gets the in-person multiplier (travel + attendance).
  CASE
    WHEN hs.annual_salary IS NULL THEN 0
    ELSE
      ((hs.annual_salary + hs.annual_bonus) * hs.benefits_multiplier
        / p.work_hours_per_year)
      * p.host_hours_per_meeting_base
      * (CASE WHEN m.is_in_person THEN p.in_person_multiplier ELSE 1.0 END)
  END AS host_cost,

  -- Total meeting cost (booker + host, keeping the asymmetric multiplier
  -- application in both inlined expressions).
  COALESCE(
    CASE
      WHEN bs.annual_salary IS NULL THEN 0
      ELSE
        ((bs.annual_salary + bs.annual_bonus) * bs.benefits_multiplier
          / p.work_hours_per_year)
        * p.booker_hours_per_meeting_base
    END, 0)
  +
  COALESCE(
    CASE
      WHEN hs.annual_salary IS NULL THEN 0
      ELSE
        ((hs.annual_salary + hs.annual_bonus) * hs.benefits_multiplier
          / p.work_hours_per_year)
        * p.host_hours_per_meeting_base
        * (CASE WHEN m.is_in_person THEN p.in_person_multiplier ELSE 1.0 END)
    END, 0)
  AS meeting_cost,

  -- Flags for exception reporting
  (bs.annual_salary IS NULL AND m.booker_id IS NOT NULL) AS booker_missing_salary,
  (hs.annual_salary IS NULL AND m.host_id   IS NOT NULL) AS host_missing_salary,
  (m.booker_id IS NULL) AS booker_missing,
  (m.host_id   IS NULL) AS host_missing
FROM public.meetings m
LEFT JOIN booker_salary bs ON bs.meeting_id = m.meeting_id
LEFT JOIN host_salary   hs ON hs.meeting_id = m.meeting_id
CROSS JOIN params p;


-- -----------------------------------------------------------------------------
-- v_client_quarterly_pnl
-- The margin view. One row per (client, year, quarter).
--
-- Pipeline:
--   1. Compute revenue (contracts active during the quarter + revenue overrides)
--   2. Sum meeting labor cost from v_meeting_costs
--   3. Sum direct costs from client_direct_costs
--   4. Allocate overhead:
--      a. Apply explicit overrides (fixed_amount or percent_of_total)
--      b. Distribute remainder among non-override clients by meeting share
--      c. Clients with zero meetings AND no override get $0 (flagged)
--   5. margin = revenue - labor - direct - overhead
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_client_quarterly_pnl AS
WITH
-- Build the universe of (client, year, quarter) combinations we care about.
-- Source: any client that has revenue, costs, meetings, or an override in a quarter.
periods AS (
  SELECT DISTINCT
    EXTRACT(YEAR FROM meeting_date)::int AS period_year,
    EXTRACT(QUARTER FROM meeting_date)::int AS period_quarter,
    client_account_id
  FROM public.meetings
  WHERE meeting_date IS NOT NULL AND client_account_id IS NOT NULL
  UNION
  SELECT
    EXTRACT(YEAR FROM cost_date)::int,
    EXTRACT(QUARTER FROM cost_date)::int,
    client_account_id
  FROM public.client_direct_costs
  UNION
  SELECT period_year, period_quarter, client_account_id
  FROM public.overhead_overrides
  UNION
  SELECT period_year, period_quarter, client_account_id
  FROM public.revenue_overrides
  UNION
  -- All active contracts: emit one row per client per quarter the contract is active
  SELECT
    EXTRACT(YEAR FROM gs)::int,
    EXTRACT(QUARTER FROM gs)::int,
    c.client_account_id
  FROM public.contracts c,
    LATERAL generate_series(
      date_trunc('quarter', c.contract_start_date),
      date_trunc('quarter', COALESCE(
        c.contract_termination_date,
        c.contract_renewal_date,
        CURRENT_DATE
      )),
      interval '3 months'
    ) gs
  WHERE c.client_account_id IS NOT NULL
    AND c.contract_start_date IS NOT NULL
),
-- Revenue from active contracts in quarter
contract_revenue AS (
  SELECT
    p.period_year,
    p.period_quarter,
    p.client_account_id,
    SUM(COALESCE(c.quarterly_retainer, 0)) AS contract_revenue
  FROM periods p
  LEFT JOIN public.contracts c ON c.client_account_id = p.client_account_id
    AND c.contract_start_date <=
        (make_date(p.period_year, p.period_quarter*3, 1)
         + interval '1 month' - interval '1 day')::date
    AND COALESCE(c.contract_termination_date, c.contract_renewal_date, DATE '9999-12-31') >=
        make_date(p.period_year, (p.period_quarter-1)*3 + 1, 1)
    AND c.state_code = 0
  GROUP BY p.period_year, p.period_quarter, p.client_account_id
),
-- Revenue overrides (manual adjustments)
revenue_adj AS (
  SELECT period_year, period_quarter, client_account_id,
         SUM(adjustment_amount) AS adj
  FROM public.revenue_overrides
  GROUP BY period_year, period_quarter, client_account_id
),
-- Labor cost from meetings
labor_cost AS (
  SELECT
    period_year,
    period_quarter,
    client_account_id,
    SUM(meeting_cost) AS labor_cost,
    COUNT(*) AS meeting_count,
    bool_or(booker_missing_salary OR host_missing_salary) AS has_missing_salary
  FROM public.v_meeting_costs
  WHERE client_account_id IS NOT NULL
  GROUP BY period_year, period_quarter, client_account_id
),
-- Direct costs
direct_cost AS (
  SELECT
    EXTRACT(YEAR FROM cost_date)::int AS period_year,
    EXTRACT(QUARTER FROM cost_date)::int AS period_quarter,
    client_account_id,
    SUM(amount) AS direct_cost
  FROM public.client_direct_costs
  GROUP BY 1, 2, 3
),
-- Overhead overrides resolved to dollar amounts
overrides_resolved AS (
  SELECT
    o.period_year,
    o.period_quarter,
    o.client_account_id,
    COALESCE(o.fixed_amount, o.percent_of_total * op.total_overhead_amount, 0) AS override_amount
  FROM public.overhead_overrides o
  LEFT JOIN public.overhead_periods op
    ON op.period_year = o.period_year AND op.period_quarter = o.period_quarter
),
-- For each quarter: total override amount and remaining overhead pot
quarter_overhead AS (
  SELECT
    op.period_year,
    op.period_quarter,
    op.total_overhead_amount,
    COALESCE((
      SELECT SUM(override_amount)
      FROM overrides_resolved orr
      WHERE orr.period_year = op.period_year
        AND orr.period_quarter = op.period_quarter
    ), 0) AS overrides_total,
    op.total_overhead_amount - COALESCE((
      SELECT SUM(override_amount)
      FROM overrides_resolved orr
      WHERE orr.period_year = op.period_year
        AND orr.period_quarter = op.period_quarter
    ), 0) AS remaining_overhead
  FROM public.overhead_periods op
),
-- Total meetings in each quarter for clients without an override (denominator)
quarter_meeting_pool AS (
  SELECT
    lc.period_year,
    lc.period_quarter,
    SUM(lc.meeting_count) AS pool_meetings
  FROM labor_cost lc
  WHERE NOT EXISTS (
    SELECT 1 FROM public.overhead_overrides o
    WHERE o.client_account_id = lc.client_account_id
      AND o.period_year = lc.period_year
      AND o.period_quarter = lc.period_quarter
  )
  GROUP BY lc.period_year, lc.period_quarter
)
SELECT
  p.client_account_id,
  a.name AS client_account_name,
  p.period_year,
  p.period_quarter,

  COALESCE(cr.contract_revenue, 0) + COALESCE(ra.adj, 0) AS revenue,
  COALESCE(cr.contract_revenue, 0) AS contract_revenue,
  COALESCE(ra.adj, 0) AS revenue_adjustment,

  COALESCE(lc.labor_cost, 0) AS meeting_labor_cost,
  COALESCE(lc.meeting_count, 0) AS meeting_count,

  COALESCE(dc.direct_cost, 0) AS direct_cost,

  -- Overhead share
  CASE
    -- Has explicit override
    WHEN orr.override_amount IS NOT NULL THEN orr.override_amount
    -- No override, no meetings → $0 (flagged)
    WHEN COALESCE(lc.meeting_count, 0) = 0 THEN 0
    -- No override, has meetings → meeting-share of remaining overhead
    WHEN qmp.pool_meetings IS NULL OR qmp.pool_meetings = 0 THEN 0
    ELSE qo.remaining_overhead * (lc.meeting_count::numeric / qmp.pool_meetings)
  END AS overhead_share,

  -- Margin
  (COALESCE(cr.contract_revenue, 0) + COALESCE(ra.adj, 0))
    - COALESCE(lc.labor_cost, 0)
    - COALESCE(dc.direct_cost, 0)
    - CASE
        WHEN orr.override_amount IS NOT NULL THEN orr.override_amount
        WHEN COALESCE(lc.meeting_count, 0) = 0 THEN 0
        WHEN qmp.pool_meetings IS NULL OR qmp.pool_meetings = 0 THEN 0
        ELSE qo.remaining_overhead * (lc.meeting_count::numeric / qmp.pool_meetings)
      END
    AS margin,

  -- Margin %
  CASE
    WHEN (COALESCE(cr.contract_revenue, 0) + COALESCE(ra.adj, 0)) = 0 THEN NULL
    ELSE (
      (COALESCE(cr.contract_revenue, 0) + COALESCE(ra.adj, 0))
        - COALESCE(lc.labor_cost, 0)
        - COALESCE(dc.direct_cost, 0)
        - CASE
            WHEN orr.override_amount IS NOT NULL THEN orr.override_amount
            WHEN COALESCE(lc.meeting_count, 0) = 0 THEN 0
            WHEN qmp.pool_meetings IS NULL OR qmp.pool_meetings = 0 THEN 0
            ELSE qo.remaining_overhead * (lc.meeting_count::numeric / qmp.pool_meetings)
          END
    ) / (COALESCE(cr.contract_revenue, 0) + COALESCE(ra.adj, 0))
  END AS margin_pct,

  -- Exception flags
  COALESCE(lc.has_missing_salary, false) AS has_missing_salary,
  (orr.override_amount IS NULL AND COALESCE(lc.meeting_count, 0) = 0
    AND (COALESCE(cr.contract_revenue, 0) + COALESCE(ra.adj, 0)) > 0)
    AS has_no_overhead_alloc

FROM periods p
LEFT JOIN public.accounts a ON a.account_id = p.client_account_id
LEFT JOIN contract_revenue cr USING (period_year, period_quarter, client_account_id)
LEFT JOIN revenue_adj ra USING (period_year, period_quarter, client_account_id)
LEFT JOIN labor_cost lc USING (period_year, period_quarter, client_account_id)
LEFT JOIN direct_cost dc USING (period_year, period_quarter, client_account_id)
LEFT JOIN overrides_resolved orr USING (period_year, period_quarter, client_account_id)
LEFT JOIN quarter_overhead qo USING (period_year, period_quarter)
LEFT JOIN quarter_meeting_pool qmp USING (period_year, period_quarter);


-- -----------------------------------------------------------------------------
-- v_client_portfolio
-- One row per active client. Powers the Client Portfolio page.
--
-- Activity counts come from public.meetings filtered to
--   meeting_status_label = 'Confirmed'
-- so cancellations and other non-confirmed states never inflate the numbers.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_portfolio AS
WITH meeting_agg AS (
  SELECT
    client_account_id,
    COUNT(*) FILTER (
      WHERE meeting_date >= CURRENT_DATE - interval '365 days'
        AND meeting_date <= CURRENT_DATE
    ) AS meetings_last_365d,
    COUNT(*) FILTER (
      WHERE meeting_date >= CURRENT_DATE - interval '90 days'
        AND meeting_date <= CURRENT_DATE
    ) AS meetings_last_90d,
    -- Forward-looking: confirmed meetings scheduled AFTER this instant through
    -- 3 months out. Deliberate OPPOSITE of the trailing fields above — it is NOT
    -- bounded by <= now() and intentionally INCLUDES future meetings (the
    -- upcoming window). now() is timestamptz like meeting_date, so the
    -- comparison is absolute with no timezone drift.
    COUNT(*) FILTER (
      WHERE meeting_date > now()
        AND meeting_date <= now() + interval '3 months'
    ) AS meetings_next_3m,
    COUNT(DISTINCT institution_name) FILTER (
      WHERE meeting_date >= CURRENT_DATE - interval '365 days'
        AND meeting_date <= CURRENT_DATE
        AND institution_name IS NOT NULL
    ) AS unique_institutions_last_365d,
    MAX(meeting_date) FILTER (WHERE meeting_date <= CURRENT_DATE) AS last_meeting_date
  FROM public.meetings
  WHERE meeting_status_label = 'Confirmed'
  GROUP BY client_account_id
),
recent_contract AS (
  SELECT DISTINCT ON (client_account_id)
    client_account_id,
    quarterly_retainer
  FROM public.contracts
  WHERE state_code = 0
  ORDER BY client_account_id, contract_start_date DESC
),
-- Each client's most recent client_notes row, used only for its status flag.
-- Ranking mirrors v_client_detail_recent_note (note_date, then modified_on,
-- then created_on — all DESC) so the portfolio flag and the Client Detail page
-- always agree on which note is "latest".
--
-- NB: note_date here is the client_notes date, which is a DIFFERENT source from
-- the portfolio's "Last Note" column (that one is accounts.last_touchpoint_date,
-- aliased last_note_date). They need not coincide; note_status_date is exposed so
-- the UI can show the flag's own as-of date.
--
-- status_text is free text that carries trailing newlines, stray punctuation and
-- case drift (e.g. 'Stable\n', 'At Risk. '), so it is normalized to one of the
-- five canonical flags by a cleaned, lowercased prefix match. Anything that does
-- not match a known flag passes through trimmed (so a future status value is
-- surfaced rather than silently dropped); blank/null becomes NULL.
recent_note AS (
  SELECT DISTINCT ON (client_account_id)
    client_account_id,
    note_date,
    CASE
      WHEN lower(btrim(status_text)) LIKE 'at risk%'    THEN 'At Risk'
      WHEN lower(btrim(status_text)) LIKE 'stable%'     THEN 'Stable'
      WHEN lower(btrim(status_text)) LIKE 'lost%'       THEN 'Lost'
      WHEN lower(btrim(status_text)) LIKE 'new client%' THEN 'New Client'
      WHEN lower(btrim(status_text)) LIKE 'strong%'     THEN 'Strong'
      ELSE NULLIF(btrim(status_text, E' \t\n\r'), '')
    END AS note_status
  FROM public.client_notes
  WHERE client_account_id IS NOT NULL
  ORDER BY client_account_id, note_date DESC, modified_on DESC NULLS LAST, created_on DESC NULLS LAST
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

  COALESCE(ma.meetings_last_365d, 0)::int          AS meetings_last_365d,
  COALESCE(ma.meetings_last_90d, 0)::int           AS meetings_last_90d,
  COALESCE(ma.unique_institutions_last_365d, 0)::int AS unique_institutions_last_365d,
  ma.last_meeting_date::date                       AS last_meeting_date,

  a.last_event_date::date       AS last_event_date,
  a.last_touchpoint_date::date  AS last_note_date,

  a.state_label AS account_state,

  -- Latest client-note status flag (and that note's own date). NULL when the
  -- client has no note on record. Appended at the end of the column list so
  -- CREATE OR REPLACE VIEW can add them without a DROP (it forbids inserting a
  -- column in the middle of an existing view's column order).
  rn.note_status,
  rn.note_date::date AS note_status_date,

  -- Forward-looking upcoming-meeting count (confirmed, next 3 months). Appended
  -- at the very end of the column list so CREATE OR REPLACE VIEW can add it
  -- without a DROP (Postgres forbids inserting a column mid-list on REPLACE).
  COALESCE(ma.meetings_next_3m, 0)::int AS meetings_next_3m

FROM public.accounts a
LEFT JOIN meeting_agg ma ON ma.client_account_id = a.account_id
LEFT JOIN recent_contract rc ON rc.client_account_id = a.account_id
LEFT JOIN recent_note rn ON rn.client_account_id = a.account_id
WHERE a.state_label = 'Active';


-- -----------------------------------------------------------------------------
-- v_analyst_activity
-- Productivity by user by quarter.
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_analyst_activity AS
WITH user_quarters AS (
  -- Build the universe of (user, year, quarter) where the user did anything
  SELECT DISTINCT
    booker_id AS user_id,
    EXTRACT(YEAR FROM meeting_date)::int AS period_year,
    EXTRACT(QUARTER FROM meeting_date)::int AS period_quarter
  FROM public.meetings WHERE booker_id IS NOT NULL AND meeting_date IS NOT NULL
  UNION
  SELECT DISTINCT
    host_id,
    EXTRACT(YEAR FROM meeting_date)::int,
    EXTRACT(QUARTER FROM meeting_date)::int
  FROM public.meetings WHERE host_id IS NOT NULL AND meeting_date IS NOT NULL
)
SELECT
  uq.user_id,
  u.display_name,
  uq.period_year,
  uq.period_quarter,

  COUNT(*) FILTER (WHERE m.booker_id = uq.user_id) AS meetings_booked,
  COUNT(*) FILTER (WHERE m.host_id = uq.user_id) AS meetings_hosted,

  COUNT(*) FILTER (WHERE m.host_id = uq.user_id AND m.is_in_person)
    AS meetings_in_person_hosted,
  COUNT(*) FILTER (WHERE m.host_id = uq.user_id AND NOT m.is_in_person)
    AS meetings_virtual_hosted,

  COUNT(*) FILTER (WHERE m.booker_id = uq.user_id
                     AND m.meeting_status_label = 'Cancelled') AS meetings_cancelled_booked,
  COUNT(*) FILTER (WHERE m.host_id = uq.user_id
                     AND m.meeting_status_label = 'Cancelled') AS meetings_cancelled_hosted,

  COUNT(*) FILTER (WHERE m.host_id = uq.user_id
                     AND m.feedback_status_label = 'Closed - All in') AS feedback_collected_hosted,

  CASE
    WHEN COUNT(*) FILTER (WHERE m.host_id = uq.user_id
                            AND m.meeting_status_label != 'Cancelled') = 0 THEN NULL
    ELSE COUNT(*) FILTER (WHERE m.host_id = uq.user_id
                            AND m.feedback_status_label = 'Closed - All in')::numeric
       / COUNT(*) FILTER (WHERE m.host_id = uq.user_id
                            AND m.meeting_status_label != 'Cancelled')
  END AS feedback_collection_rate,

  -- Total labor cost attributed to this user (booker + host)
  COALESCE(
    SUM(mc.booker_cost) FILTER (WHERE mc.booker_id = uq.user_id), 0
  )
  + COALESCE(
    SUM(mc.host_cost) FILTER (WHERE mc.host_id = uq.user_id), 0
  )
  AS total_labor_cost_attributed

FROM user_quarters uq
LEFT JOIN public.users u ON u.user_id = uq.user_id
LEFT JOIN public.meetings m
  ON (m.booker_id = uq.user_id OR m.host_id = uq.user_id)
  AND EXTRACT(YEAR FROM m.meeting_date) = uq.period_year
  AND EXTRACT(QUARTER FROM m.meeting_date) = uq.period_quarter
LEFT JOIN public.v_meeting_costs mc
  ON mc.meeting_id = m.meeting_id
GROUP BY uq.user_id, u.display_name, uq.period_year, uq.period_quarter;


-- -----------------------------------------------------------------------------
-- v_feedback_by_client
-- Feedback collection rate per client per quarter.
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_feedback_by_client AS
SELECT
  client_account_id,
  client_account_name,
  EXTRACT(YEAR FROM meeting_date)::int AS period_year,
  EXTRACT(QUARTER FROM meeting_date)::int AS period_quarter,
  COUNT(*) AS total_meetings,
  COUNT(*) FILTER (WHERE feedback_status_label = 'Closed - All in')
    AS meetings_with_feedback,
  CASE
    WHEN COUNT(*) FILTER (WHERE meeting_status_label != 'Cancelled') = 0 THEN NULL
    ELSE COUNT(*) FILTER (WHERE feedback_status_label = 'Closed - All in')::numeric
       / COUNT(*) FILTER (WHERE meeting_status_label != 'Cancelled')
  END AS feedback_rate
FROM public.meetings
WHERE client_account_id IS NOT NULL AND meeting_date IS NOT NULL
GROUP BY 1, 2, 3, 4;


-- -----------------------------------------------------------------------------
-- v_feedback_by_analyst
-- Feedback collection rate per host per quarter.
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_feedback_by_analyst AS
SELECT
  host_id AS user_id,
  host_name AS display_name,
  EXTRACT(YEAR FROM meeting_date)::int AS period_year,
  EXTRACT(QUARTER FROM meeting_date)::int AS period_quarter,
  COUNT(*) AS total_hosted,
  COUNT(*) FILTER (WHERE feedback_status_label = 'Closed - All in')
    AS hosted_with_feedback,
  CASE
    WHEN COUNT(*) FILTER (WHERE meeting_status_label != 'Cancelled') = 0 THEN NULL
    ELSE COUNT(*) FILTER (WHERE feedback_status_label = 'Closed - All in')::numeric
       / COUNT(*) FILTER (WHERE meeting_status_label != 'Cancelled')
  END AS feedback_rate
FROM public.meetings
WHERE host_id IS NOT NULL AND meeting_date IS NOT NULL
GROUP BY 1, 2, 3, 4;


-- -----------------------------------------------------------------------------
-- v_feedback_overall
-- Firm-wide feedback rate by quarter.
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_feedback_overall AS
SELECT
  EXTRACT(YEAR FROM meeting_date)::int AS period_year,
  EXTRACT(QUARTER FROM meeting_date)::int AS period_quarter,
  COUNT(*) AS total_meetings,
  COUNT(*) FILTER (WHERE feedback_status_label = 'Closed - All in')
    AS meetings_with_feedback,
  CASE
    WHEN COUNT(*) FILTER (WHERE meeting_status_label != 'Cancelled') = 0 THEN NULL
    ELSE COUNT(*) FILTER (WHERE feedback_status_label = 'Closed - All in')::numeric
       / COUNT(*) FILTER (WHERE meeting_status_label != 'Cancelled')
  END AS feedback_rate
FROM public.meetings
WHERE meeting_date IS NOT NULL
GROUP BY 1, 2;


-- -----------------------------------------------------------------------------
-- v_pipeline_30d
-- Upcoming meetings in the next 30 days.
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_pipeline_30d AS
SELECT
  m.meeting_id,
  m.meeting_date,
  m.client_account_id,
  m.client_account_name,
  m.institution_name,
  m.investor_text,
  m.host_id,
  m.host_name,
  m.booker_id,
  m.booker_name,
  m.is_in_person,
  m.meeting_type_label,
  m.group_meeting,
  m.meeting_status_label,
  (m.meeting_date::date - CURRENT_DATE)::int AS days_until
FROM public.meetings m
WHERE m.meeting_date >= CURRENT_DATE
  AND m.meeting_date < CURRENT_DATE + interval '30 days'
  AND m.state_label = 'Active'
  AND (m.meeting_status_label != 'Cancelled' OR m.meeting_status_label IS NULL)
ORDER BY m.meeting_date;


-- -----------------------------------------------------------------------------
-- v_contract_renewals
-- Renewal calendar.
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_contract_renewals AS
SELECT
  c.contract_id,
  c.client_account_id,
  c.client_account_name,
  c.contract_status_label,
  c.contract_renewal_date,
  (c.contract_renewal_date - CURRENT_DATE)::int AS days_to_renewal,
  c.renewal_notice_date,
  CASE WHEN c.renewal_notice_date IS NOT NULL
       THEN (c.renewal_notice_date - CURRENT_DATE)::int
       ELSE NULL END AS days_to_notice,
  c.quarterly_retainer,
  c.auto_renew,
  c.renew,
  c.contract_termination_date,
  CASE
    WHEN c.contract_renewal_date < CURRENT_DATE THEN 'overdue'
    WHEN c.contract_renewal_date < CURRENT_DATE + interval '30 days' THEN 'urgent'
    WHEN c.contract_renewal_date < CURRENT_DATE + interval '90 days' THEN 'soon'
    ELSE 'future'
  END AS renewal_urgency
FROM public.contracts c
WHERE c.state_code = 0
  AND c.contract_renewal_date IS NOT NULL
ORDER BY c.contract_renewal_date;


-- -----------------------------------------------------------------------------
-- v_client_statistics
-- Three top-line numbers for the Client Statistics dashboard. Returns one row.
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_client_statistics AS
WITH active_accounts AS (
  SELECT account_id
  FROM public.accounts
  WHERE state_label = 'Active'
),
active_contracts AS (
  SELECT c.quarterly_retainer
  FROM public.contracts c
  JOIN active_accounts aa ON aa.account_id = c.client_account_id
  WHERE c.state_code = 0
    AND (c.contract_termination_date IS NULL OR c.contract_termination_date > CURRENT_DATE)
)
SELECT
  (SELECT COUNT(*) FROM active_accounts)::int AS active_account_count,
  COALESCE((SELECT SUM(quarterly_retainer * 4) FROM active_contracts), 0)::numeric AS annualized_retainer_revenue,
  (COALESCE((SELECT SUM(quarterly_retainer * 4) FROM active_contracts), 0)::numeric
    / NULLIF((SELECT COUNT(*) FROM active_accounts), 0)) AS avg_annualized_retainer;


-- -----------------------------------------------------------------------------
-- v_client_stats_by_market_cap
-- One row per market-cap bucket on the Client Statistics donut chart. The
-- bucket strings (Mega/Large/Mid/Small/Micro) are kept identical to the values
-- that v_client_portfolio.market_cap_label produces, so clicking a slice on
-- the stats page can navigate to /portfolio?market_cap=<bucket> and have the
-- portfolio table's exact-match filter actually match. NULL market_cap_b is
-- surfaced as its own 'Unknown' bucket — the chart shows it but the dashboard
-- treats it as non-clickable so it never lands on an empty filtered page.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_stats_by_market_cap AS
WITH bucketed AS (
  SELECT
    CASE
      WHEN a.market_cap_b IS NULL          THEN 'Unknown'::text
      WHEN a.market_cap_b >= 200::numeric  THEN 'Mega'::text
      WHEN a.market_cap_b >= 10::numeric   THEN 'Large'::text
      WHEN a.market_cap_b >= 2::numeric    THEN 'Mid'::text
      WHEN a.market_cap_b >= 0.3           THEN 'Small'::text
      ELSE                                      'Micro'::text
    END AS bucket,
    CASE
      WHEN a.market_cap_b IS NULL          THEN 6
      WHEN a.market_cap_b >= 200::numeric  THEN 1
      WHEN a.market_cap_b >= 10::numeric   THEN 2
      WHEN a.market_cap_b >= 2::numeric    THEN 3
      WHEN a.market_cap_b >= 0.3           THEN 4
      ELSE                                      5
    END AS display_order
  FROM public.accounts a
  WHERE a.state_label = 'Active'
)
SELECT
  bucket,
  COUNT(*)::int AS count,
  display_order
FROM bucketed
GROUP BY bucket, display_order
ORDER BY display_order;


-- -----------------------------------------------------------------------------
-- v_client_stats_by_region
-- One row per region bucket on the Client Statistics page. NULL or blank
-- hq_country_name maps to 'Unknown'; any country not in the explicit lists
-- below also maps to 'Unknown'. NB this differs from v_client_portfolio, which
-- maps unknowns into 'EMEA' as a fallback — so 'Unknown' is currently
-- non-clickable on the stats page (clicking it would land on an empty filter).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_stats_by_region AS
WITH active AS (
  SELECT accounts.hq_country_name
  FROM public.accounts
  WHERE accounts.state_label = 'Active'::text
),
bucketed AS (
  SELECT
    CASE
      WHEN active.hq_country_name IS NULL OR TRIM(BOTH FROM active.hq_country_name) = ''::text
        THEN 'Unknown'::text
      WHEN active.hq_country_name = ANY (ARRAY[
        'United States'::text, 'Canada'::text, 'Mexico'::text, 'Brazil'::text,
        'Argentina'::text, 'Chile'::text, 'Colombia'::text, 'Peru'::text
      ]) THEN 'Americas'::text
      WHEN active.hq_country_name = ANY (ARRAY[
        'United Kingdom'::text, 'Germany'::text, 'France'::text, 'Italy'::text,
        'Spain'::text, 'Netherlands'::text, 'Switzerland'::text, 'Sweden'::text,
        'Norway'::text, 'Denmark'::text, 'Finland'::text, 'Ireland'::text,
        'Belgium'::text, 'Austria'::text, 'Portugal'::text, 'Israel'::text,
        'Saudi Arabia'::text, 'UAE'::text, 'South Africa'::text, 'Turkey'::text,
        'Poland'::text
      ]) THEN 'EMEA'::text
      WHEN active.hq_country_name = ANY (ARRAY[
        'Japan'::text, 'China'::text, 'Hong Kong'::text, 'Taiwan'::text,
        'South Korea'::text, 'Australia'::text, 'New Zealand'::text,
        'Singapore'::text, 'India'::text, 'Indonesia'::text, 'Malaysia'::text,
        'Thailand'::text, 'Philippines'::text, 'Vietnam'::text
      ]) THEN 'APAC'::text
      ELSE 'Unknown'::text
    END AS bucket
  FROM active
)
SELECT
  bucket,
  COUNT(*)::int AS count,
  CASE bucket
    WHEN 'Americas'::text THEN 1
    WHEN 'EMEA'::text     THEN 2
    WHEN 'APAC'::text     THEN 3
    WHEN 'Unknown'::text  THEN 4
    ELSE NULL::int
  END AS display_order
FROM bucketed
GROUP BY bucket
ORDER BY (
  CASE bucket
    WHEN 'Americas'::text THEN 1
    WHEN 'EMEA'::text     THEN 2
    WHEN 'APAC'::text     THEN 3
    WHEN 'Unknown'::text  THEN 4
    ELSE NULL::int
  END
);


-- -----------------------------------------------------------------------------
-- v_client_stats_by_sector
-- One row per distinct sector_label across active accounts, count desc with
-- 'Unknown' (NULL or blank label) sorted last. Sector strings are passed
-- through unchanged so they exact-match v_client_portfolio.sector_label.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_stats_by_sector AS
SELECT
  COALESCE(NULLIF(TRIM(BOTH FROM sector_label), ''::text), 'Unknown'::text) AS bucket,
  COUNT(*)::int AS count
FROM public.accounts
WHERE state_label = 'Active'::text
GROUP BY (COALESCE(NULLIF(TRIM(BOTH FROM sector_label), ''::text), 'Unknown'::text))
ORDER BY (
  CASE
    WHEN COALESCE(NULLIF(TRIM(BOTH FROM sector_label), ''::text), 'Unknown'::text) = 'Unknown'::text THEN 1
    ELSE 0
  END
), (COUNT(*)) DESC;


-- -----------------------------------------------------------------------------
-- v_client_stats_by_manager
-- One row per primary Account Manager (sales_lead_primary_name) across active
-- accounts, count desc, with 'Unassigned' (NULL or blank name) sorted last.
-- Only the PRIMARY manager is counted — secondary/associate roles are ignored
-- — so each active client is counted exactly once and the bucket counts sum to
-- v_client_statistics.active_account_count. The name string is passed through
-- unchanged so it exact-matches v_client_portfolio.sales_lead_primary_name,
-- letting the stats page deep-link to /portfolio?sales_lead=<name>. 'Unassigned'
-- is surfaced as its own bucket but is treated as non-clickable on the page.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_stats_by_manager AS
SELECT
  COALESCE(NULLIF(TRIM(BOTH FROM sales_lead_primary_name), ''::text), 'Unassigned'::text) AS bucket,
  COUNT(*)::int AS count
FROM public.accounts
WHERE state_label = 'Active'::text
GROUP BY (COALESCE(NULLIF(TRIM(BOTH FROM sales_lead_primary_name), ''::text), 'Unassigned'::text))
ORDER BY (
  CASE
    WHEN COALESCE(NULLIF(TRIM(BOTH FROM sales_lead_primary_name), ''::text), 'Unassigned'::text) = 'Unassigned'::text THEN 1
    ELSE 0
  END
), (COUNT(*)) DESC;


-- -----------------------------------------------------------------------------
-- v_client_stats_by_status
-- One row per client-relationship status on the Client Statistics donut. The
-- status is the latest client-note flag already computed by v_client_portfolio
-- (note_status), so this view can never drift from the Portfolio's Status column
-- or its ?note_status= filter. Selecting from the portfolio view (which is itself
-- restricted to active accounts) means the counts sum to
-- v_client_statistics.active_account_count. Clients with no note on record fall
-- into an explicit 'No Status' bucket rather than being dropped. display_order
-- mirrors the Portfolio's severity order (At Risk → Lost → New Client → Stable →
-- Strong); any future/unrecognized flag sorts between the known flags and
-- 'No Status' so it surfaces rather than vanishing.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_stats_by_status AS
SELECT
  COALESCE(p.note_status, 'No Status'::text) AS bucket,
  COUNT(*)::int AS count,
  CASE COALESCE(p.note_status, 'No Status'::text)
    WHEN 'At Risk'    THEN 1
    WHEN 'Lost'       THEN 2
    WHEN 'New Client' THEN 3
    WHEN 'Stable'     THEN 4
    WHEN 'Strong'     THEN 5
    WHEN 'No Status'  THEN 99
    ELSE 50
  END AS display_order
FROM public.v_client_portfolio p
GROUP BY COALESCE(p.note_status, 'No Status'::text)
ORDER BY display_order;


-- -----------------------------------------------------------------------------
-- v_client_stats_by_days_left
-- One row per "days left on contract" bucket on the Client Statistics page. The
-- source is v_contract_management.days_to_expiry (initial_term_end - CURRENT_DATE,
-- one row per active client), so the counts sum to active_account_count. Bucket
-- boundaries are aligned to the Portfolio Days-Left pill thresholds (red < 30,
-- amber 30-89, green >= 90) so the color cue reads identically. NULL (no active
-- contract) and <= 0 (past initial term) are folded into a single 'Expired / none'
-- bucket rather than being dropped.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_stats_by_days_left AS
WITH bucketed AS (
  SELECT
    CASE
      WHEN cm.days_to_expiry IS NULL OR cm.days_to_expiry <= 0 THEN 'Expired / none'::text
      WHEN cm.days_to_expiry < 30                              THEN '< 30 days'::text
      WHEN cm.days_to_expiry < 90                              THEN '30-89 days'::text
      WHEN cm.days_to_expiry <= 180                            THEN '90-180 days'::text
      WHEN cm.days_to_expiry <= 365                            THEN '181-365 days'::text
      ELSE                                                          '365+ days'::text
    END AS bucket,
    CASE
      WHEN cm.days_to_expiry IS NULL OR cm.days_to_expiry <= 0 THEN 1
      WHEN cm.days_to_expiry < 30                              THEN 2
      WHEN cm.days_to_expiry < 90                              THEN 3
      WHEN cm.days_to_expiry <= 180                            THEN 4
      WHEN cm.days_to_expiry <= 365                            THEN 5
      ELSE                                                          6
    END AS display_order
  FROM public.v_contract_management cm
)
SELECT
  bucket,
  COUNT(*)::int AS count,
  display_order
FROM bucketed
GROUP BY bucket, display_order
ORDER BY display_order;


-- -----------------------------------------------------------------------------
-- v_productivity_detail_summary
-- One row per user with any meeting activity in the trailing 12 months OR
-- who is a sales lead on any active account. Powers the per-person
-- Productivity Detail dashboard.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_productivity_detail_summary AS
-- Wrapped: inner `base` computes per raw user_id; outer folds duplicate Dynamics
-- ids into one person via public.canonical_user_id (see public.user_id_aliases),
-- summing the counts and recomputing the feedback rate from the merged totals.
WITH base AS (
WITH user_universe AS (
  SELECT DISTINCT booker_id AS user_id
  FROM public.meetings
  WHERE booker_id IS NOT NULL
    AND meeting_date >= CURRENT_DATE - INTERVAL '12 months'
    AND meeting_date <= now()
  UNION
  SELECT DISTINCT host_id
  FROM public.meetings
  WHERE host_id IS NOT NULL
    AND meeting_date >= CURRENT_DATE - INTERVAL '12 months'
    AND meeting_date <= now()
  UNION
  SELECT DISTINCT u.user_id
  FROM public.users u
  JOIN public.accounts a ON a.sales_lead_primary_name = u.display_name
  WHERE a.state_label = 'Active'
),
meeting_stats AS (
  SELECT
    uu.user_id,
    COUNT(*) FILTER (
      WHERE m.booker_id = uu.user_id
        AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
        AND m.meeting_date <= now()
        AND m.meeting_status_label = 'Confirmed'
    )::int AS meetings_scheduled_12m,
    COUNT(*) FILTER (
      WHERE m.host_id = uu.user_id
        AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
        AND m.meeting_date <= now()
        AND m.meeting_status_label = 'Confirmed'
    )::int AS meetings_hosted_12m,
    COUNT(*) FILTER (
      WHERE m.host_id = uu.user_id
        AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
        AND m.meeting_date <= now()
        AND m.meeting_status_label = 'Confirmed'
        AND m.is_in_person = true
    )::int AS meetings_in_person_12m,
    COUNT(*) FILTER (
      WHERE m.host_id = uu.user_id
        AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
        AND m.meeting_date <= now()
        AND m.meeting_status_label = 'Confirmed'
        AND m.feedback_status_label = 'Closed - All in'
    )::int AS feedback_collected_12m,
    -- Denominator of the feedback rate: confirmed host meetings whose feedback
    -- reached a closed status ('Closed - All in' + 'Closed - No Feedback').
    -- Same closed-set definition as the Client / Institution Detail views;
    -- counted raw (per institution-level record) so it reconciles with the
    -- Statistics "Feedback by Person" view. 'Awaiting Additional' / null excluded.
    COUNT(*) FILTER (
      WHERE m.host_id = uu.user_id
        AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
        AND m.meeting_date <= now()
        AND m.meeting_status_label = 'Confirmed'
        AND m.feedback_status_label IN ('Closed - All in', 'Closed - No Feedback')
    )::int AS feedback_closed_12m
  FROM user_universe uu
  LEFT JOIN public.meetings m
    ON (m.booker_id = uu.user_id OR m.host_id = uu.user_id)
  GROUP BY uu.user_id
),
sales_lead_stats AS (
  SELECT
    u.user_id,
    COUNT(DISTINCT a.account_id)::int AS active_clients_as_sales_lead,
    COALESCE(SUM(c.quarterly_retainer * 4), 0)::numeric AS sales_lead_book_annualized
  FROM public.users u
  JOIN public.accounts a ON a.sales_lead_primary_name = u.display_name
  JOIN public.contracts c
    ON c.client_account_id = a.account_id
    AND c.state_code = 0
    AND (c.contract_termination_date IS NULL OR c.contract_termination_date > CURRENT_DATE)
  WHERE a.state_label = 'Active'
  GROUP BY u.user_id
)
SELECT
  uu.user_id,
  u.display_name,
  COALESCE(ms.meetings_scheduled_12m, 0) AS meetings_scheduled_12m,
  COALESCE(ms.meetings_hosted_12m, 0) AS meetings_hosted_12m,
  COALESCE(ms.meetings_in_person_12m, 0) AS meetings_in_person_12m,
  COALESCE(ms.feedback_collected_12m, 0) AS feedback_collected_12m,
  COALESCE(ms.feedback_closed_12m, 0) AS feedback_closed_12m,
  -- collected ÷ closed (NOT ÷ hosted) — matches Client / Institution Detail
  -- and the Statistics "Feedback by Person" view.
  CASE
    WHEN COALESCE(ms.feedback_closed_12m, 0) = 0 THEN NULL
    ELSE ms.feedback_collected_12m::numeric / NULLIF(ms.feedback_closed_12m, 0)
  END AS feedback_collection_rate_12m,
  COALESCE(sls.active_clients_as_sales_lead, 0) AS active_clients_as_sales_lead,
  COALESCE(sls.sales_lead_book_annualized, 0) AS sales_lead_book_annualized
FROM user_universe uu
JOIN public.users u ON u.user_id = uu.user_id
LEFT JOIN meeting_stats ms ON ms.user_id = uu.user_id
LEFT JOIN sales_lead_stats sls ON sls.user_id = uu.user_id
WHERE u.display_name IS NOT NULL
  AND u.display_name != 'CRM Administration'
)
SELECT
  public.canonical_user_id(b.user_id) AS user_id,
  cu.display_name,
  SUM(b.meetings_scheduled_12m)::int  AS meetings_scheduled_12m,
  SUM(b.meetings_hosted_12m)::int     AS meetings_hosted_12m,
  SUM(b.meetings_in_person_12m)::int  AS meetings_in_person_12m,
  SUM(b.feedback_collected_12m)::int  AS feedback_collected_12m,
  SUM(b.feedback_closed_12m)::int     AS feedback_closed_12m,
  -- collected ÷ closed recomputed from the merged totals.
  CASE
    WHEN SUM(b.feedback_closed_12m) = 0 THEN NULL
    ELSE SUM(b.feedback_collected_12m)::numeric / NULLIF(SUM(b.feedback_closed_12m), 0)
  END AS feedback_collection_rate_12m,
  SUM(b.active_clients_as_sales_lead)::int      AS active_clients_as_sales_lead,
  SUM(b.sales_lead_book_annualized)::numeric    AS sales_lead_book_annualized
FROM base b
JOIN public.users cu ON cu.user_id = public.canonical_user_id(b.user_id)
GROUP BY public.canonical_user_id(b.user_id), cu.display_name;


-- -----------------------------------------------------------------------------
-- v_person_role_ttm
-- One row per user with their trailing-12-month confirmed activity totals,
-- independent of any date range the People Summary page uses elsewhere. Drives
-- the "Role" column (Host / Booker / Hybrid) on that page. Users are matched by
-- user_id (booker_id / host_id), not by name. Trailing window and the Eastern
-- "today" follow the same conventions as the other productivity views.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_person_role_ttm AS
-- Wrapped: the inner `base` computes counts per raw user_id; the outer query
-- folds duplicate Dynamics ids for one person into a single row via
-- public.canonical_user_id (see public.user_id_aliases). Non-aliased ids
-- resolve to themselves, so only the curated duplicates collapse.
WITH base AS (
WITH user_universe AS (
  SELECT DISTINCT booker_id AS user_id
  FROM public.meetings
  WHERE booker_id IS NOT NULL
    AND meeting_status_label = 'Confirmed'
    AND meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
    AND meeting_date <= now()
  UNION
  SELECT DISTINCT host_id
  FROM public.meetings
  WHERE host_id IS NOT NULL
    AND meeting_status_label = 'Confirmed'
    AND meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
    AND meeting_date <= now()
)
SELECT
  uu.user_id,
  COUNT(*) FILTER (
    WHERE m.booker_id = uu.user_id
      AND m.meeting_status_label = 'Confirmed'
      AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
      AND m.meeting_date <= now()
  )::int AS booked_ttm,
  COUNT(*) FILTER (
    WHERE m.host_id = uu.user_id
      AND m.meeting_status_label = 'Confirmed'
      AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
      AND m.meeting_date <= now()
  )::int AS hosted_ttm,
  (
    COUNT(*) FILTER (
      WHERE m.booker_id = uu.user_id
        AND m.meeting_status_label = 'Confirmed'
        AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
        AND m.meeting_date <= now()
    )
    + COUNT(*) FILTER (
      WHERE m.host_id = uu.user_id
        AND m.meeting_status_label = 'Confirmed'
        AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
        AND m.meeting_date <= now()
    )
  )::int AS total_ttm
FROM user_universe uu
LEFT JOIN public.meetings m
  ON (m.booker_id = uu.user_id OR m.host_id = uu.user_id)
GROUP BY uu.user_id
)
SELECT
  public.canonical_user_id(b.user_id) AS user_id,
  SUM(b.booked_ttm)::int AS booked_ttm,
  SUM(b.hosted_ttm)::int AS hosted_ttm,
  SUM(b.total_ttm)::int  AS total_ttm
FROM base b
GROUP BY public.canonical_user_id(b.user_id);


-- -----------------------------------------------------------------------------
-- v_analyst_monthly_activity
-- One row per (display_name, year, month) for the trailing 12 months.
-- Powers the monthly bar charts on the Productivity Detail page.
-- Aggregates by display_name (not user_id) so duplicate user records collapse.
-- -----------------------------------------------------------------------------
-- IDENTITY CAVEAT (name-merge, not canonical-id): this view collapses a person's
-- multiple Dynamics user_ids by display_name (user_ids_by_name). That is correct
-- TODAY only because the sole duplicate user records — Brian Smith and Blair
-- Mutschler — are each a single human, so a name-merge equals a canonical-id
-- merge for them (see public.user_id_aliases / public.canonical_user_id).
-- RISK: if a genuine same-name collision ever appears (two DIFFERENT active
-- people sharing one display_name), this view would wrongly fuse them.
-- FIX WHEN THAT HAPPENS: group by public.canonical_user_id(user_id) instead of
-- display_name here, AND switch the Productivity Detail page's monthly matching
-- (monthlyRows.filter on display_name) + the MastheadSelector to user_id so the
-- app keys identity by id, not name. The same applies to v_client_detail_top_hosts
-- and v_institution_detail_top_hosts. Deliberately deferred — defensive only.
CREATE OR REPLACE VIEW public.v_analyst_monthly_activity AS
WITH user_ids_by_name AS (
  SELECT
    display_name,
    array_agg(user_id) AS user_ids
  FROM public.users
  WHERE display_name IS NOT NULL
    AND display_name != 'CRM Administration'
    AND display_name NOT LIKE '#%'
  GROUP BY display_name
),
month_universe AS (
  SELECT DISTINCT
    n.display_name,
    EXTRACT(YEAR FROM m.meeting_date)::int AS period_year,
    EXTRACT(MONTH FROM m.meeting_date)::int AS period_month
  FROM public.meetings m
  JOIN user_ids_by_name n
    ON m.booker_id = ANY(n.user_ids) OR m.host_id = ANY(n.user_ids)
  WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
    AND m.meeting_date <= now()
)
SELECT
  mu.display_name,
  mu.period_year,
  mu.period_month,
  to_char(make_date(mu.period_year, mu.period_month, 1), 'YYYY-MM') AS period_label,
  -- All display counts are Confirmed-only, matching the Productivity Detail
  -- headline tiles (v_productivity_detail_summary) and every other booked /
  -- hosted surface. Non-final statuses (e.g. 'TBR') and 'Cancelled' are
  -- excluded so the monthly bars reconcile with the tiles.
  COUNT(*) FILTER (
    WHERE m.booker_id = ANY(n.user_ids)
      AND m.meeting_status_label = 'Confirmed'
  )::int AS meetings_scheduled,
  COUNT(*) FILTER (
    WHERE m.host_id = ANY(n.user_ids)
      AND m.meeting_status_label = 'Confirmed'
  )::int AS meetings_hosted,
  COUNT(*) FILTER (
    WHERE m.host_id = ANY(n.user_ids)
      AND m.meeting_status_label = 'Confirmed'
      AND m.is_in_person = true
  )::int AS meetings_in_person,
  COUNT(*) FILTER (
    WHERE m.host_id = ANY(n.user_ids)
      AND m.meeting_status_label = 'Confirmed'
      AND m.is_in_person = false
  )::int AS meetings_virtual,
  COUNT(*) FILTER (
    WHERE m.host_id = ANY(n.user_ids)
      AND m.meeting_status_label = 'Confirmed'
      AND m.feedback_status_label = 'Closed - All in'
  )::int AS feedback_collected,
  COUNT(*) FILTER (
    WHERE m.host_id = ANY(n.user_ids)
      AND m.meeting_status_label = 'Confirmed'
      AND m.feedback_status_label IN ('Closed - All in', 'Closed - No Feedback')
  )::int AS feedback_closed,
  -- collected ÷ closed, confirmed only — same closed-set definition and the
  -- same Confirmed universe as the 12-month headline
  -- (v_productivity_detail_summary), so the monthly bars reconcile with it.
  CASE
    WHEN COUNT(*) FILTER (
      WHERE m.host_id = ANY(n.user_ids)
        AND m.meeting_status_label = 'Confirmed'
        AND m.feedback_status_label IN ('Closed - All in', 'Closed - No Feedback')
    ) = 0 THEN NULL
    ELSE COUNT(*) FILTER (
      WHERE m.host_id = ANY(n.user_ids)
        AND m.meeting_status_label = 'Confirmed'
        AND m.feedback_status_label = 'Closed - All in'
    )::numeric
       / COUNT(*) FILTER (
         WHERE m.host_id = ANY(n.user_ids)
           AND m.meeting_status_label = 'Confirmed'
           AND m.feedback_status_label IN ('Closed - All in', 'Closed - No Feedback')
       )
  END AS feedback_collection_rate
FROM month_universe mu
JOIN user_ids_by_name n ON n.display_name = mu.display_name
LEFT JOIN public.meetings m
  ON (m.booker_id = ANY(n.user_ids) OR m.host_id = ANY(n.user_ids))
  AND EXTRACT(YEAR FROM m.meeting_date)::int = mu.period_year
  AND EXTRACT(MONTH FROM m.meeting_date)::int = mu.period_month
  AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
  AND m.meeting_date <= now()
GROUP BY mu.display_name, mu.period_year, mu.period_month;


-- -----------------------------------------------------------------------------
-- v_productivity_detail_institutions
-- One row per (user, investor institution) for the trailing 12 months.
-- Powers the "Meetings by institution" tables on the Productivity Detail page.
--   booked_count: meetings where booker_id = user_id, ALL statuses (the
--                 booker did the setup work whether or not the meeting
--                 ultimately happened).
--   hosted_count: meetings where host_id = user_id, excluding 'Cancelled'
--                 (matches the existing v_productivity_detail_summary
--                 convention — cancelled meetings are not hosted).
-- Institution rollup is by meetings.institution_name; institution_id is
-- picked from the most recent meeting for that name (same pattern as
-- v_institution_summary). Meetings with NULL institution_name are excluded.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_productivity_detail_institutions AS
-- Wrapped: per-institution counts folded by public.canonical_user_id so a person
-- split across duplicate Dynamics ids gets one combined per-institution
-- breakdown (matches the canonical user_id now used by the Detail summary).
WITH base AS (
WITH recent_meetings AS (
  SELECT
    booker_id,
    host_id,
    meeting_status_label,
    institution_id,
    institution_name,
    meeting_date
  FROM public.meetings
  WHERE meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
    AND meeting_date <= now()
    AND meeting_status_label = 'Confirmed'
    AND institution_name IS NOT NULL
),
booked AS (
  SELECT
    booker_id AS user_id,
    institution_name,
    (array_agg(institution_id ORDER BY meeting_date DESC NULLS LAST))[1]
      AS institution_id,
    COUNT(*)::int AS booked_count
  FROM recent_meetings
  WHERE booker_id IS NOT NULL
  GROUP BY booker_id, institution_name
),
hosted AS (
  SELECT
    host_id AS user_id,
    institution_name,
    (array_agg(institution_id ORDER BY meeting_date DESC NULLS LAST))[1]
      AS institution_id,
    COUNT(*)::int AS hosted_count
  FROM recent_meetings
  WHERE host_id IS NOT NULL
  GROUP BY host_id, institution_name
)
SELECT
  COALESCE(b.user_id, h.user_id)                   AS user_id,
  COALESCE(b.institution_name, h.institution_name) AS institution_name,
  COALESCE(b.institution_id, h.institution_id)     AS institution_id,
  COALESCE(b.booked_count, 0)                      AS booked_count,
  COALESCE(h.hosted_count, 0)                      AS hosted_count
FROM booked b
FULL OUTER JOIN hosted h
  ON b.user_id          = h.user_id
 AND b.institution_name = h.institution_name
)
SELECT
  public.canonical_user_id(base.user_id) AS user_id,
  base.institution_name,
  (array_agg(base.institution_id ORDER BY base.institution_id NULLS LAST))[1] AS institution_id,
  SUM(base.booked_count)::int AS booked_count,
  SUM(base.hosted_count)::int AS hosted_count
FROM base
GROUP BY public.canonical_user_id(base.user_id), base.institution_name;


-- -----------------------------------------------------------------------------
-- v_contract_management
-- One row per active client account (~101 rows). Each row shows the latest
-- active contract for that client (by initial_term_end DESC), if any. If the
-- client has no active contract the row still appears with NULL contract
-- fields and has_active_contract = false.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_contract_management AS
WITH contract_counts AS (
  SELECT
    client_account_id,
    COUNT(*)::int AS total_contract_count,
    BOOL_OR(state_code = 0
            AND (contract_termination_date IS NULL
                 OR contract_termination_date > CURRENT_DATE))
      AS has_active_contract
  FROM public.contracts
  WHERE client_account_id IS NOT NULL
  GROUP BY client_account_id
),
ranked_active AS (
  SELECT
    c.contract_id,
    c.client_account_id,
    c.contract_start_date,
    c.initial_term_length_label,
    c.initial_term_end,
    c.renewal_notice_date,
    c.renewal_check_in_date,
    c.auto_renew,
    c.quarterly_retainer,
    c.contract_status_label,
    ROW_NUMBER() OVER (
      PARTITION BY c.client_account_id
      ORDER BY c.initial_term_end DESC NULLS LAST
    ) AS rn
  FROM public.contracts c
  WHERE c.state_code = 0
    AND (c.contract_termination_date IS NULL
         OR c.contract_termination_date > CURRENT_DATE)
),
latest_active AS (
  SELECT * FROM ranked_active WHERE rn = 1
)
SELECT
  a.account_id,
  a.name AS client_name,
  COALESCE(cc.total_contract_count, 0) AS total_contract_count,
  COALESCE(cc.has_active_contract, FALSE) AS has_active_contract,

  la.contract_id,
  la.contract_start_date,
  la.initial_term_length_label,
  la.initial_term_end,
  CASE WHEN la.initial_term_end IS NOT NULL
       THEN (la.initial_term_end - CURRENT_DATE)::int
       ELSE NULL END AS days_to_expiry,
  la.renewal_notice_date,
  la.renewal_check_in_date,
  la.auto_renew,
  la.quarterly_retainer,
  la.contract_status_label

FROM public.accounts a
LEFT JOIN contract_counts cc ON cc.client_account_id = a.account_id
LEFT JOIN latest_active la   ON la.client_account_id = a.account_id
WHERE a.state_label = 'Active'
ORDER BY ((la.initial_term_end - CURRENT_DATE)::int IS NULL),
         (la.initial_term_end - CURRENT_DATE)::int ASC NULLS LAST,
         client_name ASC;


-- -----------------------------------------------------------------------------
-- v_client_detail_summary
-- One row per active client. KPI tiles + dropdown rows on the Client Detail
-- page. Every meeting aggregation filters meeting_status_label = 'Confirmed'.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_detail_summary AS
WITH active_clients AS (
  SELECT account_id, name AS client_name, sales_lead_primary_name
  FROM public.accounts
  WHERE state_label = 'Active'
),
meeting_agg AS (
  SELECT
    m.client_account_id AS account_id,
    COUNT(*)::int AS lifetime_meetings,
    COUNT(*) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_meetings,
    COUNT(*) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '24 months'
        AND m.meeting_date <  CURRENT_DATE - INTERVAL '12 months'
    )::int AS prior_12mo_meetings,
    COUNT(DISTINCT m.institution_name) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_unique_institutions,
    COUNT(DISTINCT NULLIF(COALESCE(m.investor_text, ''), '')) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_unique_investors,
    COUNT(*) FILTER (
      WHERE m.feedback_status_label = 'Closed - All in'
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_feedback_collected,
    COUNT(*) FILTER (
      WHERE m.feedback_status_label IN ('Closed - All in', 'Closed - No Feedback')
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_feedback_total_closed,
    MIN(m.meeting_date)::date AS client_since
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.client_account_id IS NOT NULL
  GROUP BY m.client_account_id
),
ranked_active_contract AS (
  SELECT
    c.client_account_id,
    c.quarterly_retainer,
    c.initial_term_end,
    ROW_NUMBER() OVER (
      PARTITION BY c.client_account_id
      ORDER BY c.initial_term_end DESC NULLS LAST
    ) AS rn
  FROM public.contracts c
  WHERE c.state_code = 0
    AND (c.contract_termination_date IS NULL
         OR c.contract_termination_date > CURRENT_DATE)
),
latest_active_contract AS (
  SELECT * FROM ranked_active_contract WHERE rn = 1
),
contract_totals AS (
  SELECT
    c.client_account_id,
    SUM(c.quarterly_retainer * 4)::numeric AS annualized_retainer
  FROM public.contracts c
  WHERE c.state_code = 0
    AND (c.contract_termination_date IS NULL
         OR c.contract_termination_date > CURRENT_DATE)
  GROUP BY c.client_account_id
)
SELECT
  ac.account_id,
  ac.client_name,
  COALESCE(ma.lifetime_meetings, 0) AS lifetime_meetings,
  COALESCE(ma.ltm_meetings, 0) AS ltm_meetings,
  COALESCE(ma.prior_12mo_meetings, 0) AS prior_12mo_meetings,
  (COALESCE(ma.ltm_meetings, 0) - COALESCE(ma.prior_12mo_meetings, 0))::int
    AS ltm_meetings_delta,
  COALESCE(ma.ltm_unique_institutions, 0) AS ltm_unique_institutions,
  COALESCE(ma.ltm_unique_investors, 0) AS ltm_unique_investors,
  COALESCE(ma.ltm_feedback_collected, 0) AS ltm_feedback_collected,
  COALESCE(ma.ltm_feedback_total_closed, 0) AS ltm_feedback_total_closed,
  CASE
    WHEN COALESCE(ma.ltm_feedback_total_closed, 0) = 0 THEN NULL
    ELSE ma.ltm_feedback_collected::numeric / NULLIF(ma.ltm_feedback_total_closed, 0)
  END AS ltm_feedback_rate,
  ma.client_since,
  ac.sales_lead_primary_name AS sales_lead_name,
  COALESCE(ct.annualized_retainer, 0)::numeric AS annualized_retainer,
  CASE
    WHEN COALESCE(ma.ltm_meetings, 0) = 0 THEN NULL
    ELSE COALESCE(ct.annualized_retainer, 0)::numeric / NULLIF(ma.ltm_meetings, 0)
  END AS dollars_per_meeting_ltm,
  lac.initial_term_end AS latest_term_end,
  CASE
    WHEN lac.initial_term_end IS NULL THEN NULL
    ELSE (lac.initial_term_end - CURRENT_DATE)::int
  END AS days_to_renewal
FROM active_clients ac
LEFT JOIN meeting_agg ma           ON ma.account_id = ac.account_id
LEFT JOIN latest_active_contract lac ON lac.client_account_id = ac.account_id
LEFT JOIN contract_totals ct       ON ct.client_account_id = ac.account_id;


-- -----------------------------------------------------------------------------
-- v_client_detail_quarterly
-- Last 8 quarters of confirmed meetings per active client, split by
-- live (in-person) vs virtual.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_detail_quarterly AS
SELECT
  m.client_account_id AS account_id,
  EXTRACT(YEAR FROM m.meeting_date)::int AS period_year,
  EXTRACT(QUARTER FROM m.meeting_date)::int AS period_quarter,
  EXTRACT(YEAR FROM m.meeting_date)::int::text
    || ' Q'
    || EXTRACT(QUARTER FROM m.meeting_date)::int::text
    AS period_label,
  COUNT(*) FILTER (WHERE m.is_in_person = true)::int AS live_count,
  COUNT(*) FILTER (WHERE m.is_in_person = false)::int AS virtual_count,
  COUNT(*)::int AS total
FROM public.meetings m
WHERE m.meeting_status_label = 'Confirmed'
  AND m.client_account_id IS NOT NULL
  AND m.meeting_date >= date_trunc('quarter', CURRENT_DATE) - INTERVAL '21 months'
  AND m.meeting_date <= now()
GROUP BY 1, 2, 3, 4;


-- -----------------------------------------------------------------------------
-- v_client_detail_top_institutions
-- Top 20 institutions per client by lifetime confirmed meeting count.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_detail_top_institutions AS
WITH inst_counts AS (
  SELECT
    m.client_account_id AS account_id,
    m.institution_name,
    (array_agg(m.institution_id ORDER BY m.meeting_date DESC NULLS LAST))[1]
      AS institution_id,
    COUNT(*)::int AS lifetime_count,
    COUNT(*) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_count,
    MIN(m.meeting_date)::date AS first_met,
    (MAX(m.meeting_date) FILTER (WHERE m.meeting_date <= now()))::date AS last_met
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.client_account_id IS NOT NULL
    AND m.institution_name IS NOT NULL
  GROUP BY m.client_account_id, m.institution_name
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY account_id
      ORDER BY lifetime_count DESC, last_met DESC
    ) AS rank
  FROM inst_counts
)
SELECT
  account_id,
  rank::int AS rank,
  institution_name,
  lifetime_count,
  ltm_count,
  first_met,
  last_met,
  institution_id
FROM ranked
WHERE rank <= 20;


-- -----------------------------------------------------------------------------
-- v_client_detail_reach_depth
-- Institution depth distribution per client. Bucketed by lifetime confirmed
-- meeting count. Buckets: 1, 2-3, 4-5, 6-10, 10+ meetings.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_detail_reach_depth AS
WITH inst_counts AS (
  SELECT
    m.client_account_id AS account_id,
    m.institution_name,
    COUNT(*) AS meeting_count
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.client_account_id IS NOT NULL
    AND m.institution_name IS NOT NULL
  GROUP BY m.client_account_id, m.institution_name
),
bucketed AS (
  SELECT
    account_id,
    CASE
      WHEN meeting_count = 1 THEN '1 meeting'
      WHEN meeting_count BETWEEN 2 AND 3 THEN '2-3 meetings'
      WHEN meeting_count BETWEEN 4 AND 5 THEN '4-5 meetings'
      WHEN meeting_count BETWEEN 6 AND 10 THEN '6-10 meetings'
      ELSE '10+ meetings'
    END AS bucket_label,
    CASE
      WHEN meeting_count = 1 THEN 1
      WHEN meeting_count BETWEEN 2 AND 3 THEN 2
      WHEN meeting_count BETWEEN 4 AND 5 THEN 3
      WHEN meeting_count BETWEEN 6 AND 10 THEN 4
      ELSE 5
    END AS bucket_order
  FROM inst_counts
)
SELECT
  account_id,
  bucket_label,
  bucket_order,
  COUNT(*)::int AS institution_count
FROM bucketed
GROUP BY account_id, bucket_label, bucket_order;


-- -----------------------------------------------------------------------------
-- v_client_detail_institutions
-- COMPLETE per-client institution list: every institution a client has met,
-- with the per-client lifetime confirmed meeting count. Same source + filters
-- as v_client_detail_reach_depth (and v_client_detail_top_institutions, minus
-- the top-20 cap), plus a bucket_order column whose CASE is copied verbatim
-- from v_client_detail_reach_depth so grouping by it reproduces the reach-depth
-- counts exactly (1 / 2-3 / 4-5 / 6-10 / 11+). Backs the Reach Depth drawer.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_detail_institutions AS
WITH inst_counts AS (
  SELECT
    m.client_account_id AS account_id,
    m.institution_name,
    (array_agg(m.institution_id ORDER BY m.meeting_date DESC NULLS LAST))[1]
      AS institution_id,
    COUNT(*)::int AS lifetime_count,
    COUNT(*) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_count,
    MIN(m.meeting_date)::date AS first_met,
    (MAX(m.meeting_date) FILTER (WHERE m.meeting_date <= now()))::date AS last_met
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.client_account_id IS NOT NULL
    AND m.institution_name IS NOT NULL
  GROUP BY m.client_account_id, m.institution_name
)
SELECT
  account_id,
  institution_id,
  institution_name,
  lifetime_count,
  ltm_count,
  first_met,
  last_met,
  CASE
    WHEN lifetime_count = 1 THEN 1
    WHEN lifetime_count BETWEEN 2 AND 3 THEN 2
    WHEN lifetime_count BETWEEN 4 AND 5 THEN 3
    WHEN lifetime_count BETWEEN 6 AND 10 THEN 4
    ELSE 5
  END AS bucket_order
FROM inst_counts;


-- -----------------------------------------------------------------------------
-- v_client_detail_top_hosts
-- Top 5 hosts per client in the trailing 12 months, excluding the
-- 'CRM Administration' service-account host.
-- -----------------------------------------------------------------------------
-- IDENTITY CAVEAT (name-merge, not canonical-id): groups hosts by host_name, so a
-- person with duplicate Dynamics user_ids is merged by NAME. Correct today (the
-- only duplicates, Brian Smith / Blair Mutschler, are same-person → name-merge ==
-- canonical-merge). If a genuine same-name collision of two DIFFERENT active
-- people ever appears, convert to public.canonical_user_id grouping. See the note
-- on public.user_id_aliases and v_analyst_monthly_activity's header.
CREATE OR REPLACE VIEW public.v_client_detail_top_hosts AS
WITH host_counts AS (
  SELECT
    m.client_account_id AS account_id,
    m.host_name,
    COUNT(*)::int AS ltm_count,
    MAX(m.meeting_date)::date AS last_met
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.client_account_id IS NOT NULL
    AND m.host_name IS NOT NULL
    AND m.host_name <> 'CRM Administration'
    AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
    AND m.meeting_date <= now()
  GROUP BY m.client_account_id, m.host_name
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY account_id
      ORDER BY ltm_count DESC, last_met DESC
    ) AS rn
  FROM host_counts
)
SELECT account_id, host_name, ltm_count, last_met
FROM ranked
WHERE rn <= 5;


-- -----------------------------------------------------------------------------
-- v_client_detail_recent_meetings
-- Last 25 confirmed meetings per client, most recent first.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_detail_recent_meetings AS
WITH ranked AS (
  SELECT
    m.client_account_id AS account_id,
    m.meeting_id,
    m.meeting_date,
    m.institution_id,
    m.institution_name,
    m.host_name,
    m.meeting_type_label,
    m.is_in_person,
    m.feedback_status_label,
    ROW_NUMBER() OVER (
      PARTITION BY m.client_account_id
      ORDER BY m.meeting_date DESC
    ) AS rn
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.client_account_id IS NOT NULL
)
SELECT
  account_id,
  meeting_id,
  meeting_date,
  institution_name,
  host_name,
  meeting_type_label,
  is_in_person,
  feedback_status_label,
  institution_id
FROM ranked
WHERE rn <= 25;


-- -----------------------------------------------------------------------------
-- v_client_detail_active_contract
-- The client's most recent ACTIVE contract (one row per client, or no row if
-- the client has no active contract). Active = contract_status_label IN
-- ('Initial Term', 'Renewal Term'); the other labels ('Contract Expired',
-- 'Terminated') are inactive. Picks the row with the latest contract_start_date.
--
-- NOTE (data semantics, verified against real rows 2026-06):
--   * contract_renewal_date is NULL for currently-active contracts (it is only
--     backfilled once a term ends), so it is NOT used here. The forward-looking
--     renewal point is the end of the CURRENT term, which is also what the
--     KPI "Contract Renewal" tile uses.
--   * Each renewal is stored as its own row whose contract_start_date /
--     initial_term_end bound that term. For ~21% of clients the newest active
--     row's initial_term_end is already in the past (an auto-renewed term with
--     no fresh row), so current_term_end rolls the term length forward to the
--     first anniversary >= today.
--   * term length is parsed from initial_term_length_label ("12 Months" -> 12);
--     contract_length_years is mostly NULL and only used as a fallback.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_detail_active_contract AS
WITH ranked AS (
  SELECT
    c.*,
    COALESCE(
      NULLIF(regexp_replace(c.initial_term_length_label, '\D', '', 'g'), '')::int,
      NULLIF(ROUND(c.contract_length_years * 12)::int, 0),
      12
    ) AS term_months,
    ROW_NUMBER() OVER (
      PARTITION BY c.client_account_id
      ORDER BY c.contract_start_date DESC NULLS LAST
    ) AS rn
  FROM public.contracts c
  WHERE c.contract_status_label IN ('Initial Term', 'Renewal Term')
),
chosen AS (
  SELECT * FROM ranked WHERE rn = 1
),
with_term AS (
  SELECT
    ch.*,
    -- First term anniversary >= today (rolls auto-renewed terms forward).
    (
      SELECT MIN(g.d)::date
      FROM generate_series(
        ch.initial_term_end::timestamp,
        ch.initial_term_end::timestamp + INTERVAL '120 months',
        (ch.term_months || ' months')::interval
      ) AS g(d)
      WHERE g.d >= CURRENT_DATE
    ) AS current_term_end
  FROM chosen ch
)
SELECT
  wt.client_account_id AS account_id,
  wt.contract_id,
  wt.contract_url,
  wt.contract_status_label,
  CASE
    WHEN wt.current_term_end IS NULL THEN NULL
    ELSE (wt.current_term_end - (wt.term_months || ' months')::interval)::date
  END AS current_term_start,
  wt.current_term_end,
  wt.current_term_end AS renewal_date,
  CASE
    WHEN wt.current_term_end IS NULL THEN NULL
    ELSE (wt.current_term_end - CURRENT_DATE)::int
  END AS days_to_renewal,
  wt.auto_renew,
  -- Compact renewal length: "1yr", "2yr", "6mo". NULL when term length unknown.
  CASE
    WHEN wt.initial_term_length_label IS NULL THEN NULL
    WHEN wt.term_months % 12 = 0 THEN (wt.term_months / 12) || 'yr'
    ELSE wt.term_months || 'mo'
  END AS auto_renew_length_label,
  -- Notice period: prefer the day count ("60d"); fall back to the period label.
  CASE
    WHEN wt.termination_notice_days_label ~ '^[0-9]+$'
         AND wt.termination_notice_days_label::int > 0
      THEN wt.termination_notice_days_label || 'd'
    WHEN wt.termination_notice_label IS NOT NULL
      THEN wt.termination_notice_label
    ELSE NULL
  END AS notice_label,
  -- Strip the leading '*' some scope labels carry ("*Full Service").
  NULLIF(regexp_replace(wt.scope_label, '^\*', ''), '') AS scope_label
FROM with_term wt;


-- -----------------------------------------------------------------------------
-- v_client_detail_recent_note
-- The client's most recent client_notes row (one row per client, or none).
-- status_label is always 'Active' (the Dynamics record state, not a health
-- status) so it is intentionally not surfaced. status_text / primary_risk_driver
-- carry trailing newlines from the source, which are trimmed; a risk driver of
-- 'None' (or blank) is normalised to NULL so the UI can omit the pill.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_detail_recent_note AS
WITH ranked AS (
  SELECT
    n.client_account_id AS account_id,
    n.note_id,
    n.note_date,
    btrim(n.notes_text) AS notes_text,
    NULLIF(btrim(n.status_text), '') AS status_text,
    CASE
      WHEN lower(btrim(COALESCE(n.primary_risk_driver, ''))) IN ('', 'none') THEN NULL
      ELSE btrim(n.primary_risk_driver)
    END AS primary_risk_driver,
    NULLIF(btrim(n.action_step), '') AS action_step,
    NULLIF(btrim(n.action_owner), '') AS action_owner,
    n.action_deadline,
    ROW_NUMBER() OVER (
      PARTITION BY n.client_account_id
      ORDER BY n.note_date DESC, n.modified_on DESC NULLS LAST, n.created_on DESC NULLS LAST
    ) AS rn
  FROM public.client_notes n
  WHERE n.client_account_id IS NOT NULL
)
SELECT
  account_id,
  note_id,
  note_date,
  notes_text,
  status_text,
  primary_risk_driver,
  action_step,
  action_owner,
  action_deadline,
  CASE
    WHEN action_deadline IS NULL THEN NULL
    ELSE (action_deadline - CURRENT_DATE)::int
  END AS days_to_deadline
FROM ranked
WHERE rn = 1;


-- -----------------------------------------------------------------------------
-- v_client_detail_touchpoints
-- All touchpoints (relabeled phone calls / emails / etc.) for a client, most
-- recent first. owner_name is intentionally omitted: in the source it holds the
-- client COMPANY name rather than a Rose & Co person, so it is not meaningful
-- on a single-client page.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_detail_touchpoints AS
SELECT
  t.client_account_id AS account_id,
  t.touchpoint_id,
  t.scheduled_start,
  t.subject,
  t.touchpoint_type_label,
  t.direction_code,
  t.actual_duration_minutes
FROM public.touchpoints t
WHERE t.client_account_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- v_institution_summary
-- One row per distinct institution (by name) that has any confirmed meetings.
-- Powers the Institution Summary table at /institutions.
-- Every aggregation filters meeting_status_label = 'Confirmed'.
-- institution_id is picked from the most recent meeting for that name
-- (Postgres has no MIN() aggregate for the uuid type).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_institution_summary AS
WITH agg AS (
  SELECT
    m.institution_name,
    (array_agg(m.institution_id ORDER BY m.meeting_date DESC NULLS LAST))[1]
      AS institution_id,
    COUNT(*)::int AS lifetime_meetings,
    COUNT(*) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_meetings,
    COUNT(*) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '24 months'
        AND m.meeting_date <  CURRENT_DATE - INTERVAL '12 months'
    )::int AS prior_12mo_meetings,
    COUNT(DISTINCT m.client_account_id)::int AS unique_clients_lifetime,
    COUNT(DISTINCT NULLIF(COALESCE(m.investor_text, ''), ''))::int
      AS unique_people_lifetime,
    MIN(m.meeting_date)::date AS first_met,
    (MAX(m.meeting_date) FILTER (WHERE m.meeting_date <= now()))::date AS last_met
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
  GROUP BY m.institution_name
)
SELECT
  institution_id,
  institution_name,
  lifetime_meetings,
  ltm_meetings,
  prior_12mo_meetings,
  unique_clients_lifetime,
  unique_people_lifetime,
  first_met,
  last_met,
  (last_met >= CURRENT_DATE - INTERVAL '12 months') AS is_active,
  (last_met <  CURRENT_DATE - INTERVAL '24 months') AS is_cold,
  (lifetime_meetings >= 10) AS is_heavy_hitter
FROM agg
ORDER BY lifetime_meetings DESC, institution_name ASC;


-- -----------------------------------------------------------------------------
-- v_institution_detail_summary
-- One row per institution. KPI tiles + dropdown rows on the Institution
-- Detail page. last_met_client_name / last_met_host_name come from the
-- single most-recent confirmed meeting for that institution.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_institution_detail_summary AS
WITH agg AS (
  SELECT
    m.institution_name,
    (array_agg(m.institution_id ORDER BY m.meeting_date DESC NULLS LAST))[1]
      AS institution_id,
    COUNT(*)::int AS lifetime_meetings,
    COUNT(*) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_meetings,
    COUNT(*) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '24 months'
        AND m.meeting_date <  CURRENT_DATE - INTERVAL '12 months'
    )::int AS prior_12mo_meetings,
    COUNT(DISTINCT m.client_account_id)::int AS lifetime_clients,
    COUNT(DISTINCT m.client_account_id) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_clients,
    COUNT(DISTINCT NULLIF(COALESCE(m.investor_text, ''), ''))::int
      AS lifetime_people,
    COUNT(DISTINCT NULLIF(COALESCE(m.investor_text, ''), '')) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_people,
    COUNT(*) FILTER (
      WHERE m.feedback_status_label = 'Closed - All in'
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_feedback_collected,
    COUNT(*) FILTER (
      WHERE m.feedback_status_label IN ('Closed - All in', 'Closed - No Feedback')
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_feedback_total_closed,
    MIN(m.meeting_date)::date AS first_met,
    (MAX(m.meeting_date) FILTER (WHERE m.meeting_date <= now()))::date AS last_met
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
  GROUP BY m.institution_name
),
ranked_recent AS (
  SELECT
    m.institution_name,
    m.client_account_name,
    m.host_name,
    ROW_NUMBER() OVER (
      PARTITION BY m.institution_name
      ORDER BY m.meeting_date DESC
    ) AS rn
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
    AND m.meeting_date <= now()
),
last_met_info AS (
  SELECT
    institution_name,
    client_account_name AS last_met_client_name,
    host_name           AS last_met_host_name
  FROM ranked_recent
  WHERE rn = 1
)
SELECT
  a.institution_id,
  a.institution_name,
  a.lifetime_meetings,
  a.ltm_meetings,
  a.prior_12mo_meetings,
  (a.ltm_meetings - a.prior_12mo_meetings)::int AS ltm_meetings_delta,
  a.lifetime_clients,
  a.ltm_clients,
  a.lifetime_people,
  a.ltm_people,
  a.ltm_feedback_collected,
  a.ltm_feedback_total_closed,
  CASE
    WHEN a.ltm_feedback_total_closed = 0 THEN NULL
    ELSE a.ltm_feedback_collected::numeric
         / NULLIF(a.ltm_feedback_total_closed, 0)
  END AS ltm_feedback_rate,
  a.first_met,
  a.last_met,
  l.last_met_client_name,
  l.last_met_host_name
FROM agg a
LEFT JOIN last_met_info l ON l.institution_name = a.institution_name;


-- -----------------------------------------------------------------------------
-- v_institution_detail_quarterly
-- Last 8 quarters of confirmed meetings per institution, split by
-- live (in-person) vs virtual.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_institution_detail_quarterly AS
WITH inst_id AS (
  SELECT
    m.institution_name,
    (array_agg(m.institution_id ORDER BY m.meeting_date DESC NULLS LAST))[1]
      AS institution_id
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
  GROUP BY m.institution_name
)
SELECT
  i.institution_id,
  EXTRACT(YEAR FROM m.meeting_date)::int AS period_year,
  EXTRACT(QUARTER FROM m.meeting_date)::int AS period_quarter,
  EXTRACT(YEAR FROM m.meeting_date)::int::text
    || ' Q'
    || EXTRACT(QUARTER FROM m.meeting_date)::int::text
    AS period_label,
  COUNT(*) FILTER (WHERE m.is_in_person = true)::int  AS live_count,
  COUNT(*) FILTER (WHERE m.is_in_person = false)::int AS virtual_count,
  COUNT(*)::int AS total
FROM public.meetings m
JOIN inst_id i ON i.institution_name = m.institution_name
WHERE m.meeting_status_label = 'Confirmed'
  AND m.institution_name IS NOT NULL
  AND m.meeting_date >= date_trunc('quarter', CURRENT_DATE) - INTERVAL '21 months'
  AND m.meeting_date <= now()
GROUP BY i.institution_id, 2, 3, 4;


-- -----------------------------------------------------------------------------
-- v_institution_detail_top_clients
-- Top 10 Rose & Co clients per institution by lifetime confirmed meeting count.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_institution_detail_top_clients AS
WITH inst_id AS (
  SELECT
    m.institution_name,
    (array_agg(m.institution_id ORDER BY m.meeting_date DESC NULLS LAST))[1]
      AS institution_id
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
  GROUP BY m.institution_name
),
client_counts AS (
  SELECT
    i.institution_id,
    m.client_account_id,
    MAX(m.client_account_name) AS client_account_name,
    COUNT(*)::int AS lifetime_count,
    COUNT(*) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
    )::int AS ltm_count,
    (MAX(m.meeting_date) FILTER (WHERE m.meeting_date <= now()))::date AS last_met
  FROM public.meetings m
  JOIN inst_id i ON i.institution_name = m.institution_name
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
    AND m.client_account_id IS NOT NULL
  GROUP BY i.institution_id, m.client_account_id
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY institution_id
      ORDER BY lifetime_count DESC, last_met DESC
    ) AS rank
  FROM client_counts
)
SELECT
  institution_id,
  rank::int AS rank,
  client_account_id,
  client_account_name,
  lifetime_count,
  ltm_count,
  last_met
FROM ranked
WHERE rank <= 10;


-- -----------------------------------------------------------------------------
-- v_institution_detail_style
-- For each institution: distinct Rose & Co clients met, broken down by
-- market-cap bucket, sector, and region. One row per
-- (institution_id, dimension_type, bucket_label).
-- Each client is counted once per institution regardless of meeting count.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_institution_detail_style AS
WITH inst_id AS (
  SELECT
    m.institution_name,
    (array_agg(m.institution_id ORDER BY m.meeting_date DESC NULLS LAST))[1]
      AS institution_id
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
  GROUP BY m.institution_name
),
inst_clients AS (
  SELECT DISTINCT
    i.institution_id,
    m.client_account_id
  FROM public.meetings m
  JOIN inst_id i ON i.institution_name = m.institution_name
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
    AND m.client_account_id IS NOT NULL
),
joined AS (
  SELECT
    ic.institution_id,
    ic.client_account_id,
    a.market_cap_b,
    a.sector_label,
    a.hq_country_name
  FROM inst_clients ic
  LEFT JOIN public.accounts a ON a.account_id = ic.client_account_id
),
market_cap_rows AS (
  SELECT
    institution_id,
    'market_cap'::text AS dimension_type,
    CASE
      WHEN market_cap_b IS NULL THEN 'Micro'
      WHEN market_cap_b >= 200  THEN 'Mega'
      WHEN market_cap_b >= 10   THEN 'Large'
      WHEN market_cap_b >= 2    THEN 'Mid'
      WHEN market_cap_b >= 0.3  THEN 'Small'
      ELSE 'Micro'
    END AS bucket_label,
    CASE
      WHEN market_cap_b IS NULL THEN 5
      WHEN market_cap_b >= 200  THEN 1
      WHEN market_cap_b >= 10   THEN 2
      WHEN market_cap_b >= 2    THEN 3
      WHEN market_cap_b >= 0.3  THEN 4
      ELSE 5
    END AS bucket_order,
    COUNT(*)::int AS client_count
  FROM joined
  GROUP BY institution_id, 3, 4
),
sector_rows_raw AS (
  SELECT
    institution_id,
    'sector'::text AS dimension_type,
    COALESCE(sector_label, 'Unknown') AS bucket_label,
    COUNT(*)::int AS client_count
  FROM joined
  GROUP BY institution_id, 3
),
sector_rows AS (
  SELECT
    institution_id,
    dimension_type,
    bucket_label,
    ROW_NUMBER() OVER (
      PARTITION BY institution_id
      ORDER BY client_count DESC, bucket_label ASC
    )::int AS bucket_order,
    client_count
  FROM sector_rows_raw
),
region_rows AS (
  SELECT
    institution_id,
    'region'::text AS dimension_type,
    CASE
      WHEN hq_country_name IN (
        'United States','Canada','Mexico','Bermuda',
        'Brazil','Argentina','Chile','Colombia','Peru',
        'Venezuela','Ecuador','Bolivia','Uruguay','Paraguay',
        'Costa Rica','Panama','Guatemala','Honduras','Nicaragua',
        'El Salvador','Cuba','Dominican Republic','Puerto Rico'
      ) THEN 'Americas'
      WHEN hq_country_name IN (
        'Australia','Japan','Singapore','China','Hong Kong',
        'India','South Korea','New Zealand','Taiwan'
      ) THEN 'APAC'
      ELSE 'EMEA'
    END AS bucket_label,
    CASE
      WHEN hq_country_name IN (
        'United States','Canada','Mexico','Bermuda',
        'Brazil','Argentina','Chile','Colombia','Peru',
        'Venezuela','Ecuador','Bolivia','Uruguay','Paraguay',
        'Costa Rica','Panama','Guatemala','Honduras','Nicaragua',
        'El Salvador','Cuba','Dominican Republic','Puerto Rico'
      ) THEN 1
      WHEN hq_country_name IN (
        'Australia','Japan','Singapore','China','Hong Kong',
        'India','South Korea','New Zealand','Taiwan'
      ) THEN 3
      ELSE 2
    END AS bucket_order,
    COUNT(*)::int AS client_count
  FROM joined
  GROUP BY institution_id, 3, 4
)
SELECT institution_id, dimension_type, bucket_label, bucket_order, client_count
FROM market_cap_rows
UNION ALL
SELECT institution_id, dimension_type, bucket_label, bucket_order, client_count
FROM sector_rows
UNION ALL
SELECT institution_id, dimension_type, bucket_label, bucket_order, client_count
FROM region_rows;


-- -----------------------------------------------------------------------------
-- v_institution_detail_top_hosts
-- Top 5 hosts per institution in the trailing 12 months,
-- excluding 'CRM Administration' and NULL host_name.
-- -----------------------------------------------------------------------------
-- IDENTITY CAVEAT (name-merge, not canonical-id): groups hosts by host_name, so a
-- person with duplicate Dynamics user_ids is merged by NAME. Correct today (the
-- only duplicates, Brian Smith / Blair Mutschler, are same-person → name-merge ==
-- canonical-merge). If a genuine same-name collision of two DIFFERENT active
-- people ever appears, convert to public.canonical_user_id grouping. See the note
-- on public.user_id_aliases and v_analyst_monthly_activity's header.
CREATE OR REPLACE VIEW public.v_institution_detail_top_hosts AS
WITH inst_id AS (
  SELECT
    m.institution_name,
    (array_agg(m.institution_id ORDER BY m.meeting_date DESC NULLS LAST))[1]
      AS institution_id
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
  GROUP BY m.institution_name
),
host_counts AS (
  SELECT
    i.institution_id,
    m.host_name,
    (array_agg(m.host_id ORDER BY m.meeting_date DESC NULLS LAST))[1]
      AS host_id,
    COUNT(*)::int AS ltm_count,
    MAX(m.meeting_date)::date AS last_met
  FROM public.meetings m
  JOIN inst_id i ON i.institution_name = m.institution_name
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
    AND m.host_name IS NOT NULL
    AND m.host_name <> 'CRM Administration'
    AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
    AND m.meeting_date <= now()
  GROUP BY i.institution_id, m.host_name
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY institution_id
      ORDER BY ltm_count DESC, last_met DESC
    ) AS rn
  FROM host_counts
)
SELECT institution_id, host_name, host_id, ltm_count, last_met
FROM ranked
WHERE rn <= 5;


-- -----------------------------------------------------------------------------
-- v_institution_detail_recent_meetings
-- Last 25 confirmed meetings per institution, most recent first.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_institution_detail_recent_meetings AS
WITH inst_id AS (
  SELECT
    m.institution_name,
    (array_agg(m.institution_id ORDER BY m.meeting_date DESC NULLS LAST))[1]
      AS institution_id
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
  GROUP BY m.institution_name
),
ranked AS (
  SELECT
    i.institution_id,
    m.meeting_id,
    m.meeting_date,
    m.client_account_id,
    m.client_account_name,
    m.investor_text,
    m.host_name,
    m.host_id,
    m.meeting_type_label,
    m.is_in_person,
    ROW_NUMBER() OVER (
      PARTITION BY i.institution_id
      ORDER BY m.meeting_date DESC
    ) AS rn
  FROM public.meetings m
  JOIN inst_id i ON i.institution_name = m.institution_name
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
)
SELECT
  institution_id,
  meeting_id,
  meeting_date,
  client_account_id,
  client_account_name,
  investor_text,
  host_name,
  host_id,
  meeting_type_label,
  is_in_person
FROM ranked
WHERE rn <= 25;


-- -----------------------------------------------------------------------------
-- v_relationships
-- One row per investor institution (~1,524 rows). Powers the Relationships page:
-- who at Rose has the strongest hosting and booking relationship with each
-- institution, for two time windows.
--
-- DEFINITIONS (match the rest of the app's institution views):
--   * "Meeting"      = a Confirmed meeting (meeting_status_label = 'Confirmed').
--   * Institution    = grouped by meetings.institution_name (institution_id is
--                      just the id of the most-recent meeting for that name).
--   * Person         = matched by host_name / booker_name text (same fields the
--                      Feedback Collection and Host Calendar pages use). The
--                      system account 'CRM Administration' is excluded.
--   * LTM window     = meeting_date in the trailing 12 months (upper-bounded at
--                      now() because some meetings are future-dated).
--
-- PERCENTAGES: a person's share of the institution's meetings, i.e.
--   host_pct   = meetings that person HOSTED   for this institution / total
--   booker_pct = meetings that person BOOKED    for this institution / total
-- Because ~4% of meetings have no host (and a few no booker), the host / booker
-- percentages for an institution need NOT sum to 100 — that is intentional; the
-- denominator is total meetings, not total hosted/booked.
--
-- Both windows are emitted as columns on the same row (total_meetings_all /
-- _ltm, top_hosts_all / _ltm, top_bookers_all / _ltm) so the page can toggle
-- LTM vs All-time instantly without a refetch. Each top_* value is a jsonb
-- array of up to 4 objects {name, count, pct}, ranked high-to-low by count with
-- ties broken by most-recent meeting then name. An institution with no meetings
-- in the LTM window has total_meetings_ltm = 0 and empty LTM arrays (the page
-- hides those rows when the LTM toggle is active).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_relationships AS
WITH confirmed AS (
  SELECT
    m.institution_name,
    m.institution_id,
    m.meeting_date,
    m.host_name,
    m.booker_name,
    (m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
       AND m.meeting_date <= now()) AS is_ltm
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
),
inst AS (
  SELECT
    institution_name,
    (array_agg(institution_id ORDER BY meeting_date DESC NULLS LAST))[1]
      AS institution_id,
    COUNT(*)::int                          AS total_all,
    COUNT(*) FILTER (WHERE is_ltm)::int     AS total_ltm,
    -- Role-specific denominators for the percentages: total confirmed meetings
    -- MINUS meetings whose host (resp. booker) is a system/placeholder account
    -- ('CRM Administration' or a '#...' account). Null hosts/bookers stay in the
    -- denominator (the meeting happened; the person just wasn't recorded). These
    -- are what host_pct / booker_pct divide by, so the visible pill percentages
    -- add up over "meetings with a known host/booker" rather than all meetings.
    COUNT(*) FILTER (
      WHERE host_name IS NULL
         OR (host_name <> 'CRM Administration' AND host_name NOT LIKE '#%')
    )::int                                 AS host_denom_all,
    COUNT(*) FILTER (
      WHERE is_ltm AND (host_name IS NULL
         OR (host_name <> 'CRM Administration' AND host_name NOT LIKE '#%'))
    )::int                                 AS host_denom_ltm,
    COUNT(*) FILTER (
      WHERE booker_name IS NULL
         OR (booker_name <> 'CRM Administration' AND booker_name NOT LIKE '#%')
    )::int                                 AS booker_denom_all,
    COUNT(*) FILTER (
      WHERE is_ltm AND (booker_name IS NULL
         OR (booker_name <> 'CRM Administration' AND booker_name NOT LIKE '#%'))
    )::int                                 AS booker_denom_ltm,
    -- Forward-looking: the ET calendar date of the soonest confirmed meeting
    -- dated today or later. NULL when nothing is scheduled. Independent of the
    -- LTM/All-time window (which is backward-looking for the percentages).
    (
      MIN(meeting_date) FILTER (
        WHERE (meeting_date AT TIME ZONE 'America/New_York')::date
              >= (now() AT TIME ZONE 'America/New_York')::date
      ) AT TIME ZONE 'America/New_York'
    )::date                                AS next_meeting_date
  FROM confirmed
  GROUP BY institution_name
),
-- Long form: one row per meeting per role (host / booker). Excludes null names,
-- the 'CRM Administration' system account, and the '#...' placeholder accounts
-- (e.g. '# Rose & Company (Corporate Access)') — the same non-person names the
-- Productivity people-views drop with NOT LIKE '#%'.
tally AS (
  SELECT institution_name, 'host'::text AS role, host_name AS name, is_ltm, meeting_date
  FROM confirmed
  WHERE host_name IS NOT NULL
    AND host_name <> 'CRM Administration'
    AND host_name NOT LIKE '#%'
  UNION ALL
  SELECT institution_name, 'booker'::text AS role, booker_name AS name, is_ltm, meeting_date
  FROM confirmed
  WHERE booker_name IS NOT NULL
    AND booker_name <> 'CRM Administration'
    AND booker_name NOT LIKE '#%'
),
counts AS (
  SELECT
    institution_name,
    role,
    name,
    COUNT(*)::int                                     AS cnt_all,
    COUNT(*) FILTER (WHERE is_ltm)::int               AS cnt_ltm,
    MAX(meeting_date)                                 AS last_all,
    MAX(meeting_date) FILTER (WHERE is_ltm)           AS last_ltm
  FROM tally
  GROUP BY institution_name, role, name
),
ranked_all AS (
  SELECT
    c.institution_name, c.role, c.name, c.cnt_all,
    ROUND(100.0 * c.cnt_all / NULLIF(
      CASE WHEN c.role = 'host' THEN i.host_denom_all ELSE i.booker_denom_all END,
      0))::int AS pct_all,
    ROW_NUMBER() OVER (
      PARTITION BY c.institution_name, c.role
      ORDER BY c.cnt_all DESC, c.last_all DESC NULLS LAST, c.name
    ) AS rn
  FROM counts c
  JOIN inst i USING (institution_name)
  WHERE c.cnt_all > 0
),
ranked_ltm AS (
  SELECT
    c.institution_name, c.role, c.name, c.cnt_ltm,
    ROUND(100.0 * c.cnt_ltm / NULLIF(
      CASE WHEN c.role = 'host' THEN i.host_denom_ltm ELSE i.booker_denom_ltm END,
      0))::int AS pct_ltm,
    ROW_NUMBER() OVER (
      PARTITION BY c.institution_name, c.role
      ORDER BY c.cnt_ltm DESC, c.last_ltm DESC NULLS LAST, c.name
    ) AS rn
  FROM counts c
  JOIN inst i USING (institution_name)
  WHERE c.cnt_ltm > 0
),
agg_all AS (
  SELECT
    institution_name,
    jsonb_agg(jsonb_build_object('name', name, 'count', cnt_all, 'pct', pct_all)
              ORDER BY rn) FILTER (WHERE role = 'host')   AS top_hosts_all,
    jsonb_agg(jsonb_build_object('name', name, 'count', cnt_all, 'pct', pct_all)
              ORDER BY rn) FILTER (WHERE role = 'booker') AS top_bookers_all
  FROM ranked_all
  WHERE rn <= 4
  GROUP BY institution_name
),
agg_ltm AS (
  SELECT
    institution_name,
    jsonb_agg(jsonb_build_object('name', name, 'count', cnt_ltm, 'pct', pct_ltm)
              ORDER BY rn) FILTER (WHERE role = 'host')   AS top_hosts_ltm,
    jsonb_agg(jsonb_build_object('name', name, 'count', cnt_ltm, 'pct', pct_ltm)
              ORDER BY rn) FILTER (WHERE role = 'booker') AS top_bookers_ltm
  FROM ranked_ltm
  WHERE rn <= 4
  GROUP BY institution_name
),
-- Distinct Monday-anchored week-starts each institution has a confirmed meeting
-- in (all time, ANY status window — this powers the "week of X" row filter, not
-- the percentages). Monday anchor + Mon–Sun span matches the Planning V2 /
-- Scheduler week convention: date_trunc('week', ...) is Monday-based, evaluated
-- in America/New_York so the bucket matches the app's local calendar. Each entry
-- is a 'YYYY-MM-DD' Monday date; the page filters institutions whose array
-- contains the selected week's Monday.
weeks AS (
  SELECT
    institution_name,
    to_jsonb(array_agg(week_start ORDER BY week_start)) AS meeting_weeks
  FROM (
    SELECT DISTINCT
      institution_name,
      (date_trunc('week', meeting_date AT TIME ZONE 'America/New_York'))::date
        AS week_start
    FROM confirmed
  ) w
  GROUP BY institution_name
)
SELECT
  i.institution_id,
  i.institution_name,
  i.total_all                                   AS total_meetings_all,
  i.total_ltm                                   AS total_meetings_ltm,
  i.host_denom_all                              AS host_denom_all,
  i.host_denom_ltm                              AS host_denom_ltm,
  i.booker_denom_all                            AS booker_denom_all,
  i.booker_denom_ltm                            AS booker_denom_ltm,
  i.next_meeting_date                           AS next_meeting_date,
  COALESCE(aa.top_hosts_all,   '[]'::jsonb)      AS top_hosts_all,
  COALESCE(aa.top_bookers_all, '[]'::jsonb)      AS top_bookers_all,
  COALESCE(al.top_hosts_ltm,   '[]'::jsonb)      AS top_hosts_ltm,
  COALESCE(al.top_bookers_ltm, '[]'::jsonb)      AS top_bookers_ltm,
  COALESCE(w.meeting_weeks,    '[]'::jsonb)      AS meeting_weeks
FROM inst i
LEFT JOIN agg_all aa ON aa.institution_name = i.institution_name
LEFT JOIN agg_ltm al ON al.institution_name = i.institution_name
LEFT JOIN weeks   w  ON w.institution_name  = i.institution_name
ORDER BY i.institution_name;


-- -----------------------------------------------------------------------------
-- v_productivity_person_meeting
-- One row per (user, meeting, role). Each meeting contributes up to two rows
-- per person-role pair: one for the booker (if any) and one for the host (if
-- any). Powers the Productivity page, which filters by an arbitrary date range
-- and aggregates in the application layer.
--
-- The attributed_cost field uses the same cost model as v_meeting_costs:
--   loaded_annual = (salary + bonus) * benefits_multiplier
--   hourly        = loaded_annual / work_hours_per_year
--   hours         = booker_hours_per_meeting_base when role='booker'
--                   host_hours_per_meeting_base   when role='host'
--   When role='host' AND is_in_person, host hours are scaled by
--   in_person_multiplier (travel + attendance premium). Booker work gets no
--   in-person adjustment — booking effort is format-agnostic.
--   attributed_cost = hourly * hours [* in_person_multiplier if host & live]
-- with the salary_schedule record active on the meeting's date. Missing salary
-- records yield 0 (matches v_meeting_costs).
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_productivity_person_meeting AS
WITH params AS (
  SELECT * FROM public.cost_assumptions WHERE id = 1
),
booker_attribution AS (
  SELECT
    m.meeting_id,
    m.booker_id                                          AS user_id,
    'booker'::text                                       AS role,
    m.meeting_date::date                                 AS meeting_date,
    m.client_account_id,
    m.is_in_person,
    m.meeting_status_label,
    m.feedback_status_label,
    COALESCE(m.group_meeting, false)                     AS group_meeting,
    COALESCE(
      ((s.annual_salary + s.annual_bonus) * s.benefits_multiplier
        / NULLIF(p.work_hours_per_year, 0))
      * p.booker_hours_per_meeting_base,
      0
    )                                                    AS attributed_cost
  FROM public.meetings m
  CROSS JOIN params p
  LEFT JOIN public.salary_schedule s
    ON s.user_id = m.booker_id
    AND m.meeting_date::date >= s.effective_from
    AND m.meeting_date::date <= COALESCE(s.effective_to, DATE '9999-12-31')
  WHERE m.booker_id   IS NOT NULL
    AND m.meeting_date IS NOT NULL
),
host_attribution AS (
  SELECT
    m.meeting_id,
    m.host_id                                            AS user_id,
    'host'::text                                         AS role,
    m.meeting_date::date                                 AS meeting_date,
    m.client_account_id,
    m.is_in_person,
    m.meeting_status_label,
    m.feedback_status_label,
    COALESCE(m.group_meeting, false)                     AS group_meeting,
    COALESCE(
      ((s.annual_salary + s.annual_bonus) * s.benefits_multiplier
        / NULLIF(p.work_hours_per_year, 0))
      * p.host_hours_per_meeting_base
      * (CASE WHEN m.is_in_person THEN p.in_person_multiplier ELSE 1.0 END),
      0
    )                                                    AS attributed_cost
  FROM public.meetings m
  CROSS JOIN params p
  LEFT JOIN public.salary_schedule s
    ON s.user_id = m.host_id
    AND m.meeting_date::date >= s.effective_from
    AND m.meeting_date::date <= COALESCE(s.effective_to, DATE '9999-12-31')
  WHERE m.host_id     IS NOT NULL
    AND m.meeting_date IS NOT NULL
)
SELECT
  pm.user_id,
  u.display_name,
  pm.meeting_id,
  pm.meeting_date,
  pm.role,
  pm.client_account_id,
  pm.is_in_person,
  pm.meeting_status_label,
  pm.feedback_status_label,
  pm.group_meeting,
  pm.attributed_cost,
  -- Canonical identity for the person (booker or host) this row attributes to.
  -- The JS aggregations (Productivity Summary, Capacity) group by this so a
  -- person split across duplicate Dynamics ids collapses to one row, without
  -- re-deriving the alias map in JS. Non-aliased ids resolve to themselves.
  public.canonical_user_id(pm.user_id) AS canonical_user_id
FROM (
  SELECT * FROM booker_attribution
  UNION ALL
  SELECT * FROM host_attribution
) pm
LEFT JOIN public.users u ON u.user_id = pm.user_id;


-- -----------------------------------------------------------------------------
-- v_productivity_person_manager_stats
-- One row per user, with the current snapshot of how many client accounts they
-- appear on as Primary Manager (sales_lead_primary_id) or Secondary Manager
-- (secondary_manager_id). Counts are point-in-time — they reflect the current
-- accounts table, not historical assignments. Includes every user from the
-- users table (zero counts where unassigned) so a LEFT JOIN downstream cannot
-- drop people who aren't currently managers.
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_productivity_person_manager_stats AS
-- Wrapped: folded by public.canonical_user_id so a person with duplicate Dynamics
-- ids has one manager-stats row (counts summed across the ids).
WITH base AS (
WITH primary_counts AS (
  SELECT sales_lead_primary_id AS user_id, COUNT(*)::int AS primary_count
  FROM public.accounts
  WHERE sales_lead_primary_id IS NOT NULL
  GROUP BY sales_lead_primary_id
),
secondary_counts AS (
  SELECT secondary_manager_id AS user_id, COUNT(*)::int AS secondary_count
  FROM public.accounts
  WHERE secondary_manager_id IS NOT NULL
  GROUP BY secondary_manager_id
)
SELECT
  u.user_id,
  u.display_name,
  COALESCE(pc.primary_count,   0) AS primary_manager_account_count,
  COALESCE(sc.secondary_count, 0) AS secondary_manager_account_count
FROM public.users u
LEFT JOIN primary_counts   pc ON pc.user_id = u.user_id
LEFT JOIN secondary_counts sc ON sc.user_id = u.user_id
)
SELECT
  public.canonical_user_id(b.user_id) AS user_id,
  cu.display_name,
  SUM(b.primary_manager_account_count)::int   AS primary_manager_account_count,
  SUM(b.secondary_manager_account_count)::int AS secondary_manager_account_count
FROM base b
JOIN public.users cu ON cu.user_id = public.canonical_user_id(b.user_id)
GROUP BY public.canonical_user_id(b.user_id), cu.display_name;


-- -----------------------------------------------------------------------------
-- v_institution_style_meetings
-- One row per qualifying confirmed meeting for the Institution Style page,
-- joined to its client's style attributes. Powers client-side ranking of
-- institutions by the share of their meetings spent with clients of a chosen
-- style (market cap / sector / region) and/or a chosen set of named clients.
--
-- Qualifying meeting: meeting_status_label = 'Confirmed' and institution_name
-- NOT NULL. NB this is NOT scoped to active clients — every confirmed meeting
-- is kept (including former/inactive clients and meetings with a NULL or
-- unmatched client_account_id) via a LEFT JOIN to accounts, so Total here
-- reconciles with v_institution_detail_summary's lifetime meeting count.
--
-- The three bucket columns intentionally reuse the EXACT CASE logic from the
-- Client Statistics views (v_client_stats_by_market_cap / _by_sector /
-- _by_region) so the bucket values match that page — note this differs from
-- v_institution_detail_style, which buckets unknowns differently. Because the
-- join is a LEFT JOIN, a missing account leaves every attribute NULL, which the
-- existing NULL/blank branches already resolve to 'Unknown' — so meetings with
-- no matching account bucket as 'Unknown' across all three dimensions.
--
-- institution_id is stabilised per institution_name via the
-- (array_agg(... ORDER BY meeting_date DESC NULLS LAST))[1] pattern used by the
-- other institution views, so links land on a consistent detail page.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_institution_style_meetings AS
WITH inst_id AS (
  SELECT
    m.institution_name,
    (array_agg(m.institution_id ORDER BY m.meeting_date DESC NULLS LAST))[1]
      AS institution_id
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.institution_name IS NOT NULL
  GROUP BY m.institution_name
)
SELECT
  i.institution_id,
  m.institution_name,
  m.client_account_id,
  CASE
    WHEN a.market_cap_b IS NULL          THEN 'Unknown'::text
    WHEN a.market_cap_b >= 200::numeric  THEN 'Mega'::text
    WHEN a.market_cap_b >= 10::numeric   THEN 'Large'::text
    WHEN a.market_cap_b >= 2::numeric    THEN 'Mid'::text
    WHEN a.market_cap_b >= 0.3           THEN 'Small'::text
    ELSE                                      'Micro'::text
  END AS market_cap_bucket,
  COALESCE(NULLIF(TRIM(BOTH FROM a.sector_label), ''::text), 'Unknown'::text)
    AS sector_bucket,
  CASE
    WHEN a.hq_country_name IS NULL OR TRIM(BOTH FROM a.hq_country_name) = ''::text
      THEN 'Unknown'::text
    WHEN a.hq_country_name = ANY (ARRAY[
      'United States'::text, 'Canada'::text, 'Mexico'::text, 'Brazil'::text,
      'Argentina'::text, 'Chile'::text, 'Colombia'::text, 'Peru'::text
    ]) THEN 'Americas'::text
    WHEN a.hq_country_name = ANY (ARRAY[
      'United Kingdom'::text, 'Germany'::text, 'France'::text, 'Italy'::text,
      'Spain'::text, 'Netherlands'::text, 'Switzerland'::text, 'Sweden'::text,
      'Norway'::text, 'Denmark'::text, 'Finland'::text, 'Ireland'::text,
      'Belgium'::text, 'Austria'::text, 'Portugal'::text, 'Israel'::text,
      'Saudi Arabia'::text, 'UAE'::text, 'South Africa'::text, 'Turkey'::text,
      'Poland'::text
    ]) THEN 'EMEA'::text
    WHEN a.hq_country_name = ANY (ARRAY[
      'Japan'::text, 'China'::text, 'Hong Kong'::text, 'Taiwan'::text,
      'South Korea'::text, 'Australia'::text, 'New Zealand'::text,
      'Singapore'::text, 'India'::text, 'Indonesia'::text, 'Malaysia'::text,
      'Thailand'::text, 'Philippines'::text, 'Vietnam'::text
    ]) THEN 'APAC'::text
    ELSE 'Unknown'::text
  END AS region_bucket,
  (m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
   AND m.meeting_date <= now()) AS is_ltm,
  -- Unique per-row id. Appended last (Postgres forbids reordering existing view
  -- columns under CREATE OR REPLACE). The institution-style page paginates this
  -- view; meeting_id gives its fetch a stable unique total order so no row is
  -- dropped/duplicated across 1000-row page boundaries.
  m.meeting_id
FROM public.meetings m
JOIN inst_id i ON i.institution_name = m.institution_name
LEFT JOIN public.accounts a
  ON a.account_id = m.client_account_id
WHERE m.meeting_status_label = 'Confirmed'
  AND m.institution_name IS NOT NULL;


-- -----------------------------------------------------------------------------
-- v_scheduler_meetings
-- One row per confirmed meeting that has a host and a real start time. Powers
-- the Scheduler page (host availability — Day view across all hosts, Week view
-- for one host).
--
-- Times are reported as the meeting's stored wall-clock value, shown verbatim.
-- IMPORTANT: meeting_date is a timestamptz, but the source data is NAIVE local
-- wall-clock time tagged with a UTC (+00) offset — i.e. a meeting that really
-- happens at 12:00 is stored as 12:00:00+00. The stored clock digits ARE the
-- intended display time, so we must NOT shift zones. Converting to
-- America/New_York would invent a 4–5h error (e.g. UK/Australia calls stored at
-- their local morning hours would land at impossible Eastern times like 00:30).
--
-- To read the stored digits back independently of the database session zone we
-- use AT TIME ZONE 'UTC' (surfaces the +00 wall clock as-is), then EXTRACT. So a
-- meeting stored 14:00:00+00 reports start_minutes = 840, verbatim. NB the data
-- mixes each party's own local zone (a London 9:00 is London time) — for the
-- Eastern-based scheduler we pragmatically show the stored clock as-is.
--
-- meeting_day, dow, and start_minutes are all computed from the same stored
-- value so they agree with each other.
--
-- Occupied intervals are intentionally NOT computed here. The page derives them
-- from start_minutes + is_in_person (1h core; virtual = [start, start+60];
-- in-person = [start-45, start+60+45] with a 45-minute travel buffer each side)
-- so the duration assumptions live in one place and are easy to change.
--
-- The host list is derived from this view's distinct host_id/host_name on the
-- page, so only users who have actually hosted a confirmed meeting appear. The
-- non-hosting service account 'CRM Administration' is excluded by name here as
-- a guard in case it is ever attached as a host.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_scheduler_meetings AS
SELECT
  m.meeting_id,
  m.host_id,
  m.host_name,
  m.meeting_date,
  (
    EXTRACT(HOUR   FROM (m.meeting_date AT TIME ZONE 'UTC')) * 60 +
    EXTRACT(MINUTE FROM (m.meeting_date AT TIME ZONE 'UTC'))
  )::int AS start_minutes,
  (m.meeting_date AT TIME ZONE 'UTC')::date AS meeting_day,
  EXTRACT(ISODOW FROM (m.meeting_date AT TIME ZONE 'UTC'))::int AS dow,
  m.is_in_person,
  m.client_account_name,
  m.institution_name,
  -- Appended last so CREATE OR REPLACE VIEW only adds a column (Postgres
  -- forbids reordering/renaming existing view columns).
  a.ticker_symbol AS client_ticker
FROM public.meetings m
LEFT JOIN public.accounts a ON a.account_id = m.client_account_id
WHERE m.meeting_status_label = 'Confirmed'
  AND m.host_id IS NOT NULL
  AND m.meeting_date IS NOT NULL
  AND COALESCE(m.host_name, '') <> 'CRM Administration';


-- -----------------------------------------------------------------------------
-- v_scheduler_unassigned
-- One row per confirmed, upcoming meeting that has NO host. Powers the
-- "Unassigned meetings" section on the Scheduler page, which proposes a likely
-- host for each (computed client-side from v_scheduler_meetings).
--
-- Times use the SAME stored-wall-clock reading as v_scheduler_meetings (read
-- as-is via AT TIME ZONE 'UTC' — see that view's note on why we must NOT shift
-- zones) so start_minutes / meeting_day line up exactly with hosted meetings;
-- the page compares occupied intervals across the two sets to detect host
-- conflicts, so they must share one clock. "Upcoming" is judged on the stored
-- meeting date >= today.
--
-- This set is small (host-less confirmed meetings from today onward), so the
-- page fetches it in a single request with no pagination.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_scheduler_unassigned AS
SELECT
  m.meeting_id,
  m.meeting_date,
  (
    EXTRACT(HOUR   FROM (m.meeting_date AT TIME ZONE 'UTC')) * 60 +
    EXTRACT(MINUTE FROM (m.meeting_date AT TIME ZONE 'UTC'))
  )::int AS start_minutes,
  (m.meeting_date AT TIME ZONE 'UTC')::date AS meeting_day,
  m.is_in_person,
  m.institution_name,
  m.client_account_id,
  m.client_account_name,
  a.ticker_symbol AS client_ticker
FROM public.meetings m
LEFT JOIN public.accounts a ON a.account_id = m.client_account_id
WHERE m.meeting_status_label = 'Confirmed'
  AND m.host_id IS NULL
  AND m.meeting_date IS NOT NULL
  AND (m.meeting_date AT TIME ZONE 'UTC')::date >= CURRENT_DATE;


-- -----------------------------------------------------------------------------
-- v_feedback_outstanding
-- One row per concluded, confirmed, hosted meeting whose feedback is still
-- incomplete — i.e. the host has not closed it out. Powers the Feedback page's
-- "outstanding feedback" tracker.
--
-- "Incomplete" = feedback_status_label IS NULL (never started / blank) OR
-- 'Awaiting Additional' (partial). Done states such as 'Closed - All in' and
-- 'Closed - No Feedback' are intentionally excluded.
--
-- "Concluded" is judged on the meeting's Eastern calendar date being strictly
-- before Eastern today, and days_since is the whole-day gap between those two
-- Eastern dates. Both use AT TIME ZONE 'America/New_York' per the page spec.
-- NB this differs from v_scheduler_meetings, which reads the stored +00 wall
-- clock as-is; here we follow the requested Eastern-local basis.
--
-- This set is small, so the page fetches it in a single request.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_feedback_outstanding AS
SELECT
  m.meeting_id,
  m.meeting_date,
  -- In THIS view, host_id/host_name carry the Feedback-responsible person
  -- (Dynamics bcs_feedback), falling back to the meeting Host when that field is
  -- unset. The output column names are kept as host_id/host_name so the email
  -- builder, the /feedback page, and the FeedbackOutstandingRow type need no
  -- edits — but a reader should not assume these are the meeting Host. The
  -- Feedback person lives only in meetings._raw (the mirror table has no column
  -- for it), same _raw pattern the Live Outreach city lookup uses.
  COALESCE(NULLIF(m._raw->>'_bcs_feedback_value', '')::uuid, m.host_id)                                              AS host_id,
  COALESCE(NULLIF(m._raw->>'_bcs_feedback_value@OData.Community.Display.V1.FormattedValue', ''), m.host_name)          AS host_name,
  m.client_account_id,
  m.client_account_name,
  m.institution_name,
  m.is_in_person,
  COALESCE(m.group_meeting, false) AS group_meeting,
  m.feedback_status_label,
  (
    (now() AT TIME ZONE 'America/New_York')::date
    - (m.meeting_date AT TIME ZONE 'America/New_York')::date
  )::int AS days_since,
  -- Free-text individual investor(s) who attended; may list several names in
  -- one string. Same field the Live Outreach card shows as the meeting contact.
  -- Free-text individual investor(s) who attended; may list several names in
  -- one string. Same field the Live Outreach card shows as the meeting contact.
  m.investor_text,
  -- Client stock ticker (accounts.ticker_symbol), appended last so CREATE OR
  -- REPLACE VIEW only adds a trailing column (Postgres forbids reordering/
  -- renaming existing view columns). Same join pattern as v_scheduler_meetings.
  a.ticker_symbol AS client_ticker
FROM public.meetings m
LEFT JOIN public.accounts a ON a.account_id = m.client_account_id
WHERE m.meeting_status_label = 'Confirmed'
  -- Drop DEACTIVATED meetings. state_label is the Dataverse statecode
  -- ('Active' / 'Inactive'), distinct from meeting_status_label above; without
  -- this, deactivated-but-still-Confirmed meetings leak onto the /feedback page
  -- and into the Outstanding Feedback email.
  AND m.state_label = 'Active'
  AND m.host_id IS NOT NULL
  AND m.meeting_date IS NOT NULL
  AND (m.meeting_date AT TIME ZONE 'America/New_York')::date
      < (now() AT TIME ZONE 'America/New_York')::date
  AND (
    m.feedback_status_label IS NULL
    OR m.feedback_status_label = 'Awaiting Additional'
  );


-- -----------------------------------------------------------------------------
-- v_meetings_monthly
-- Firm-wide confirmed meetings bucketed by calendar month, split by
-- virtual vs live (in-person). Same definitions as the *_detail_quarterly
-- views: meeting_status_label = 'Confirmed', and is_in_person true = live,
-- false = virtual. Covers the trailing 48 months (~4 years) so both the
-- People → Statistics charts (12-month monthly, 4-year quarterly, 3-year
-- seasonality) have their data. One row per (year, month).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_meetings_monthly AS
SELECT
  EXTRACT(YEAR FROM m.meeting_date)::int AS period_year,
  EXTRACT(MONTH FROM m.meeting_date)::int AS period_month,
  to_char(
    make_date(
      EXTRACT(YEAR FROM m.meeting_date)::int,
      EXTRACT(MONTH FROM m.meeting_date)::int,
      1
    ),
    'YYYY-MM'
  ) AS period_label,
  COUNT(*) FILTER (WHERE m.is_in_person = false)::int AS virtual_count,
  COUNT(*) FILTER (WHERE m.is_in_person = true)::int  AS live_count,
  COUNT(*)::int AS total
FROM public.meetings m
WHERE m.meeting_status_label = 'Confirmed'
  AND m.meeting_date IS NOT NULL
  AND m.meeting_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '47 months'
  AND m.meeting_date <= now()
GROUP BY 1, 2, 3;


-- -----------------------------------------------------------------------------
-- v_person_activity_windows
-- Per-person confirmed-meeting counts (firm-wide), booked vs hosted, over two
-- windows: trailing 30 days and trailing 12 months. Keyed by user_id so it
-- joins cleanly to v_person_role_ttm (which supplies the stable TTM role used
-- for grouping on the People → Statistics "Activity by Person" chart). Same
-- universe and conventions as v_person_role_ttm: active in the last 12 months,
-- Eastern-time windows, 'CRM Administration'/'#%' accounts excluded. The _1y
-- columns equal v_person_role_ttm.booked_ttm / hosted_ttm by construction.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_person_activity_windows AS
-- Wrapped: inner `base` counts per raw user_id; outer folds duplicate Dynamics
-- ids into one person via public.canonical_user_id (see public.user_id_aliases).
WITH base AS (
WITH active_users AS (
  SELECT DISTINCT booker_id AS user_id
  FROM public.meetings
  WHERE booker_id IS NOT NULL
    AND meeting_status_label = 'Confirmed'
    AND meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
    AND meeting_date <= now()
  UNION
  SELECT DISTINCT host_id
  FROM public.meetings
  WHERE host_id IS NOT NULL
    AND meeting_status_label = 'Confirmed'
    AND meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
    AND meeting_date <= now()
)
SELECT
  au.user_id,
  u.display_name,
  COUNT(*) FILTER (
    WHERE m.booker_id = au.user_id
      AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '30 days'
      AND m.meeting_date <= now()
  )::int AS booked_30d,
  COUNT(*) FILTER (
    WHERE m.host_id = au.user_id
      AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '30 days'
      AND m.meeting_date <= now()
  )::int AS hosted_30d,
  COUNT(*) FILTER (WHERE m.booker_id = au.user_id)::int AS booked_1y,
  COUNT(*) FILTER (WHERE m.host_id  = au.user_id)::int AS hosted_1y
FROM active_users au
JOIN public.users u ON u.user_id = au.user_id
LEFT JOIN public.meetings m
  ON (m.booker_id = au.user_id OR m.host_id = au.user_id)
  AND m.meeting_status_label = 'Confirmed'
  AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
  AND m.meeting_date <= now()
WHERE u.display_name IS NOT NULL
  AND u.display_name != 'CRM Administration'
  AND u.display_name NOT LIKE '#%'
GROUP BY au.user_id, u.display_name
)
SELECT
  public.canonical_user_id(b.user_id) AS user_id,
  cu.display_name,
  SUM(b.booked_30d)::int AS booked_30d,
  SUM(b.hosted_30d)::int AS hosted_30d,
  SUM(b.booked_1y)::int  AS booked_1y,
  SUM(b.hosted_1y)::int  AS hosted_1y
FROM base b
JOIN public.users cu ON cu.user_id = public.canonical_user_id(b.user_id)
GROUP BY public.canonical_user_id(b.user_id), cu.display_name;


-- -----------------------------------------------------------------------------
-- v_person_feedback_windows
-- Per-person feedback completion (firm-wide), attributed to the meeting HOST,
-- over two windows: trailing 30 days and trailing 12 months.
--
-- Feedback rate = collected / assigned, where:
--   collected = confirmed hosted meetings with feedback_status_label
--               = 'Closed - All in'
--   assigned  = confirmed hosted meetings whose feedback was actually on the
--               hook and RESOLVED, i.e. feedback_status_label IN
--               ('Closed - All in', 'Closed - No Feedback'). The still-open
--               'Awaiting Additional' and the never-assigned NULL/blank rows
--               are deliberately excluded from the denominator.
--
-- NOTE: this is a different (correct) denominator than the productivity page's
-- feedback-vs-hosted ratio, which divides by hosted meetings. Same conventions
-- as the other person views: confirmed only, Eastern-time windows, and the
-- 'CRM Administration'/'#%' accounts excluded. The <25 low-volume exclusion is
-- applied in the app, on the `assigned` count.
-- -----------------------------------------------------------------------------
-- The *_prev_1y columns cover the 12 months BEFORE the trailing year (i.e. the
-- 13th–24th months back); summed firm-wide they drive the Feedback KPI card's
-- year-over-year trend. The per-person chart ignores them. The host universe
-- spans 24 months so prior-year-only hosts still contribute to the firm-wide
-- prior total (they fall out of the chart via the <25 assigned_1y filter).
CREATE OR REPLACE VIEW public.v_person_feedback_windows AS
-- Wrapped: inner `base` counts per raw host user_id; outer folds duplicate
-- Dynamics ids into one person via public.canonical_user_id (see
-- public.user_id_aliases). Firm-wide sums are unchanged (sum is associative);
-- only per-person rows for the curated duplicates collapse.
WITH base AS (
WITH active_hosts AS (
  SELECT DISTINCT host_id AS user_id
  FROM public.meetings
  WHERE host_id IS NOT NULL
    AND meeting_status_label = 'Confirmed'
    AND meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '24 months'
    AND meeting_date <= now()
)
SELECT
  ah.user_id,
  u.display_name,
  COUNT(*) FILTER (
    WHERE m.feedback_status_label IN ('Closed - All in', 'Closed - No Feedback')
      AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '30 days'
      AND m.meeting_date <= now()
  )::int AS assigned_30d,
  COUNT(*) FILTER (
    WHERE m.feedback_status_label = 'Closed - All in'
      AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '30 days'
      AND m.meeting_date <= now()
  )::int AS collected_30d,
  COUNT(*) FILTER (
    WHERE m.feedback_status_label IN ('Closed - All in', 'Closed - No Feedback')
      AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
      AND m.meeting_date <= now()
  )::int AS assigned_1y,
  COUNT(*) FILTER (
    WHERE m.feedback_status_label = 'Closed - All in'
      AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
      AND m.meeting_date <= now()
  )::int AS collected_1y,
  COUNT(*) FILTER (
    WHERE m.feedback_status_label IN ('Closed - All in', 'Closed - No Feedback')
      AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '24 months'
      AND m.meeting_date <  (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
  )::int AS assigned_prev_1y,
  COUNT(*) FILTER (
    WHERE m.feedback_status_label = 'Closed - All in'
      AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '24 months'
      AND m.meeting_date <  (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'
  )::int AS collected_prev_1y
FROM active_hosts ah
JOIN public.users u ON u.user_id = ah.user_id
LEFT JOIN public.meetings m
  ON m.host_id = ah.user_id
  AND m.meeting_status_label = 'Confirmed'
  AND m.meeting_date >= (now() AT TIME ZONE 'America/New_York')::date - interval '24 months'
  AND m.meeting_date <= now()
WHERE u.display_name IS NOT NULL
  AND u.display_name != 'CRM Administration'
  AND u.display_name NOT LIKE '#%'
GROUP BY ah.user_id, u.display_name
)
SELECT
  public.canonical_user_id(b.user_id) AS user_id,
  cu.display_name,
  SUM(b.assigned_30d)::int      AS assigned_30d,
  SUM(b.collected_30d)::int     AS collected_30d,
  SUM(b.assigned_1y)::int       AS assigned_1y,
  SUM(b.collected_1y)::int      AS collected_1y,
  SUM(b.assigned_prev_1y)::int  AS assigned_prev_1y,
  SUM(b.collected_prev_1y)::int AS collected_prev_1y
FROM base b
JOIN public.users cu ON cu.user_id = public.canonical_user_id(b.user_id)
GROUP BY public.canonical_user_id(b.user_id), cu.display_name;


-- -----------------------------------------------------------------------------
-- v_profiles_upcoming
-- One row per UPCOMING meeting for the Logistics -> Profiles dashboard, a board
-- of the next three BUSINESS weeks tracking each meeting's "profile" pipeline
-- stage (meetings.profile_label).
--
-- The stage is profile_label, ordered by profile_code:
--   New (0) -> Created/Under Review (1) -> Approved (2) -> Sent (3) ->
--   Not Needed (4, terminal "no profile required").
-- ALL stages are included here; the UI multi-select hides Sent by default. The
-- view does not special-case any stage.
--
-- Forward-only: only meetings whose date is today or later are included, for
-- EVERY stage, so the board never shows anything behind us.
--
-- Cancelled meetings are excluded; TBR/Pending/Confirmed are kept (a TBR or
-- pending meeting is still upcoming work the team is staging a profile for).
--
-- Business weeks (Mon-Fri only): weekend meetings are excluded (ISODOW <= 5),
-- and the window is anchored to a Monday:
--   * Mon-Fri today  -> anchor = this week's Monday.
--   * Sat/Sun today  -> anchor = NEXT Monday, so once Friday completes the whole
--     board shifts forward a week (the finished week drops off, a new 3rd week
--     appears). This is the "shift after Friday" rule.
-- week_index is whole-weeks from that anchor: 0 = current business week,
-- 1 = next, 2 = the week after. Capped at <= 2 (three weeks).
--
-- Dates follow the v_scheduler_* convention: the stored timestamptz is read as
-- its wall-clock value via AT TIME ZONE 'UTC' (NOT shifted into a local zone),
-- so meeting_day is stable regardless of server timezone. CURRENT_DATE is the
-- DB session date (Supabase runs UTC), so the anchor and meeting_day share one
-- clock.
--
-- Account managers come from the client account (meetings have none): the join
-- meeting.client_account_id -> accounts.account_id exposes the primary
-- (sales_lead_primary_name) and secondary (secondary_manager_name) managers
-- that power the two manager filters. Most clients have no secondary manager,
-- so secondary_manager_name is frequently NULL.
--
-- This set is small (a three-week forward window), so the page fetches it in a
-- single request with no pagination.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_profiles_upcoming AS
WITH anchor AS (
  -- Monday that begins the current business week, rolled forward to next Monday
  -- on weekends so the board advances the moment Friday is done.
  SELECT CASE
    WHEN EXTRACT(ISODOW FROM CURRENT_DATE) IN (6, 7)
      THEN date_trunc('week', CURRENT_DATE)::date + 7
    ELSE date_trunc('week', CURRENT_DATE)::date
  END AS monday
)
SELECT
  m.meeting_id,
  m.meeting_date,
  (m.meeting_date AT TIME ZONE 'UTC')::date AS meeting_day,
  (((m.meeting_date AT TIME ZONE 'UTC')::date - anchor.monday) / 7)::int AS week_index,
  m.profile_label,
  m.profile_code,
  m.is_in_person,
  m.client_account_id,
  m.client_account_name,
  m.institution_name,
  a.sales_lead_primary_name AS primary_manager_name,
  a.secondary_manager_name  AS secondary_manager_name,
  -- Event name is not a mirrored column; it lives in the Dynamics lookup's
  -- formatted value inside _raw. Trim trailing/double spaces and treat blanks
  -- as NULL so the UI's event dropdown lists clean, de-duplicated names.
  -- Appended last so CREATE OR REPLACE VIEW only ADDS a column.
  NULLIF(TRIM(m._raw ->> '_bcs_event_value@OData.Community.Display.V1.FormattedValue'), '')
    AS event_name,
  -- Event-level SharePoint document link, joined from the event via
  -- meetings.event_id. NULL for every event until events.sharepoint_url is
  -- populated; the Profiles card shows a muted placeholder icon meanwhile.
  -- Appended last so CREATE OR REPLACE VIEW only ADDS a column.
  e.sharepoint_url AS event_sharepoint_url
FROM public.meetings m
CROSS JOIN anchor
LEFT JOIN public.accounts a ON a.account_id = m.client_account_id
LEFT JOIN public.events e ON e.event_id = m.event_id
WHERE m.meeting_date IS NOT NULL
  AND m.profile_label IS NOT NULL
  AND COALESCE(m.meeting_status_label, '') <> 'Cancelled'
  AND (m.meeting_date AT TIME ZONE 'UTC')::date >= CURRENT_DATE
  AND EXTRACT(ISODOW FROM (m.meeting_date AT TIME ZONE 'UTC')::date) <= 5
  AND (((m.meeting_date AT TIME ZONE 'UTC')::date - anchor.monday) / 7)::int
      BETWEEN 0 AND 2;


-- -----------------------------------------------------------------------------
-- v_planning_events
-- One row per Confirmed meeting belonging to an UPCOMING event, for the
-- Logistics -> Planning tracker. The page is a master-detail board: each
-- upcoming event lists its meetings chronologically and tracks every meeting
-- across four planning stages (Profiles, Calendars, Hosts, Feedback).
--
-- Event identity is meetings.event_id (a stable Dynamics lookup id), NOT the
-- event NAME. The display name lives in the lookup's formatted value inside
-- _raw (same source as v_profiles_upcoming.event_name), but that string embeds
-- an editable date list, so the SAME event_id can carry slightly different name
-- strings over time. Grouping by name would split one event into several;
-- grouping by event_id keeps it whole. Meetings with no event_id are not part
-- of any event and are excluded.
--
-- Scope (the event LIST): an event is "upcoming" iff it has >= 1 Confirmed
-- meeting dated today-or-later (meeting_day >= CURRENT_DATE).
--
-- Rows returned (the event DETAIL): for every upcoming event, ALL of its
-- Confirmed meetings -- past AND future -- so opening an event shows the full
-- picture including already-completed meetings. is_past flags the completed
-- ones for the UI to dim. Only Confirmed meetings are tracked (Cancelled / TBR /
-- Pending are not part of the plan).
--
-- The four stage VALUES are returned raw (profile_label, calendar_label,
-- host_name, feedback_status_label); the UI decides the checkmark per stage:
--   * Profiles  : check if profile_label IN ('Sent','Not Needed')
--   * Calendars : check if calendar_label CONTAINS the word 'Sent'
--                 ('Calendar Sent' / 'Management Sent' / 'Investor Sent').
--                 NB 'Send to Management' contains 'Send' but NOT 'Sent', so it
--                 must NOT check -- the UI uses a case-sensitive 'Sent' match.
--   * Hosts     : check if host_name is present
--   * Feedback  : check if feedback_status_label starts with 'Closed'
--                 ('Closed - All in' / 'Closed - No Feedback')
--
-- Dates follow the v_profiles_upcoming convention: the stored timestamptz is
-- read as its UTC wall-clock value (AT TIME ZONE 'UTC', not shifted), so
-- meeting_day shares one clock with CURRENT_DATE (Supabase runs UTC).
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_planning_events CASCADE;
CREATE VIEW public.v_planning_events AS
WITH ev AS (
  SELECT
    m.meeting_id,
    m.event_id,
    m.meeting_date,
    (m.meeting_date AT TIME ZONE 'UTC')::date AS meeting_day,
    m.institution_name,
    m.client_account_id,
    m.client_account_name,
    m.is_in_person,
    m.profile_label,
    m.calendar_label,
    m.host_id,
    m.host_name,
    m.feedback_status_label,
    -- Account managers come from the client account (meetings carry none), the
    -- same meeting -> client -> AM join the Profiles page uses. One client per
    -- event, so an event has a single primary AM; secondary AM is usually NULL.
    a.sales_lead_primary_name AS primary_manager_name,
    a.secondary_manager_name  AS secondary_manager_name,
    NULLIF(TRIM(m._raw ->> '_bcs_event_value@OData.Community.Display.V1.FormattedValue'), '')
      AS event_name
  FROM public.meetings m
  LEFT JOIN public.accounts a ON a.account_id = m.client_account_id
  WHERE m.event_id IS NOT NULL
    AND m.meeting_date IS NOT NULL
    AND m.meeting_status_label = 'Confirmed'
),
upcoming_events AS (
  -- Event list scope: >= 1 Confirmed meeting today-or-later.
  SELECT DISTINCT event_id
  FROM ev
  WHERE meeting_day >= CURRENT_DATE
),
event_label AS (
  -- One representative display name per event_id: the name on the latest-dated
  -- meeting (the most current label), with a deterministic meeting_id tiebreak.
  SELECT DISTINCT ON (event_id)
    event_id,
    event_name
  FROM ev
  WHERE event_name IS NOT NULL
  ORDER BY event_id, meeting_date DESC, meeting_id
)
SELECT
  ev.event_id,
  COALESCE(el.event_name, '(Unnamed event)') AS event_name,
  ev.meeting_id,
  ev.meeting_date,
  ev.meeting_day,
  ev.institution_name,
  ev.client_account_id,
  ev.client_account_name,
  ev.is_in_person,
  ev.profile_label,
  ev.calendar_label,
  ev.host_id,
  ev.host_name,
  ev.feedback_status_label,
  ev.primary_manager_name,
  ev.secondary_manager_name,
  (ev.meeting_day < CURRENT_DATE) AS is_past
FROM ev
JOIN upcoming_events ue ON ue.event_id = ev.event_id
LEFT JOIN event_label el ON el.event_id = ev.event_id
ORDER BY ev.event_id, ev.meeting_date, ev.meeting_id;


-- -----------------------------------------------------------------------------
-- v_feedback_manager
-- One row per EVENT that has at least one "Feedback" task (tasks linked to the
-- event by bcs_event_id, bcs_task_subtype_label = 'Feedback'). Powers the
-- Feedback Manager concept page. Returns ONLY events in an ACTIVE pipeline
-- state — "Done" events (the event's "Feedback Report Sent" task Completed) are
-- EXCLUDED entirely.
--
-- Meeting Start / Meeting End are DERIVED here as min/max meeting_date across
-- the event's Confirmed meetings (meetings.event_id = task.bcs_event_id),
-- because the real bcs_event Meeting Start/End fields are not yet mirrored.
-- Swap to the real fields when they are synced.
--
-- DATE CUTOFF: the Feedback Report Sent process is recent, so older events lack
-- that task. The view only includes events whose DERIVED Meeting End (UTC date)
-- is on/after 2026-05-01. Events with no Confirmed meetings (null end) are also
-- excluded, since their recency can't be established.
--
-- NOTE: meeting tally / % Closed / date range count only CONFIRMED meetings
-- (meeting_status_label = 'Confirmed'), matching v_feedback_outstanding and the
-- rest of the app's feedback logic. To count every linked meeting regardless of
-- status, drop the "AND m.meeting_status_label = 'Confirmed'" line in mtg.
--
-- Two tasks track each event's feedback:
--   * "Feedback"             — drives most of the lifecycle (received / claimed /
--                              open-vs-closed). One representative task is chosen
--                              per event: prefer non-Canceled, then latest by
--                              created_on (16 events have >1 Feedback task).
--   * "Feedback Report Sent" — the deliverable; its Completed state marks the
--                              event Done (and therefore EXCLUDED here). For a
--                              Completed-Feedback event to reach Pending Review,
--                              this task must EXIST and be Open (see below).
--
-- state (mutually exclusive & exhaustive for active events, evaluated top-down;
-- Done is filtered out in WHERE):
--   Done (excluded)         report task Completed
--   Reports Pending Review  Feedback task Completed AND an EXISTING report task
--                           that is Open. A Completed-Feedback event with NO
--                           report task (or a non-Open one) is a pre-process
--                           legacy artifact and is EXCLUDED in WHERE, not shown.
--   Waiting on Feedback     Feedback task Open AND NOT feedback_received
--                           (regardless of claim)
--   Reports Not Started     Feedback task Open AND feedback_received AND NOT claimed
--   Reports In Progress     Feedback task Open AND feedback_received AND claimed
--   (Not Started vs In Progress is purely the claim; both have feedback_received.)
--   (a Canceled Feedback task with no Completed report has no state → excluded)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_feedback_manager AS
WITH fb_task AS (
  SELECT DISTINCT ON (t.bcs_event_id)
    t.bcs_event_id,
    t.bcs_event_name,
    t.bcs_account_id,
    t.bcs_account_name,
    t.state_label                            AS feedback_task_state_label,
    COALESCE(t.bcs_feedback_received, false)  AS feedback_received,
    t.crdfa_feedback_received_date            AS feedback_received_date,
    (t.bcs_claimed_by_id IS NOT NULL)         AS claimed,
    t.bcs_claimed_by_name                     AS claimed_by_name
  FROM public.tasks t
  WHERE t.bcs_task_subtype_label = 'Feedback'
    AND t.bcs_event_id IS NOT NULL
  ORDER BY
    t.bcs_event_id,
    (t.state_label <> 'Canceled') DESC,
    t.created_on DESC,
    t.task_id
),
report_task AS (
  SELECT
    t.bcs_event_id,
    bool_or(t.state_label = 'Completed')      AS report_completed,
    CASE
      WHEN bool_or(t.state_label = 'Completed') THEN 'Completed'
      WHEN bool_or(t.state_label = 'Open')      THEN 'Open'
      ELSE max(t.state_label)
    END                                       AS report_task_state_label
  FROM public.tasks t
  WHERE t.bcs_task_subtype_label = 'Feedback Report Sent'
    AND t.bcs_event_id IS NOT NULL
  GROUP BY t.bcs_event_id
),
mtg AS (
  SELECT
    m.event_id,
    min(m.meeting_date)                       AS meeting_start,
    max(m.meeting_date)                       AS meeting_end,
    count(*)::int                             AS meeting_count,
    count(*) FILTER (WHERE m.feedback_status_label = 'Closed - All in')::int      AS fb_closed_all_in,
    count(*) FILTER (WHERE m.feedback_status_label = 'Closed - No Feedback')::int AS fb_closed_no_feedback,
    count(*) FILTER (WHERE m.feedback_status_label = 'Awaiting Additional')::int  AS fb_awaiting_additional,
    count(*) FILTER (WHERE m.feedback_status_label IS NULL)::int                  AS fb_no_status,
    ROUND(
      count(*) FILTER (
        WHERE m.feedback_status_label IN ('Closed - All in', 'Closed - No Feedback')
      )::numeric
      / NULLIF(count(*), 0),
      4
    )                                         AS pct_closed
  FROM public.meetings m
  WHERE m.event_id IS NOT NULL
    AND m.meeting_status_label = 'Confirmed'
  GROUP BY m.event_id
)
SELECT
  f.bcs_event_id                              AS event_id,
  COALESCE(f.bcs_event_name, '(Unnamed event)') AS event_name,
  f.bcs_account_id                            AS client_account_id,
  f.bcs_account_name                          AS client_account_name,
  mt.meeting_start,
  mt.meeting_end,
  COALESCE(mt.meeting_count, 0)               AS meeting_count,
  COALESCE(mt.fb_closed_all_in, 0)            AS fb_closed_all_in,
  COALESCE(mt.fb_closed_no_feedback, 0)       AS fb_closed_no_feedback,
  COALESCE(mt.fb_awaiting_additional, 0)      AS fb_awaiting_additional,
  COALESCE(mt.fb_no_status, 0)                AS fb_no_status,
  mt.pct_closed,
  f.feedback_received,
  f.feedback_received_date,
  f.feedback_task_state_label,
  f.claimed,
  f.claimed_by_name,
  r.report_task_state_label                   AS report_sent_state_label,
  CASE
    WHEN f.feedback_task_state_label = 'Completed'
         AND r.report_task_state_label = 'Open'
      THEN 'Reports Pending Review'
    WHEN f.feedback_task_state_label = 'Open' AND NOT f.feedback_received
      THEN 'Waiting on Feedback'
    WHEN f.feedback_task_state_label = 'Open' AND f.feedback_received AND NOT f.claimed
      THEN 'Reports Not Started'
    WHEN f.feedback_task_state_label = 'Open' AND f.feedback_received AND f.claimed
      THEN 'Reports In Progress'
  END                                         AS state
FROM fb_task f
LEFT JOIN report_task r ON r.bcs_event_id = f.bcs_event_id
LEFT JOIN mtg mt        ON mt.event_id    = f.bcs_event_id
WHERE COALESCE(r.report_completed, false) = false          -- drop Done (report sent)
  AND f.feedback_task_state_label IN ('Open', 'Completed')  -- drop Canceled Feedback w/o report
  -- Forward-looking tightening: an event whose Feedback (collection) task is
  -- Completed only counts as "Pending Account Manager Review" when an actual
  -- 'Feedback Report Sent' task EXISTS and is Open. Legacy Completed-feedback
  -- events with no (or a non-Open) Report Sent task are pre-process artifacts and
  -- are dropped here. (Feedback-Open events are untouched — they legitimately have
  -- no Report Sent task yet.)
  AND NOT (
    f.feedback_task_state_label = 'Completed'
    AND COALESCE(r.report_task_state_label, '') <> 'Open'
  )
  -- Recency cutoff: derived Meeting End (UTC date) on/after 2026-05-01. Null
  -- end (no Confirmed meetings) compares as NULL → excluded.
  AND (mt.meeting_end AT TIME ZONE 'UTC')::date >= DATE '2026-05-01';


-- -----------------------------------------------------------------------------
-- v_feedback_pipeline
-- The Feedback Report Pipeline page's TWO-CATEGORY model (replaces the older
-- multi-state v_feedback_manager). Both categories are driven by the event's
-- "Feedback"-subtype task (the spine of the lifecycle); one row per Feedback task:
--
--   'in_progress'    — feedback is in, report being worked on:
--                        Feedback task Open AND bcs_feedback_received (Received
--                        date marked). Split in the UI by whether it is claimed.
--   'pending_review' — feedback closed, handed to the AM, report not yet sent:
--                        Feedback task Completed AND its SAME-EVENT "Feedback
--                        Report Sent" task is still Open. A deliberately NARROW
--                        window (≈2 rows) between feedback-closed and report-sent.
--   Done (excluded)  — the "Feedback Report Sent" task is Completed.
--
-- LINKAGE (validated against live data, 2026-07-15):
--   A Feedback task and its Feedback Report Sent task are tied to the SAME event by
--   event_key = COALESCE(regarding_id, bcs_event_id) — the event GUID, stored in
--   regarding_id on some tasks and bcs_event_id on others. Matched task-to-task,
--   this pairs 146/149 open Report Sent tasks to their own same-event Feedback.
--   (An earlier build matched by a ticker "event code" parsed from the event name;
--   that was WRONG — the ticker is client-grained, so it paired a report with a
--   closed Feedback from a DIFFERENT event of the same client. Dropped.)
--
--   On the state pairing: when a report is Open/pending, its same-event Feedback is
--   usually still Open too (144/149) and Completed in only 2 — so Pending Review is
--   small BY DESIGN. Do NOT widen it by matching across events.
--
-- GRAIN: one row per Feedback task. Pending Review joins each Completed Feedback to
--   at most ONE open Report Sent per event_key (DISTINCT ON), so the join never
--   fans out. due_date on a Pending Review row is the matched Report Sent task's
--   scheduled_end (when the report is due); on an In Progress row it is the
--   Feedback task's own scheduled_end.
--
-- Meeting Start / End / count are DERIVED from the event's Confirmed meetings,
-- joined on event_key (= meetings.event_id). Rows whose event has no Confirmed
-- meetings show NULL meeting fields.
--
-- days_in_stage: In Progress = days since crdfa_feedback_received_date; Pending
--   Review = days since the Feedback task closed (actual_end). Task date fields are
--   stored at UTC midnight, so their calendar day is read AT TIME ZONE 'UTC'.
--
-- No recency floor (product decision): returns all qualifying tasks.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_feedback_pipeline CASCADE;
CREATE VIEW public.v_feedback_pipeline AS
WITH tk AS (
  -- Feedback + Feedback Report Sent tasks, each stamped with its event key
  -- (the event GUID, wherever it is stored on the task).
  SELECT
    t.*,
    COALESCE(t.regarding_id, t.bcs_event_id) AS event_key
  FROM public.tasks t
  WHERE t.bcs_task_subtype_label IN ('Feedback', 'Feedback Report Sent')
),
report_sent_open AS (
  -- Open Report Sent tasks, one per event_key (soonest-due), for the Pending
  -- Review linkage + the report's due date.
  SELECT DISTINCT ON (event_key)
    event_key,
    task_id                 AS report_task_id,
    scheduled_end            AS report_due
  FROM tk
  WHERE bcs_task_subtype_label = 'Feedback Report Sent'
    AND state_label = 'Open'
    AND event_key IS NOT NULL
  ORDER BY event_key, scheduled_end NULLS LAST, task_id
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
  FROM tk f
  WHERE f.bcs_task_subtype_label = 'Feedback'
    AND f.state_label = 'Open'
    AND COALESCE(f.bcs_feedback_received, false) = true
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
    rso.report_due                              AS due_date,
    f.actual_end                                AS fb_closed_date,
    (f.bcs_claimed_by_id IS NOT NULL)           AS claimed,
    f.bcs_claimed_by_id                         AS claimed_by_id,
    f.bcs_claimed_by_name                       AS claimed_by_name,
    (CURRENT_DATE - (f.actual_end AT TIME ZONE 'UTC')::date) AS days_in_stage
  FROM tk f
  JOIN report_sent_open rso ON rso.event_key = f.event_key
  WHERE f.bcs_task_subtype_label = 'Feedback'
    AND f.state_label = 'Completed'
    AND f.event_key IS NOT NULL
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
  c.days_in_stage,
  -- Client stock ticker (accounts.ticker_symbol), appended last so the column
  -- list only grows a trailing column — same pattern as v_feedback_outstanding.
  -- The accounts join already exists below (it also feeds account_manager_name).
  a.ticker_symbol AS client_ticker
FROM combined c
LEFT JOIN public.accounts a ON a.account_id = c.client_account_id
LEFT JOIN mtg mt            ON mt.event_id    = c.event_id
ORDER BY c.category, c.days_in_stage DESC NULLS LAST, c.client_account_name;


-- -----------------------------------------------------------------------------
-- v_time_off
-- One row per approved time-off entry for the Logistics → Time Off calendar.
-- Source: public.new_vacationrequest (the Dynamics new_vacationrequest mirror).
--
-- type bucket (exactly two values):
--   'Remote' when the Dynamics Request Type is 'Remote Work'
--   'OOO'    for everything else (Vacation, Personal, Sick Leave, Jury Duty,
--            Other, or a missing type) — i.e. anything that is NOT remote.
--
-- Dates are reduced to a calendar day in UTC. The mirror stores some rows at
-- UTC midnight (…T00:00:00Z) and others at Eastern midnight (…T04:00:00Z);
-- taking the UTC wall-clock date yields the intended day for both encodings.
-- All entries are full-day (durations are whole-day; there are no half-days).
--
-- Approval: the dedicated Request Status choice (new_requeststatus) is empty for
-- every mirrored row, so there is currently NO approval filter here — every
-- entry is treated as approved (product decision, 2026-06-30). When the real
-- approval status is wired into the sync, add a WHERE clause on it below.
--
-- is_host: true when this person hosts meetings — derived as "the person's
-- Dynamics user id (requested_by_id) appears as host_id on at least one meeting".
-- There is no host flag on public.users, so this id match is the host signal.
-- Drives the Time Off page's "Hosts only" filter.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_time_off CASCADE;
CREATE VIEW public.v_time_off AS
SELECT
  v.ooo_id,
  -- Dynamics systemuser GUID of the person the time off belongs to (ownerid /
  -- "Requested By"). Same id space as meetings.host_id — exposed so the Host
  -- Calendar can join time off to hosts by id (never by name). The Time Off
  -- page ignores this column.
  v.requested_by_id                         AS person_id,
  v.requested_by_name                       AS person,
  (v.start_date AT TIME ZONE 'UTC')::date    AS start_date,
  (v.end_date   AT TIME ZONE 'UTC')::date    AS end_date,
  CASE
    WHEN v.request_type_label = 'Remote Work' THEN 'Remote'
    ELSE 'OOO'
  END                                        AS time_off_type,
  v.request_type_label                       AS request_type_label,
  EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.host_id = v.requested_by_id
  )                                          AS is_host
FROM public.new_vacationrequest v
WHERE v.requested_by_name IS NOT NULL
  AND v.start_date IS NOT NULL
  AND v.end_date IS NOT NULL
ORDER BY v.start_date, v.requested_by_name;


-- -----------------------------------------------------------------------------
-- v_scheduler_time_off
-- Approved time off for the people who host meetings, keyed by host_id, for the
-- Host Calendar (Scheduler) page's OOO/Remote indicators.
--
-- Built ON TOP OF v_time_off so the OOO vs Remote bucketing and approved-only
-- scope live in exactly one place (no drift between the Time Off page and the
-- Host Calendar). The join to hosts is BY ID: v_time_off.person_id (the
-- Dynamics systemuser GUID = new_vacationrequest.requested_by_id) matched to
-- meetings.host_id via EXISTS — never by name. start_date / end_date are the
-- same inclusive calendar-day range v_time_off exposes; all entries are
-- full-day (there are no half-days in the source).
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_scheduler_time_off CASCADE;
CREATE VIEW public.v_scheduler_time_off AS
SELECT DISTINCT
  t.person_id AS host_id,
  t.person,
  t.start_date,
  t.end_date,
  t.time_off_type
FROM public.v_time_off t
WHERE t.person_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.host_id = t.person_id
  );


-- -----------------------------------------------------------------------------
-- v_live_outreach
-- One row per event in the "Live Outreach" workflow state, for the Logistics →
-- Live Outreach page. Powers a two-panel card per client: client/event facts on
-- the left, the event's Confirmed meetings on the right.
--
-- Primary filter: events.event_state_label = 'Live Outreach' (the bcs_eventstate
-- option set; sibling states are Complete / Pre-Launch / Preparing Feedback /
-- Schedule Closed / Meetings Ongoing / Pause). Event-level, NOT a meeting field.
--
-- Field notes:
--   - div_yield is NOT a first-class column; it lives in accounts._raw as the
--     Dynamics bcs_divyield numeric (already a percent, e.g. 4.34 = 4.34%).
--   - market_cap_b is accounts.market_cap_b, already expressed in $B.
--   - industry uses accounts.industry_option_label (the specific industry, e.g.
--     'Metals & Mining'), not the broader sector_label.
--   - urgency (events.urgency_label / bcs_urgency) is binary in the data:
--     'High' or 'Standard' (or NULL when unset). There is no Medium/Low.
--   - event_mode is DERIVED from the event_location free text, because the
--     bcs_eventtype option set is empty for every event. 'Live - New York' →
--     Live, 'Virtual' → Virtual, 'Virtual, Live - New York' → Hybrid.
--   - slots_remaining / of_slots are the real Dynamics counters (bcs_slotsremaining
--     / bcs_ofslots). slots_remaining can be 0 or NEGATIVE (overbooked); the UI
--     clamps the display. meeting_slots_max / spaces_available are always NULL.
--   - confirmed_meetings is a JSON array (date / institution / contact) built from
--     public.meetings on event_id where meeting_status_label = 'Confirmed'. The
--     contact is meetings.investor_text (the individual investor; may list several
--     names). confirmed_meeting_count is taken from the SAME subquery as the list,
--     so the count badge can never drift from the rendered rows.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_live_outreach CASCADE;
CREATE VIEW public.v_live_outreach AS
SELECT
  e.event_id,
  e.name                                          AS event_name,
  e.client_account_id,
  COALESCE(e.client_account_name, a.name)         AS client_account_name,
  COALESCE(a.ticker_symbol, e.client_ticker)      AS ticker,
  a.industry_option_label                         AS industry,
  NULLIF(a._raw ->> 'bcs_divyield', '')::numeric  AS div_yield,
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
  COALESCE(cm.cnt, 0)                             AS confirmed_meeting_count,
  COALESCE(cm.meetings, '[]'::jsonb)              AS confirmed_meetings
FROM public.events e
LEFT JOIN public.accounts a ON a.account_id = e.client_account_id
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
ORDER BY a.ticker_symbol NULLS LAST, e.name;


-- -----------------------------------------------------------------------------
-- v_client_marketing_status
-- One row per ACTIVE client (accounts.state_label = 'Active' — the SAME set as
-- v_client_portfolio, currently 107 rows). Powers the Logistics → Marketing
-- Status page: a per-client tracker of the event timeline and the
-- feedback-report lifecycle, sortable in the UI.
--
-- sales_lead_primary_name is the client's Account Manager (accounts field, same
-- as v_client_portfolio) — surfaced so the page can offer an AM filter.
--
-- Two families of columns.
--
-- EVENT TIMELINE — from public.events, using the REAL Dynamics date fields
-- event_start_actual / event_end_actual (these replaced the old
-- derive-from-meetings workaround). Only Active events that carry both real
-- dates are considered (e.state_label = 'Active'), so cancelled/deactivated
-- events can never surface as a client's "next event". "Today" is the Eastern
-- calendar day, and event days are the Eastern calendar day of each timestamp
-- (events are stored at ET midnight), matching the firm's working day.
--   current_event_name  : name of the event whose [start, end] range contains
--                         today (inclusive); the earliest-starting one if several.
--   current_event_id    : that same event's id (for deep-linking to Planning's
--                         By Event view). NULL when there is no current event.
--   next_event_date     : soonest event start date strictly in the future.
--   last_event_date     : end date of the most recently ended past event.
--
-- FEEDBACK-REPORT LIFECYCLE — mirrors v_feedback_manager's task model exactly.
-- The feedback tasks are public.tasks rows whose bcs_task_subtype_label is
-- 'Feedback' (the collection task) or 'Feedback Report Sent' (the report task) —
-- they are NOT identified by subject text. Tasks link to a client via
-- bcs_account_id and to an event via bcs_event_id; state_label is the Dataverse
-- statecode ('Open' / 'Completed' / 'Canceled'). Task date fields (scheduled_end
-- due date, actual_end completion) are stored at UTC midnight, so their calendar
-- day is read AT TIME ZONE 'UTC' (matching the Feedback Report Pipeline page).
--   feedback_collection      : count of the client's not-closed feedbacks at the
--                              MEETING level — Confirmed, hosted, already-occurred
--                              meetings whose feedback_status_label is NULL or
--                              'Awaiting Additional' (i.e. NOT 'Closed - All in' /
--                              'Closed - No Feedback'). Same scope as
--                              v_feedback_outstanding.
--   reports_in_creation      : count of the client's OPEN 'Feedback' tasks that
--                              have bcs_feedback_received = true.
--   reports_in_creation_due  : soonest scheduled_end (due date) among those tasks.
--   reports_in_review        : count of the client's COMPLETED 'Feedback' tasks
--                              whose event still has an OPEN (and not Completed)
--                              'Feedback Report Sent' task — i.e. the report is
--                              awaiting account-manager review. Requires the
--                              feedback task to carry bcs_event_id (the join key).
--   report_sent_date         : most recent actual_end among the client's
--                              COMPLETED 'Feedback Report Sent' tasks. NULL until
--                              a report has actually been sent (sparse today).
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_client_marketing_status CASCADE;
CREATE VIEW public.v_client_marketing_status AS
WITH today AS (
  SELECT (now() AT TIME ZONE 'America/New_York')::date AS d
),
ev AS (
  SELECT
    e.client_account_id,
    e.event_id,
    (e.event_start_actual AT TIME ZONE 'America/New_York')::date AS start_d,
    (e.event_end_actual   AT TIME ZONE 'America/New_York')::date AS end_d,
    e.name
  FROM public.events e
  WHERE e.state_label = 'Active'
    AND e.event_start_actual IS NOT NULL
    AND e.event_end_actual   IS NOT NULL
    AND e.client_account_id  IS NOT NULL
),
event_timeline AS (
  SELECT
    ev.client_account_id,
    -- Earliest-starting event currently in range → its name AND event_id. ARRAY_AGG
    -- with the FILTER keeps only in-range events, ordered by start; [1] is the
    -- earliest. Same ORDER BY for both, so the name and id are from the same event.
    -- current_event_id lets the UI deep-link the Current Event into Planning's
    -- By Event view.
    (ARRAY_AGG(ev.name ORDER BY ev.start_d, ev.end_d)
       FILTER (WHERE ev.start_d <= t.d AND ev.end_d >= t.d))[1] AS current_event_name,
    (ARRAY_AGG(ev.event_id ORDER BY ev.start_d, ev.end_d)
       FILTER (WHERE ev.start_d <= t.d AND ev.end_d >= t.d))[1] AS current_event_id,
    MIN(ev.start_d) FILTER (WHERE ev.start_d > t.d)             AS next_event_date,
    MAX(ev.end_d)   FILTER (WHERE ev.end_d   < t.d)             AS last_event_date
  FROM ev CROSS JOIN today t
  GROUP BY ev.client_account_id
),
-- Column 1: meeting-level outstanding feedback (v_feedback_outstanding scope).
fb_collection AS (
  SELECT
    m.client_account_id,
    count(*)::int AS feedback_collection
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.host_id IS NOT NULL
    AND m.meeting_date IS NOT NULL
    AND (m.meeting_date AT TIME ZONE 'America/New_York')::date
        < (now() AT TIME ZONE 'America/New_York')::date
    AND (m.feedback_status_label IS NULL
         OR m.feedback_status_label = 'Awaiting Additional')
  GROUP BY m.client_account_id
),
-- Per-event 'Feedback Report Sent' task state (many tasks may share an event).
report_task AS (
  SELECT
    t.bcs_event_id,
    bool_or(t.state_label = 'Completed') AS report_completed,
    bool_or(t.state_label = 'Open')      AS report_open
  FROM public.tasks t
  WHERE t.bcs_task_subtype_label = 'Feedback Report Sent'
    AND t.bcs_event_id IS NOT NULL
  GROUP BY t.bcs_event_id
),
-- Columns 2 & 3, from the client's 'Feedback' (collection) tasks.
fb_tasks AS (
  SELECT
    t.bcs_account_id AS client_account_id,
    count(*) FILTER (
      WHERE t.state_label = 'Open' AND COALESCE(t.bcs_feedback_received, false)
    )::int AS reports_in_creation,
    (MIN(t.scheduled_end) FILTER (
      WHERE t.state_label = 'Open' AND COALESCE(t.bcs_feedback_received, false)
    ) AT TIME ZONE 'UTC')::date AS reports_in_creation_due,
    count(*) FILTER (
      WHERE t.state_label = 'Completed'
        AND rt.report_open AND NOT rt.report_completed
    )::int AS reports_in_review
  FROM public.tasks t
  LEFT JOIN report_task rt ON rt.bcs_event_id = t.bcs_event_id
  WHERE t.bcs_task_subtype_label = 'Feedback'
    AND t.bcs_account_id IS NOT NULL
  GROUP BY t.bcs_account_id
),
-- Column 4: last completed 'Feedback Report Sent' close date, per client.
report_sent AS (
  SELECT
    t.bcs_account_id AS client_account_id,
    (max(t.actual_end) AT TIME ZONE 'UTC')::date AS report_sent_date
  FROM public.tasks t
  WHERE t.bcs_task_subtype_label = 'Feedback Report Sent'
    AND t.bcs_account_id IS NOT NULL
    AND t.state_label = 'Completed'
  GROUP BY t.bcs_account_id
)
SELECT
  a.account_id,
  a.name,
  a.ticker_symbol,
  a.sales_lead_primary_name,
  et.current_event_name,
  et.current_event_id,
  et.next_event_date,
  et.last_event_date,
  COALESCE(fc.feedback_collection, 0) AS feedback_collection,
  COALESCE(ft.reports_in_creation, 0) AS reports_in_creation,
  ft.reports_in_creation_due,
  COALESCE(ft.reports_in_review, 0)   AS reports_in_review,
  rs.report_sent_date
FROM public.accounts a
LEFT JOIN event_timeline et ON et.client_account_id = a.account_id
LEFT JOIN fb_collection  fc ON fc.client_account_id = a.account_id
LEFT JOIN fb_tasks       ft ON ft.client_account_id = a.account_id
LEFT JOIN report_sent    rs ON rs.client_account_id = a.account_id
WHERE a.state_label = 'Active'
ORDER BY a.name;

GRANT SELECT ON public.v_time_off TO service_role;
GRANT SELECT ON public.v_scheduler_time_off TO service_role;

-- -----------------------------------------------------------------------------
-- v_client_onboarding
-- One row per ACTIVE client (accounts.state_label = 'Active') that still has at
-- least one INCOMPLETE onboarding step. Fully-onboarded clients (all 9 steps
-- complete) drop off the view entirely. Powers the Logistics -> Onboarding page.
--
-- Scoped to clients whose onboarding started on/after 2026-01-01 (see the WHERE
-- cutoff at the bottom) so the page stays focused on genuinely-new clients;
-- currently 26 rows. Widen/narrow by editing that one date.
--
-- The 9 onboarding steps live on the account/client card in Dynamics and are
-- already synced onto public.accounts (see lib/sync/mappers.ts). Two kinds:
--   * DATE steps  -> complete when a date is present:
--       f_onboarding_call            (bcs_onboardingcall  / onboarding_call)
--       f_teach_in_date              (bcs_teachindate     / teach_in_date)
--   * YES/NO steps -> complete only when the flag is Yes (true). A No or an
--     unset flag both count as "missing" (muted dash in the grid):
--       f_calendar                   (bcs_calendar)
--       f_calendar_confirmed         (bcs_calendarconfirmed)
--       f_meeting_history_received   (bcs_meetinghistoryrecd)
--       f_distro                     (bcs_distro)
--       f_bda_peers                  (bcs_bdapeers)
--       f_recurring_call_scheduled   (bcs_recurringcallscheduled)
--       f_report                     (bcs_report)
--
-- filled_count is how many of the 9 are complete (the UI's "N/9" ring), and the
-- view keeps only rows where filled_count < 9. onboarding_field_count (=9) is
-- exposed so the UI never hard-codes the denominator.
--
-- Account team: the same four role columns the Portfolio page feeds into the
-- shared AccountTeamAvatars component. sales_lead_primary_name is the primary
-- Account Manager and drives the page's AM filter.
--
-- days_onboarding anchors on original_start_date (bcs_originalstartdate) — the
-- Dynamics "Original Start Date", populated on 100% of active clients — read as
-- the Eastern calendar day, same "today" convention as v_client_marketing_status.
-- It CAN be large for long-tenured clients (start dates reach back years) and
-- can be negative for a future-dated start; the UI flags 60+ days as stalled.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_client_onboarding CASCADE;
CREATE VIEW public.v_client_onboarding AS
WITH onb AS (
  SELECT
    a.account_id,
    a.name,
    a.ticker_symbol,
    a.sales_lead_primary_name,
    a.secondary_manager_name,
    a.associate_name,
    a.logistics_coordinator_name,
    (a.original_start_date AT TIME ZONE 'America/New_York')::date AS onboarding_start_date,
    (a.onboarding_call          IS NOT NULL) AS f_onboarding_call,
    (a.teach_in_date            IS NOT NULL) AS f_teach_in_date,
    (a.calendar                 IS TRUE)     AS f_calendar,
    (a.calendar_confirmed       IS TRUE)     AS f_calendar_confirmed,
    (a.meeting_history_received IS TRUE)     AS f_meeting_history_received,
    (a.distro                   IS TRUE)     AS f_distro,
    (a.bda_peers                IS TRUE)     AS f_bda_peers,
    (a.recurring_call_scheduled IS TRUE)     AS f_recurring_call_scheduled,
    (a.report                   IS TRUE)     AS f_report
  FROM public.accounts a
  WHERE a.state_label = 'Active'
)
SELECT
  onb.account_id,
  onb.name,
  onb.ticker_symbol,
  onb.sales_lead_primary_name,
  onb.secondary_manager_name,
  onb.associate_name,
  onb.logistics_coordinator_name,
  onb.onboarding_start_date,
  ((now() AT TIME ZONE 'America/New_York')::date - onb.onboarding_start_date) AS days_onboarding,
  onb.f_onboarding_call,
  onb.f_teach_in_date,
  onb.f_calendar,
  onb.f_calendar_confirmed,
  onb.f_meeting_history_received,
  onb.f_distro,
  onb.f_bda_peers,
  onb.f_recurring_call_scheduled,
  onb.f_report,
  ( onb.f_onboarding_call::int
  + onb.f_teach_in_date::int
  + onb.f_calendar::int
  + onb.f_calendar_confirmed::int
  + onb.f_meeting_history_received::int
  + onb.f_distro::int
  + onb.f_bda_peers::int
  + onb.f_recurring_call_scheduled::int
  + onb.f_report::int ) AS filled_count,
  9 AS onboarding_field_count
FROM onb
WHERE ( onb.f_onboarding_call::int
      + onb.f_teach_in_date::int
      + onb.f_calendar::int
      + onb.f_calendar_confirmed::int
      + onb.f_meeting_history_received::int
      + onb.f_distro::int
      + onb.f_bda_peers::int
      + onb.f_recurring_call_scheduled::int
      + onb.f_report::int ) < 9
  -- Scope cutoff: only clients whose onboarding started on/after this date, so
  -- the page focuses on genuinely-new clients and days_onboarding / the 60-day
  -- "stalled" flag stay meaningful (original_start_date otherwise reaches back
  -- years). Adjust or remove this single line to widen/narrow the page.
  AND onb.onboarding_start_date >= DATE '2026-01-01'
ORDER BY days_onboarding DESC NULLS LAST, onb.name;

GRANT SELECT ON public.v_client_onboarding TO service_role;


-- -----------------------------------------------------------------------------
-- v_marketing_calendar
-- One row per event (of any active workflow state except Pause), for the
-- Logistics -> Calendar page: a Gantt-style marketing calendar with one lane per
-- client and each event drawn as a bar colored by event_state_label.
--
-- Scope:
--   - event_state_label IS NOT NULL and <> 'Pause' — i.e. all of Pre-Launch /
--     Live Outreach / Meetings Ongoing / Schedule Closed / Preparing Feedback /
--     Complete (the six states the page colors), and nothing paused.
--   - state_label = 'Active' excludes DEACTIVATED events (the Dataverse statecode,
--     distinct from the workflow event_state_label). Kept on purpose so the
--     calendar shows only live events; drop this line to include deactivated ones.
--   - A trailing window: only events whose latest actual date (end, else start) is
--     within the last 2 months or in the future, so the lanes stay forward-looking
--     without a hard "future only" cut (recently-finished events still show).
--
-- Field notes:
--   - client_account_name / ticker COALESCE the event's own copy with the joined
--     accounts row (same pattern as v_live_outreach).
--   - event_dates is the free-text Dynamics "dates" string (no year, e.g. "8/4,
--     8/5" or "9/1-9/3"); the page parses it for precise day marks/ranges and
--     falls back to event_start_actual..event_end_actual when it yields nothing.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_marketing_calendar CASCADE;
CREATE VIEW public.v_marketing_calendar AS
SELECT
  e.event_id,
  e.name                                     AS event_name,
  e.client_account_id,
  COALESCE(e.client_account_name, a.name)    AS client_account_name,
  COALESCE(a.ticker_symbol, e.client_ticker) AS ticker,
  e.event_state_label,
  e.event_start_actual,
  e.event_end_actual,
  e.dates                                    AS event_dates,   -- free text, no year (e.g. "8/4, 8/5", "9/1-9/3")
  e.event_location
FROM public.events e
LEFT JOIN public.accounts a ON a.account_id = e.client_account_id
WHERE e.state_label = 'Active'
  AND e.event_state_label IS NOT NULL
  AND e.event_state_label <> 'Pause'
  AND COALESCE(e.event_end_actual, e.event_start_actual) >= (CURRENT_DATE - INTERVAL '2 months')
ORDER BY ticker NULLS LAST, e.event_start_actual;

GRANT SELECT ON public.v_marketing_calendar TO service_role;

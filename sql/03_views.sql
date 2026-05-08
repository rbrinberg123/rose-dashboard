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
DROP VIEW IF EXISTS public.v_contract_management CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_summary CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_quarterly CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_top_institutions CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_reach_depth CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_top_hosts CASCADE;
DROP VIEW IF EXISTS public.v_client_detail_recent_meetings CASCADE;
DROP VIEW IF EXISTS public.v_institution_summary CASCADE;
DROP VIEW IF EXISTS public.v_institution_detail_summary CASCADE;
DROP VIEW IF EXISTS public.v_institution_detail_quarterly CASCADE;
DROP VIEW IF EXISTS public.v_institution_detail_top_clients CASCADE;
DROP VIEW IF EXISTS public.v_institution_detail_style CASCADE;
DROP VIEW IF EXISTS public.v_institution_detail_top_hosts CASCADE;
DROP VIEW IF EXISTS public.v_institution_detail_recent_meetings CASCADE;


-- -----------------------------------------------------------------------------
-- v_meeting_costs
-- Per-meeting labor cost using the salary schedule and cost assumptions
-- in effect on the meeting date.
--
-- Cost formula:
--   loaded_annual = (salary + bonus) * benefits_multiplier
--   hourly        = loaded_annual / work_hours_per_year
--   multiplier    = 2.0 if in-person else 1.0
--   booker_cost   = booker_hourly * booker_hours_per_meeting_base * multiplier
--   host_cost     = host_hourly   * host_hours_per_meeting_base   * multiplier
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

  -- Multiplier for in-person
  CASE WHEN m.is_in_person THEN p.in_person_multiplier ELSE 1.0 END AS multiplier,

  -- Booker cost
  CASE
    WHEN bs.annual_salary IS NULL THEN 0
    ELSE
      ((bs.annual_salary + bs.annual_bonus) * bs.benefits_multiplier
        / p.work_hours_per_year)
      * p.booker_hours_per_meeting_base
      * (CASE WHEN m.is_in_person THEN p.in_person_multiplier ELSE 1.0 END)
  END AS booker_cost,

  -- Host cost
  CASE
    WHEN hs.annual_salary IS NULL THEN 0
    ELSE
      ((hs.annual_salary + hs.annual_bonus) * hs.benefits_multiplier
        / p.work_hours_per_year)
      * p.host_hours_per_meeting_base
      * (CASE WHEN m.is_in_person THEN p.in_person_multiplier ELSE 1.0 END)
  END AS host_cost,

  -- Total meeting cost
  COALESCE(
    CASE
      WHEN bs.annual_salary IS NULL THEN 0
      ELSE
        ((bs.annual_salary + bs.annual_bonus) * bs.benefits_multiplier
          / p.work_hours_per_year)
        * p.booker_hours_per_meeting_base
        * (CASE WHEN m.is_in_person THEN p.in_person_multiplier ELSE 1.0 END)
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
-- One row per client. Powers the portfolio overview dashboard.
-- -----------------------------------------------------------------------------
CREATE VIEW public.v_client_portfolio AS
WITH
recent_contract AS (
  SELECT DISTINCT ON (client_account_id)
    client_account_id,
    contract_status_label,
    quarterly_retainer,
    contract_renewal_date,
    contract_termination_date,
    auto_renew,
    renew
  FROM public.contracts
  WHERE state_code = 0
  ORDER BY client_account_id, contract_start_date DESC
),
meeting_counts AS (
  SELECT
    client_account_id,
    COUNT(*) FILTER (WHERE meeting_date >= CURRENT_DATE - interval '90 days'
                       AND meeting_date <= CURRENT_DATE) AS meetings_last_90d,
    COUNT(*) FILTER (WHERE meeting_date >= CURRENT_DATE
                       AND meeting_date <= CURRENT_DATE + interval '30 days') AS meetings_next_30d,
    MAX(meeting_date) FILTER (WHERE meeting_date <= CURRENT_DATE) AS last_meeting_date
  FROM public.meetings
  WHERE meeting_status_label != 'Cancelled' OR meeting_status_label IS NULL
  GROUP BY client_account_id
),
recent_note AS (
  SELECT DISTINCT ON (client_account_id)
    client_account_id,
    note_date AS last_note_date,
    status_text AS last_note_status,
    primary_risk_driver AS last_note_risk
  FROM public.client_notes
  ORDER BY client_account_id, note_date DESC
),
current_period AS (
  SELECT
    EXTRACT(YEAR FROM CURRENT_DATE)::int AS yr,
    EXTRACT(QUARTER FROM CURRENT_DATE)::int AS qtr
),
current_pnl AS (
  SELECT
    pnl.client_account_id,
    pnl.revenue AS current_quarter_revenue,
    pnl.margin AS current_quarter_margin,
    pnl.margin_pct AS current_quarter_margin_pct
  FROM public.v_client_quarterly_pnl pnl, current_period cp
  WHERE pnl.period_year = cp.yr AND pnl.period_quarter = cp.qtr
)
SELECT
  a.account_id,
  a.name,
  a.ticker_symbol,
  a.sector_label,
  a.exchange_label,
  a.hq_country_name,
  CASE a.status_code
    WHEN 1 THEN 'Current'
    WHEN 2 THEN 'Past'
    ELSE NULL
  END AS client_status_label,
  a.market_cap_b,
  a.state_label AS account_state,

  a.sales_lead_primary_name,
  a.associate_name,
  a.targeting_name,
  a.feedback_report_name,

  rc.contract_status_label,
  rc.quarterly_retainer,
  rc.contract_renewal_date,
  rc.contract_termination_date,
  CASE WHEN rc.contract_renewal_date IS NOT NULL
       THEN (rc.contract_renewal_date - CURRENT_DATE)::int
       ELSE NULL END AS days_to_renewal,
  rc.auto_renew,
  rc.renew,

  COALESCE(mc.meetings_last_90d, 0) AS meetings_last_90d,
  COALESCE(mc.meetings_next_30d, 0) AS meetings_next_30d,
  mc.last_meeting_date,
  a.last_touchpoint_date,
  a.next_event_date,

  rn.last_note_date,
  rn.last_note_status,
  rn.last_note_risk,

  cp.current_quarter_revenue,
  cp.current_quarter_margin,
  cp.current_quarter_margin_pct

FROM public.accounts a
LEFT JOIN recent_contract rc ON rc.client_account_id = a.account_id
LEFT JOIN meeting_counts mc ON mc.client_account_id = a.account_id
LEFT JOIN recent_note rn ON rn.client_account_id = a.account_id
LEFT JOIN current_pnl cp ON cp.client_account_id = a.account_id;


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
-- v_productivity_detail_summary
-- One row per user with any meeting activity in the trailing 12 months OR
-- who is a sales lead on any active account. Powers the per-person
-- Productivity Detail dashboard.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_productivity_detail_summary AS
WITH user_universe AS (
  SELECT DISTINCT booker_id AS user_id
  FROM public.meetings
  WHERE booker_id IS NOT NULL
    AND meeting_date >= CURRENT_DATE - INTERVAL '12 months'
  UNION
  SELECT DISTINCT host_id
  FROM public.meetings
  WHERE host_id IS NOT NULL
    AND meeting_date >= CURRENT_DATE - INTERVAL '12 months'
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
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_status_label != 'Cancelled'
    )::int AS meetings_scheduled_12m,
    COUNT(*) FILTER (
      WHERE m.host_id = uu.user_id
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_status_label != 'Cancelled'
    )::int AS meetings_hosted_12m,
    COUNT(*) FILTER (
      WHERE m.host_id = uu.user_id
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_status_label != 'Cancelled'
        AND m.is_in_person = true
    )::int AS meetings_in_person_12m,
    COUNT(*) FILTER (
      WHERE m.host_id = uu.user_id
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_status_label != 'Cancelled'
        AND m.feedback_status_label = 'Closed - All in'
    )::int AS feedback_collected_12m
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
  CASE
    WHEN COALESCE(ms.meetings_hosted_12m, 0) = 0 THEN NULL
    ELSE ms.feedback_collected_12m::numeric / ms.meetings_hosted_12m
  END AS feedback_collection_rate_12m,
  COALESCE(sls.active_clients_as_sales_lead, 0) AS active_clients_as_sales_lead,
  COALESCE(sls.sales_lead_book_annualized, 0) AS sales_lead_book_annualized
FROM user_universe uu
JOIN public.users u ON u.user_id = uu.user_id
LEFT JOIN meeting_stats ms ON ms.user_id = uu.user_id
LEFT JOIN sales_lead_stats sls ON sls.user_id = uu.user_id
WHERE u.display_name IS NOT NULL
  AND u.display_name != 'CRM Administration';


-- -----------------------------------------------------------------------------
-- v_analyst_monthly_activity
-- One row per (display_name, year, month) for the trailing 12 months.
-- Powers the monthly bar charts on the Productivity Detail page.
-- Aggregates by display_name (not user_id) so duplicate user records collapse.
-- -----------------------------------------------------------------------------
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
)
SELECT
  mu.display_name,
  mu.period_year,
  mu.period_month,
  to_char(make_date(mu.period_year, mu.period_month, 1), 'YYYY-MM') AS period_label,
  COUNT(*) FILTER (
    WHERE m.booker_id = ANY(n.user_ids)
      AND m.meeting_status_label != 'Cancelled'
  )::int AS meetings_scheduled,
  COUNT(*) FILTER (WHERE m.host_id = ANY(n.user_ids))::int AS meetings_hosted,
  COUNT(*) FILTER (
    WHERE m.host_id = ANY(n.user_ids) AND m.is_in_person = true
  )::int AS meetings_in_person,
  COUNT(*) FILTER (
    WHERE m.host_id = ANY(n.user_ids) AND m.is_in_person = false
  )::int AS meetings_virtual,
  COUNT(*) FILTER (
    WHERE m.host_id = ANY(n.user_ids)
      AND m.feedback_status_label = 'Closed - All in'
  )::int AS feedback_collected,
  CASE
    WHEN COUNT(*) FILTER (WHERE m.host_id = ANY(n.user_ids)) = 0 THEN NULL
    ELSE COUNT(*) FILTER (
      WHERE m.host_id = ANY(n.user_ids)
        AND m.feedback_status_label = 'Closed - All in'
    )::numeric
       / COUNT(*) FILTER (WHERE m.host_id = ANY(n.user_ids))
  END AS feedback_collection_rate
FROM month_universe mu
JOIN user_ids_by_name n ON n.display_name = mu.display_name
LEFT JOIN public.meetings m
  ON (m.booker_id = ANY(n.user_ids) OR m.host_id = ANY(n.user_ids))
  AND EXTRACT(YEAR FROM m.meeting_date)::int = mu.period_year
  AND EXTRACT(MONTH FROM m.meeting_date)::int = mu.period_month
  AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
GROUP BY mu.display_name, mu.period_year, mu.period_month;


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
ORDER BY (days_to_expiry IS NULL), days_to_expiry ASC NULLS LAST, client_name ASC;


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
    )::int AS ltm_meetings,
    COUNT(*) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '24 months'
        AND m.meeting_date <  CURRENT_DATE - INTERVAL '12 months'
    )::int AS prior_12mo_meetings,
    COUNT(DISTINCT m.institution_name) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
    )::int AS ltm_unique_institutions,
    COUNT(DISTINCT NULLIF(COALESCE(m.investor_text, ''), '')) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
    )::int AS ltm_unique_investors,
    COUNT(*) FILTER (
      WHERE m.feedback_status_label = 'Closed - All in'
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
    )::int AS ltm_feedback_collected,
    COUNT(*) FILTER (
      WHERE m.feedback_status_label IN ('Closed - All in', 'Closed - No Feedback')
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
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
    )::int AS ltm_count,
    MIN(m.meeting_date)::date AS first_met,
    MAX(m.meeting_date)::date AS last_met
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
-- v_client_detail_top_hosts
-- Top 5 hosts per client in the trailing 12 months, excluding the
-- 'CRM Administration' service-account host.
-- -----------------------------------------------------------------------------
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
-- Last 8 confirmed meetings per client, most recent first.
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
WHERE rn <= 8;


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
    )::int AS ltm_meetings,
    COUNT(*) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '24 months'
        AND m.meeting_date <  CURRENT_DATE - INTERVAL '12 months'
    )::int AS prior_12mo_meetings,
    COUNT(DISTINCT m.client_account_id)::int AS unique_clients_lifetime,
    COUNT(DISTINCT NULLIF(COALESCE(m.investor_text, ''), ''))::int
      AS unique_people_lifetime,
    MIN(m.meeting_date)::date AS first_met,
    MAX(m.meeting_date)::date AS last_met
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
    )::int AS ltm_meetings,
    COUNT(*) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '24 months'
        AND m.meeting_date <  CURRENT_DATE - INTERVAL '12 months'
    )::int AS prior_12mo_meetings,
    COUNT(DISTINCT m.client_account_id)::int AS lifetime_clients,
    COUNT(DISTINCT m.client_account_id) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
    )::int AS ltm_clients,
    COUNT(DISTINCT NULLIF(COALESCE(m.investor_text, ''), ''))::int
      AS lifetime_people,
    COUNT(DISTINCT NULLIF(COALESCE(m.investor_text, ''), '')) FILTER (
      WHERE m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
    )::int AS ltm_people,
    COUNT(*) FILTER (
      WHERE m.feedback_status_label = 'Closed - All in'
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
    )::int AS ltm_feedback_collected,
    COUNT(*) FILTER (
      WHERE m.feedback_status_label IN ('Closed - All in', 'Closed - No Feedback')
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
    )::int AS ltm_feedback_total_closed,
    MIN(m.meeting_date)::date AS first_met,
    MAX(m.meeting_date)::date AS last_met
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
    )::int AS ltm_count,
    MAX(m.meeting_date)::date AS last_met
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
-- Last 8 confirmed meetings per institution, most recent first.
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
WHERE rn <= 8;

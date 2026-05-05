-- =============================================================================
-- 03_views.sql
--
-- Computed views that power each dashboard surface.
-- Run after 01_mirror_tables.sql and 02_rose_owned_tables.sql.
-- =============================================================================

DROP VIEW IF EXISTS public.v_pipeline_30d CASCADE;
DROP VIEW IF EXISTS public.v_contract_renewals CASCADE;
DROP VIEW IF EXISTS public.v_feedback_overall CASCADE;
DROP VIEW IF EXISTS public.v_feedback_by_analyst CASCADE;
DROP VIEW IF EXISTS public.v_feedback_by_client CASCADE;
DROP VIEW IF EXISTS public.v_analyst_activity CASCADE;
DROP VIEW IF EXISTS public.v_client_portfolio CASCADE;
DROP VIEW IF EXISTS public.v_client_quarterly_pnl CASCADE;
DROP VIEW IF EXISTS public.v_meeting_costs CASCADE;


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

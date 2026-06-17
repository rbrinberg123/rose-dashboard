-- =============================================================================
-- Patch: bound every trailing-window meeting count to "up to now"
-- Date: 2026-06-17
--
-- Bug: LTM / trailing-12-month (and 30-day / quarterly / monthly) meeting counts
-- had only a lower bound (meeting_date >= today - N), so future-dated Confirmed
-- meetings inflated them (e.g. client "Emco" showed 14 LTM == 14 all-time).
--
-- Fix: add  AND meeting_date <= now()  to every trailing window, and guard the
-- last_met = MAX(meeting_date) columns with FILTER (WHERE meeting_date <= now()).
-- now() is timestamptz; meeting_date is timestamptz; the comparison is absolute,
-- so there is no timezone ambiguity. Past meetings up to this instant count;
-- scheduled/future meetings do not. prior_12mo / prev_1y windows were already
-- bounded and are unchanged. v_pipeline_30d and v_scheduler_* are intentionally
-- forward-looking and are NOT touched.
--
-- These 18 views are independent (no view references another), so order does
-- not matter. Paste the whole file into the Supabase SQL Editor and run.
-- Source of truth: sql/03_views.sql
-- =============================================================================

CREATE OR REPLACE VIEW public.v_productivity_detail_summary AS
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
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
        AND m.meeting_status_label != 'Cancelled'
    )::int AS meetings_scheduled_12m,
    COUNT(*) FILTER (
      WHERE m.host_id = uu.user_id
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
        AND m.meeting_status_label != 'Cancelled'
    )::int AS meetings_hosted_12m,
    COUNT(*) FILTER (
      WHERE m.host_id = uu.user_id
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
        AND m.meeting_status_label != 'Cancelled'
        AND m.is_in_person = true
    )::int AS meetings_in_person_12m,
    COUNT(*) FILTER (
      WHERE m.host_id = uu.user_id
        AND m.meeting_date >= CURRENT_DATE - INTERVAL '12 months'
        AND m.meeting_date <= now()
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

CREATE OR REPLACE VIEW public.v_person_role_ttm AS
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
GROUP BY uu.user_id;

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
  AND m.meeting_date <= now()
GROUP BY mu.display_name, mu.period_year, mu.period_month;

CREATE OR REPLACE VIEW public.v_productivity_detail_institutions AS
WITH recent_meetings AS (
  SELECT
    booker_id,
    host_id,
    meeting_status_label,
    institution_id,
    institution_name,
    meeting_date
  FROM public.meetings
  WHERE meeting_date >= CURRENT_DATE - INTERVAL '12 months'
    AND meeting_date <= now()
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
    AND meeting_status_label != 'Cancelled'
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
 AND b.institution_name = h.institution_name;

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
   AND m.meeting_date <= now()) AS is_ltm
FROM public.meetings m
JOIN inst_id i ON i.institution_name = m.institution_name
LEFT JOIN public.accounts a
  ON a.account_id = m.client_account_id
WHERE m.meeting_status_label = 'Confirmed'
  AND m.institution_name IS NOT NULL;

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

CREATE OR REPLACE VIEW public.v_person_activity_windows AS
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
GROUP BY au.user_id, u.display_name;

CREATE OR REPLACE VIEW public.v_person_feedback_windows AS
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
GROUP BY ah.user_id, u.display_name;


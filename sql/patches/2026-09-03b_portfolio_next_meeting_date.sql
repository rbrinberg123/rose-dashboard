-- =============================================================================
-- Patch: Client Portfolio — add next_meeting_date to public.v_client_portfolio
-- Date: 2026-09-03 (b — run AFTER 2026-09-03_portfolio_open_slots_intro_followup)
--
-- Powers the Portfolio table's new "Next" column: the client's
-- next confirmed meeting.
--
--   next_meeting_date
--     MIN(meeting_date) over public.meetings where
--       meeting_status_label = 'Confirmed'
--     and the meeting's EASTERN calendar day is today-or-later. NULL when the
--     client has no upcoming confirmed meeting -- the UI renders a muted em-dash
--     rather than a zero, because "no next meeting" is an absence, not a count.
--
--     TODAY-OR-LATER, not strictly-future, and therefore a DAY comparison, not
--     an instant one: the column answers "what day is this client next in
--     front of investors", and a meeting at 9am today is still today's answer
--     at 4pm. Eastern is the firm's operating day and the convention the newer
--     views (v_client_todo, v_marketing_calendar) settled on, so the same
--     Eastern-day rule is used on both sides of the comparison.
--
--     This DELIBERATELY differs from meetings_next_3m elsewhere in the group,
--     which is a strictly-forward count bounded by `meeting_date > now()`. That
--     one asks "how much is booked ahead of me", where a meeting that already
--     started is not ahead of anyone; this one asks "when next", where it is.
--     A consequence worth knowing: a client whose only meeting today is at 9am
--     shows that date under BOTH Last and Next, and 0 under Next 3M. All
--     three are correct answers to three different questions.
--
-- APPENDED as the last column of the select list, for the same reason as the
-- three columns before it: CREATE OR REPLACE VIEW can only ADD columns at the
-- end -- inserting one mid-list fails with "cannot change name of view column
-- ..." -- so this runs as a plain replace, with no DROP, no lost GRANT and no
-- window where the Portfolio page 500s. The page reads by name (select("*")),
-- so the column's position in the view has no bearing on where it renders.
--
-- Everything above the new column is unchanged from
-- 2026-09-03_portfolio_open_slots_intro_followup.sql; see that file for the
-- open_slots / intro_meetings / followup_meetings commentary.
--
-- Safe to re-run.
-- =============================================================================

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
    MAX(meeting_date) FILTER (WHERE meeting_date <= CURRENT_DATE) AS last_meeting_date,
    -- The client's NEXT confirmed meeting — soonest whose Eastern day is
    -- today-or-later. Day-based on purpose; see the header note.
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
),
recent_note AS (
  SELECT DISTINCT ON (client_account_id)
    client_account_id,
    note_date,
    note_status
  FROM (
    SELECT
      client_account_id,
      note_date,
      modified_on,
      created_on,
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
  ) s
  WHERE note_status IS NOT NULL   -- only notes that actually set a status
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

  COALESCE(ma.meetings_last_365d, 0)::int            AS meetings_last_365d,
  COALESCE(ma.meetings_last_90d, 0)::int             AS meetings_last_90d,
  COALESCE(ma.unique_institutions_last_365d, 0)::int AS unique_institutions_last_365d,
  ma.last_meeting_date::date                         AS last_meeting_date,

  a.last_event_date::date       AS last_event_date,
  a.last_touchpoint_date::date  AS last_note_date,

  a.state_label AS account_state,

  rn.note_status,
  rn.note_date::date AS note_status_date,

  COALESCE(ma.meetings_next_3m, 0)::int AS meetings_next_3m,

  COALESCE(os.open_slots, 0)::int        AS open_slots,
  COALESCE(ia.intro_meetings, 0)::int    AS intro_meetings,
  COALESCE(ia.followup_meetings, 0)::int AS followup_meetings,

  -- APPENDED (2026-09-03b). Must stay at the very end of the select list so
  -- CREATE OR REPLACE VIEW can keep replacing this view without a DROP.
  -- NULL (not a zero / not a sentinel date) when nothing is booked ahead.
  ma.next_meeting_date::date AS next_meeting_date

FROM public.accounts a
LEFT JOIN meeting_agg ma ON ma.client_account_id = a.account_id
LEFT JOIN recent_contract rc ON rc.client_account_id = a.account_id
LEFT JOIN recent_note rn ON rn.client_account_id = a.account_id
LEFT JOIN intro_agg ia ON ia.client_account_id = a.account_id
LEFT JOIN open_slot_agg os ON os.client_account_id = a.account_id
WHERE a.state_label = 'Active';

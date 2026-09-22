-- =============================================================================
-- Patch: Client Portfolio — add meetings_ytd to public.v_client_portfolio
-- Date: 2026-09-22
--
-- ONE new column, APPENDED to the end of the select list. CREATE OR REPLACE
-- VIEW can only ADD columns at the end -- inserting one mid-list fails with
-- "cannot change name of view column ..." -- so this runs as a plain replace:
-- no DROP, no CASCADE, no lost GRANT, no dropped dependent view (several
-- v_client_stats_* views read this one), and no window where the Portfolio
-- page 500s. The page reads by name (select("*")), so the column's position in
-- the view has nothing to do with where it renders: the table puts YTD FIRST in
-- the meetings group, immediately before L12M.
--
--   meetings_ytd
--     Calendar year-to-date count of the client's CONFIRMED meetings:
--     January 1 of the current year through today.
--
--     ── IT IS meetings_last_365d's RULE WITH A DIFFERENT WINDOW ────────────
--     Deliberately NOT a new definition. Every other part of the counting
--     basis is copied from the L12M column sitting next to it, so the two are
--     comparable on the same row:
--
--       same source        public.meetings
--       same status filter meeting_status_label = 'Confirmed'   (the CTE's
--                          WHERE, so cancellations never inflate either count)
--       same date field    meeting_date
--       same upper bound   <= CURRENT_DATE
--       same timezone      CURRENT_DATE, evaluated identically for both
--
--     Only the lower bound differs:
--       meetings_last_365d   >= CURRENT_DATE - interval '365 days'
--       meetings_ytd         >= date_trunc('year', CURRENT_DATE)
--
--     ── CONSEQUENCES OF SHARING THAT UPPER BOUND ───────────────────────────
--     meeting_date is timestamptz and CURRENT_DATE is a date, so `<= CURRENT_DATE`
--     compares against MIDNIGHT this morning -- a meeting later TODAY is in
--     neither count. That is inherited on purpose rather than corrected here:
--     the whole point of the column is that YTD and L12M agree about what
--     "through today" means. Changing it would be a change to L12M, which this
--     patch is not.
--
--     NB this is a different question from v_client_todo.meetings_ytd on the
--     Outreach Status page, which cuts at `meeting_date < now()` on the EASTERN
--     day so that today's meetings split by time of day. Both are correct for
--     their own page; they can differ by today's already-held meetings.
--
--     ── EXPECTED RELATIONSHIP TO L12M ──────────────────────────────────────
--     Neither column dominates the other in general:
--       * Early in the year YTD <= L12M for almost every client, because the
--         trailing window still holds last year's tail.
--       * YTD can EXCEED L12M only if a client's meetings this year are more
--         numerous than the trailing 365 days contains -- impossible, since the
--         YTD window is a strict subset of the L12M window for any date on or
--         after Jan 1 (365 days back from any day this year reaches into last
--         year). So YTD <= L12M ALWAYS holds, and is asserted in the
--         verification queries at the foot of this file.
--
--     COALESCE to 0, ::int, and a client with no meetings gets 0 rather than
--     NULL -- identical treatment to every other count column here.
--
-- SAFE TO RE-RUN.
--
-- Run once in the Supabase SQL editor.
-- See dashboard/content/docs/ for the Client Portfolio page documentation.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_client_portfolio AS
WITH meeting_agg AS (
  SELECT
    client_account_id,
    COUNT(*) FILTER (
      WHERE meeting_date >= CURRENT_DATE - interval '365 days'
        AND meeting_date <= CURRENT_DATE
    ) AS meetings_last_365d,
    -- APPENDED (2026-09-22). meetings_last_365d's rule, Jan-1-to-today.
    -- Same source, same Confirmed filter (the CTE WHERE below), same
    -- meeting_date field, same <= CURRENT_DATE upper bound -- only the
    -- lower bound moves. See the header for why the shared upper bound
    -- (midnight today) is inherited rather than corrected.
    COUNT(*) FILTER (
      WHERE meeting_date >= date_trunc('year', CURRENT_DATE)
        AND meeting_date <= CURRENT_DATE
    ) AS meetings_ytd,
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
  ma.next_meeting_date::date AS next_meeting_date,

  -- APPENDED (2026-09-22). Must stay at the very end of the select list
  -- so CREATE OR REPLACE VIEW can keep replacing this view without a DROP.
  COALESCE(ma.meetings_ytd, 0)::int AS meetings_ytd

FROM public.accounts a
LEFT JOIN meeting_agg ma ON ma.client_account_id = a.account_id
LEFT JOIN recent_contract rc ON rc.client_account_id = a.account_id
LEFT JOIN recent_note rn ON rn.client_account_id = a.account_id
LEFT JOIN intro_agg ia ON ia.client_account_id = a.account_id
LEFT JOIN open_slot_agg os ON os.client_account_id = a.account_id
WHERE a.state_label = 'Active';

-- ── Verification ─────────────────────────────────────────────────────────────
-- 1. The invariant: YTD must NEVER exceed L12M (the YTD window is a strict
--    subset of the trailing-365-day window for any date this year).
--    EXPECT ZERO ROWS.
-- SELECT ticker_symbol, name, meetings_ytd, meetings_last_365d
-- FROM public.v_client_portfolio
-- WHERE meetings_ytd > meetings_last_365d;
--
-- 2. Methodology cross-check: recompute both counts straight off public.meetings
--    and compare to the view. EXPECT ZERO ROWS.
-- WITH direct AS (
--   SELECT client_account_id,
--     COUNT(*) FILTER (WHERE meeting_date >= date_trunc('year', CURRENT_DATE)
--                        AND meeting_date <= CURRENT_DATE) AS ytd,
--     COUNT(*) FILTER (WHERE meeting_date >= CURRENT_DATE - interval '365 days'
--                        AND meeting_date <= CURRENT_DATE) AS l12m
--   FROM public.meetings
--   WHERE meeting_status_label = 'Confirmed'
--   GROUP BY client_account_id
-- )
-- SELECT p.ticker_symbol, p.meetings_ytd, d.ytd, p.meetings_last_365d, d.l12m
-- FROM public.v_client_portfolio p
-- LEFT JOIN direct d ON d.client_account_id = p.account_id
-- WHERE p.meetings_ytd <> COALESCE(d.ytd, 0)
--    OR p.meetings_last_365d <> COALESCE(d.l12m, 0);
--
-- 3. Eyeball the busiest clients.
-- SELECT ticker_symbol, name, meetings_ytd, meetings_last_365d
-- FROM public.v_client_portfolio
-- ORDER BY meetings_last_365d DESC
-- LIMIT 15;

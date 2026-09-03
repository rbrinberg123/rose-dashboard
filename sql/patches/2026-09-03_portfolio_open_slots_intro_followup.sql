-- =============================================================================
-- Patch: Client Portfolio — add open_slots, intro_meetings, followup_meetings
--        to public.v_client_portfolio
-- Date: 2026-09-03
--
-- Three new columns, all APPENDED to the end of the select list. CREATE OR
-- REPLACE VIEW can only ADD columns at the end -- inserting one mid-list fails
-- with "cannot change name of view column ..." -- so this runs as a plain
-- replace: no DROP, no lost GRANT, no window where the Portfolio page 500s.
-- The page reads by name (select("*")), so position in the view is irrelevant
-- to where the columns render.
--
--   open_slots
--     Total open marketing-event slots remaining across the client's events
--     that are still in the OPEN part of the pipeline.
--
--     Event universe: public.events with
--       state_label       = 'Active'                (record not deactivated)
--       event_state_label IN ('Pre-Launch', 'Live Outreach', 'Meetings Ongoing')
--     The other three bcs_eventstate values -- 'Schedule Closed',
--     'Preparing Feedback', 'Complete' -- are EXCLUDED: by then the schedule is
--     shut and a remaining slot is not something anyone can still fill. 'Pause'
--     is excluded for the same reason it is everywhere else (a paused event is
--     not a live target).
--
--     Per event: GREATEST(of_slots - confirmed_meetings, 0)
--       of_slots           = events.of_slots (Dynamics bcs_ofslots), the event's
--                            slot capacity.
--       confirmed_meetings = COUNT of public.meetings on event_id where
--                            meeting_status_label = 'Confirmed'. Counted from
--                            meetings, NOT from the events.confirmed_meetings
--                            Dynamics rollup, which lags. Identical slot
--                            definition to v_client_todo.open_slots.
--       GREATEST(..., 0)   = floor at zero; slots_remaining can go negative in
--                            Dynamics when an event is overbooked, and a
--                            negative would silently cancel out another event's
--                            genuinely open slots in the SUM below.
--
--     Summed across all qualifying events for the client. Events with a NULL
--     of_slots contribute nothing (capacity unknown, not zero) -- 2 of the 116
--     currently-qualifying events. A client with no qualifying event at all
--     gets 0, not NULL: "nothing open" is the true answer, and the column is a
--     count the UI right-aligns.
--
--   intro_meetings / followup_meetings
--     The Intro / Follow-Up split of the client's CONFIRMED meetings, ALL-TIME.
--
--     An INTRO is the FIRST (earliest) meeting Rose organized between this
--     client and a given institution. Every later meeting between that same
--     pair is a FOLLOW-UP. Since exactly one meeting per (client, institution)
--     pair can be the earliest, the per-client counts reduce to:
--
--       intro_meetings    = COUNT(DISTINCT institution) for the client
--       followup_meetings = total confirmed meetings - intro_meetings
--
--     which is what this computes -- no window function and no tie-break needed
--     (two meetings on the same instant would make "the earliest" ambiguous,
--     but "one intro per institution" is not).
--
--     Meetings are filtered to meeting_status_label = 'Confirmed', matching
--     every other meeting count on this view, and are NOT windowed -- these are
--     lifetime relationship counts, unlike the trailing L12M / L3M columns.
--     Institution identity is meetings.institution_name, the same key the
--     view's existing unique_institutions_last_365d uses. institution_name and
--     institution_id are strictly 1:1 across all 12,595 confirmed meetings
--     (1,557 distinct of each, no name with two ids and no id with two names),
--     so the choice of key does not change a single number.
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
    MAX(meeting_date) FILTER (WHERE meeting_date <= CURRENT_DATE) AS last_meeting_date
  FROM public.meetings
  WHERE meeting_status_label = 'Confirmed'
  GROUP BY client_account_id
),
-- Intro / Follow-Up split of all-time CONFIRMED meetings. One row per
-- (client, institution) pair carrying that pair's meeting count; the pair
-- ITSELF is the intro (its earliest meeting), so per client the number of
-- pairs is the intro count and everything above it is follow-up. See the
-- header note. Meetings with no institution on record are dropped (there are
-- none today, but a NULL is not an institution and must not become a pair).
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
-- Confirmed meetings booked against each event — the "filled slots" side of
-- the open-slot arithmetic. Read from meetings rather than the lagging
-- events.confirmed_meetings rollup.
event_confirmed AS (
  SELECT event_id, COUNT(*)::int AS confirmed_meetings
  FROM public.meetings
  WHERE meeting_status_label = 'Confirmed'
    AND event_id IS NOT NULL
  GROUP BY event_id
),
-- Open slots summed across the client's still-open pipeline events. See the
-- header note for the included/excluded stages and the floor-at-zero.
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
-- Each client's health-status flag, derived from client_notes. "Last non-blank
-- status wins" — unchanged from the original definition; see sql/03_views.sql
-- for the full commentary.
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

  COALESCE(ma.meetings_last_365d, 0)::int          AS meetings_last_365d,
  COALESCE(ma.meetings_last_90d, 0)::int           AS meetings_last_90d,
  COALESCE(ma.unique_institutions_last_365d, 0)::int AS unique_institutions_last_365d,
  ma.last_meeting_date::date                       AS last_meeting_date,

  a.last_event_date::date       AS last_event_date,
  a.last_touchpoint_date::date  AS last_note_date,

  a.state_label AS account_state,

  rn.note_status,
  rn.note_date::date AS note_status_date,

  COALESCE(ma.meetings_next_3m, 0)::int AS meetings_next_3m,

  -- APPENDED (2026-09-03). These three must stay at the very END of the select
  -- list so CREATE OR REPLACE VIEW can keep replacing this view without a DROP.
  COALESCE(os.open_slots, 0)::int        AS open_slots,
  COALESCE(ia.intro_meetings, 0)::int    AS intro_meetings,
  COALESCE(ia.followup_meetings, 0)::int AS followup_meetings

FROM public.accounts a
LEFT JOIN meeting_agg ma ON ma.client_account_id = a.account_id
LEFT JOIN recent_contract rc ON rc.client_account_id = a.account_id
LEFT JOIN recent_note rn ON rn.client_account_id = a.account_id
LEFT JOIN intro_agg ia ON ia.client_account_id = a.account_id
LEFT JOIN open_slot_agg os ON os.client_account_id = a.account_id
WHERE a.state_label = 'Active';

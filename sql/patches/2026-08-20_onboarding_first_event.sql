-- =============================================================================
-- 2026-08-20 — v_client_onboarding: First Event columns
-- =============================================================================
-- RUN THIS AGAINST SUPABASE. Nothing here takes effect until it is executed.
--
-- Prerequisite: run 2026-08-20_onboarding_dates_contract_notes.sql first. This
-- file rebuilds the whole view on top of that one, so if they are run out of
-- order the earlier patch wins and these columns disappear.
--
-- ADDS three columns describing the client EARLIEST marketing event:
--   first_event_name         -- events.name, raw. The page strips the leading
--                               "TICKER - " for display (stripTickerPrefix).
--   first_event_date         -- the event window START, as an Eastern day.
--   first_event_state_label  -- events.event_state_label, for the status pill.
--
-- HOW THE EVENT IS CHOSEN. Identical bucketing to the Client Detail "Marketing
-- Events and Dates" block and the To-Do List next_event_* columns: an event
-- window starts at the EARLIEST Eastern day of its CONFIRMED meetings, falling
-- back to its own event_start_actual / event_end_actual when it has no confirmed
-- meetings yet. The first event is then the one with the smallest window start.
--
-- The difference from the To-Do List is direction only: that view picks the
-- SOONEST current-or-upcoming event, this one picks the EARLIEST ever. So there
-- is deliberately NO date floor here -- an onboarding client first event is
-- usually in the past or in flight, and filtering to upcoming would blank the
-- column exactly when it is most useful.
--
-- Event universe matches v_marketing_calendar (state_label = Active,
-- event_state_label present and not Pause) MINUS that view trailing two-month
-- cutoff, which would hide an older first event. Events that resolve to no date
-- at all (no confirmed meetings and no actual window) are skipped, so the column
-- never shows an undated event; a client with no qualifying event gets NULLs and
-- the page renders a muted dash.
--
-- Verified against live data 2026-08-20: 8 of the 10 clients on the page resolve
-- an event, 2 have none. States in play: Pre-Launch, Live Outreach, Meetings
-- Ongoing, Schedule Closed.
--
-- filled_count stays at 9 -- these are reference columns, not steps.
--
-- Safe to re-run. Nothing else in the schema selects from this view.
-- =============================================================================

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
    -- The two date-backed steps expose their actual date as well as the flag, so
    -- the grid can print it under the checkmark. Read as the Eastern calendar
    -- day, same convention as onboarding_start_date above. Both are real
    -- intraday timestamps (not UTC midnight), so this cast cannot shift the day.
    (a.onboarding_call     AT TIME ZONE 'America/New_York')::date AS onboarding_call_date,
    (a.teach_in_date       AT TIME ZONE 'America/New_York')::date AS teach_in_date,
    -- Free-text onboarding notes. Empty and whitespace-only strings collapse to
    -- NULL so the page has exactly one "no note" case to render muted.
    NULLIF(btrim(a.onboarding_notes), '') AS onboarding_notes,
    (a.onboarding_call          IS NOT NULL) AS f_onboarding_call,
    (a.teach_in_date            IS NOT NULL) AS f_teach_in_date,
    (a.calendar                 IS TRUE)     AS f_calendar,
    (a.calendar_confirmed       IS TRUE)     AS f_calendar_confirmed,
    (a.distro                   IS TRUE)     AS f_distro,
    (a.bda_peers                IS TRUE)     AS f_bda_peers,
    (a.recurring_call_scheduled IS TRUE)     AS f_recurring_call_scheduled,
    (a.report                   IS TRUE)     AS f_report
  FROM public.accounts a
  WHERE a.state_label = 'Active'
),
-- Meeting History step. Sourced from the client latest COMPLETED Outreach ->
-- Data Upload task, NOT from accounts.meeting_history_received. Verbatim the
-- same CTE the To-Do List uses for its Last Data Upload column
-- (sql/20_client_todo.sql), so the two pages can never disagree about when a
-- client last uploaded.
data_upload AS (
  SELECT
    t.bcs_account_id AS account_id,
    MAX((COALESCE(t.actual_end, t.scheduled_end, t.scheduled_start)
           AT TIME ZONE 'America/New_York')::date) AS meeting_history_date
  FROM public.tasks t
  WHERE t.bcs_account_id IS NOT NULL
    AND t.bcs_task_type_label    = 'Outreach'
    AND t.bcs_task_subtype_label = 'Data Upload'
    AND t.state_label            = 'Completed'
    AND COALESCE(t.actual_end, t.scheduled_end, t.scheduled_start) IS NOT NULL
  GROUP BY t.bcs_account_id
),
-- Contract term start, one row per client. A client can hold several contract
-- rows because every renewal is stored as its own row, so pick deliberately:
-- an ACTIVE term wins over an expired or terminated one, and among those the
-- latest start wins. This matches how v_client_detail_active_contract chooses,
-- with a fallback so a client whose only contract has lapsed still shows a date
-- rather than a blank. contract_start_date is already a plain date column in
-- the mirror, so no timezone cast applies.
contract_start AS (
  SELECT DISTINCT ON (c.client_account_id)
    c.client_account_id AS account_id,
    c.contract_start_date
  FROM public.contracts c
  WHERE c.contract_start_date IS NOT NULL
  ORDER BY
    c.client_account_id,
    (c.contract_status_label IN ('Initial Term', 'Renewal Term')) DESC,
    c.contract_start_date DESC
),
-- Confirmed-meeting window per event (Eastern days). Same shape as the To-Do
-- List ev_mtg CTE; only first_day is needed here.
ev_mtg AS (
  SELECT
    m.event_id,
    MIN((m.meeting_date AT TIME ZONE 'America/New_York')::date) AS first_day
  FROM public.meetings m
  WHERE m.event_id IS NOT NULL
    AND m.meeting_status_label = 'Confirmed'
    AND m.meeting_date IS NOT NULL
  GROUP BY m.event_id
),
-- Every event in the calendar universe, resolved to its window START. LEAST()
-- ignores NULL arguments in Postgres, so an event carrying only one of the two
-- actual dates still resolves to a single-day fallback.
ev AS (
  SELECT
    e.event_id,
    e.client_account_id,
    e.name AS event_name,
    e.event_state_label,
    COALESCE(
      em.first_day,
      LEAST(
        (e.event_start_actual AT TIME ZONE 'America/New_York')::date,
        (e.event_end_actual   AT TIME ZONE 'America/New_York')::date
      )
    ) AS start_day
  FROM public.events e
  LEFT JOIN ev_mtg em ON em.event_id = e.event_id
  WHERE e.state_label = 'Active'
    AND e.event_state_label IS NOT NULL
    AND e.event_state_label <> 'Pause'
    AND e.client_account_id IS NOT NULL
),
-- The EARLIEST dated event per client. event_name breaks ties so the pick is
-- deterministic when two events share a start day.
first_ev AS (
  SELECT DISTINCT ON (client_account_id)
    client_account_id AS account_id,
    event_name  AS first_event_name,
    start_day   AS first_event_date,
    event_state_label AS first_event_state_label
  FROM ev
  WHERE start_day IS NOT NULL
  ORDER BY client_account_id, start_day ASC, event_name
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
  -- Contract TERM start. Distinct from onboarding_start_date above.
  cs.contract_start_date,
  onb.f_onboarding_call,
  onb.f_teach_in_date,
  onb.f_calendar,
  onb.f_calendar_confirmed,
  (du.meeting_history_date IS NOT NULL)      AS f_meeting_history,
  onb.f_distro,
  onb.f_bda_peers,
  onb.f_recurring_call_scheduled,
  onb.f_report,
  -- Dates printed under the checkmark for the three date-backed steps. NULL for
  -- a step that has not happened, in which case the grid shows the muted dash
  -- and no date line.
  onb.onboarding_call_date,
  onb.teach_in_date,
  du.meeting_history_date,
  -- Earliest marketing event. Name is raw; the page strips the ticker prefix.
  fe.first_event_name,
  fe.first_event_date,
  fe.first_event_state_label,
  -- Free text for the trailing Notes column. NULL when the client has no note;
  -- the page renders a greyed icon in that case.
  onb.onboarding_notes,
  ( onb.f_onboarding_call::int
  + onb.f_teach_in_date::int
  + onb.f_calendar::int
  + onb.f_calendar_confirmed::int
  + (du.meeting_history_date IS NOT NULL)::int
  + onb.f_distro::int
  + onb.f_bda_peers::int
  + onb.f_recurring_call_scheduled::int
  + onb.f_report::int ) AS filled_count,
  9 AS onboarding_field_count
FROM onb
LEFT JOIN data_upload du ON du.account_id = onb.account_id
LEFT JOIN contract_start cs ON cs.account_id = onb.account_id
LEFT JOIN first_ev fe ON fe.account_id = onb.account_id
  -- Exit condition: no completed Feedback Report Sent task yet. Full rationale
  -- in sql/03_views.sql. (Keep comments inside this statement free of
  -- apostrophes -- SQL clients that split pasted text on quote state mis-parse
  -- them and submit a broken fragment.)
WHERE NOT EXISTS (
        SELECT 1
        FROM public.tasks t
        WHERE t.bcs_account_id         = onb.account_id
          AND t.bcs_task_subtype_label = 'Feedback Report Sent'
          AND t.state_label            = 'Completed'
      )
  -- Scope cutoff: only clients whose onboarding started on/after this date.
  AND onb.onboarding_start_date >= DATE '2026-01-01'
ORDER BY days_onboarding DESC NULLS LAST, onb.name;

GRANT SELECT ON public.v_client_onboarding TO service_role;

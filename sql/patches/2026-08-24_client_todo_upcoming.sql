-- =============================================================================
-- Patch: add meetings_upcoming to public.v_client_todo, and split the confirmed
--        meeting counts so YTD and UPC never count the same meeting twice
-- Date: 2026-08-24
--
-- Adds the To-Do List's third Meetings column ("UPC"): confirmed meetings that
-- have NOT yet occurred. In the same pass it re-cuts meetings_ytd, because the
-- two columns are meant to be a partition, not two overlapping windows.
--
--   BEFORE  ytd = Eastern day between Jan 1 and today (inclusive)
--   AFTER   ytd = Eastern day >= Jan 1 this year AND meeting_date <  now()
--           upc =                                    meeting_date >= now()
--
-- The old date-only cap put every meeting DATED TODAY in both columns at once
-- (8 firm-wide at the time of writing). Comparing the meeting's own timestamp
-- to now() makes the two predicates exact complements, so a confirmed meeting
-- scores in exactly one: today's 9am has happened and lands in YTD, today's 4pm
-- has not and lands in UPC. Meetings before Jan 1 of this year are in neither,
-- which is what YTD means.
--
-- meeting_date and now() are both timestamptz, so this is an instant-vs-instant
-- comparison with no timezone ambiguity -- the same reasoning the 2026-06-17
-- trailing-window patch used. Eastern is still what decides which CALENDAR YEAR
-- a meeting belongs to; it is simply no longer what decides whether it has
-- happened. The occurred test reads the meeting's START (meeting_date is the
-- start timestamp -- the Dynamics mirror carries no end), so a meeting in
-- progress right now counts as occurred.
--
-- UPC has no far end: it counts the whole booked future, not the rest of the
-- calendar year. L12M is deliberately UNCHANGED -- it is a rolling-volume
-- figure, not half of a partition, so it keeps its day-based window.
--
-- meetings_upcoming is APPENDED as the last column of the select list. CREATE
-- OR REPLACE VIEW can only add columns at the end -- inserting one mid-list
-- fails with "cannot change name of view column ..." -- so this runs as a plain
-- replace: no DROP, no lost GRANT, no window where the page 500s. The UI reads
-- by name (the loader does select("*")), so the column's position in the view
-- has no bearing on where it renders.
--
-- Safe to run whether or not an earlier draft of this patch was already applied:
-- the column list and its order are unchanged, only the FILTER predicates move.
--
-- Paste the whole file into the Supabase SQL Editor and run.
-- Source of truth: sql/20_client_todo.sql
-- =============================================================================

CREATE OR REPLACE VIEW public.v_client_todo AS
WITH today AS (
  SELECT (now() AT TIME ZONE 'America/New_York')::date AS d
),
-- Confirmed-meeting counts per client: occurred-this-year, trailing 12 months,
-- and still-to-come. ytd/upcoming partition on now(); see the header notes.
mtg AS (
  SELECT
    m.client_account_id,
    -- Occurred THIS YEAR. Two different kinds of bound on purpose: which
    -- calendar year a meeting belongs to is an Eastern-day question, whether
    -- it has already happened is an instant question, so the year start stays
    -- day-based and the upper bound is a bare timestamptz < now().
    COUNT(*) FILTER (
      WHERE (m.meeting_date AT TIME ZONE 'America/New_York')::date
              >= date_trunc('year', (SELECT d FROM today))::date
        AND m.meeting_date < now()
    )::int AS meetings_ytd,
    COUNT(*) FILTER (
      WHERE (m.meeting_date AT TIME ZONE 'America/New_York')::date
              >  (SELECT d FROM today) - INTERVAL '12 months'
        AND (m.meeting_date AT TIME ZONE 'America/New_York')::date
              <= (SELECT d FROM today)
    )::int AS meetings_l12m,
    -- Not yet occurred: the exact complement of the ytd upper bound at now(),
    -- so no meeting can score in both. Unbounded on the far end.
    COUNT(*) FILTER (
      WHERE m.meeting_date >= now()
    )::int AS meetings_upcoming
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.client_account_id IS NOT NULL
    AND m.meeting_date IS NOT NULL
  GROUP BY m.client_account_id
),
-- Most recent touchpoint per client (Eastern day, capped at today).
touch AS (
  SELECT
    t.client_account_id,
    MAX((t.scheduled_start AT TIME ZONE 'America/New_York')::date) AS last_touch_date
  FROM public.touchpoints t
  WHERE t.client_account_id IS NOT NULL
    AND t.scheduled_start IS NOT NULL
    AND (t.scheduled_start AT TIME ZONE 'America/New_York')::date
          <= (SELECT d FROM today)
  GROUP BY t.client_account_id
),
-- Most recent COMPLETED Outreach → Data Upload task per client.
upload AS (
  SELECT
    t.bcs_account_id AS client_account_id,
    MAX((COALESCE(t.actual_end, t.scheduled_end, t.scheduled_start)
           AT TIME ZONE 'America/New_York')::date) AS last_data_upload_date
  FROM public.tasks t
  WHERE t.bcs_account_id IS NOT NULL
    AND t.bcs_task_type_label    = 'Outreach'
    AND t.bcs_task_subtype_label = 'Data Upload'
    AND t.state_label            = 'Completed'
    AND COALESCE(t.actual_end, t.scheduled_end, t.scheduled_start) IS NOT NULL
  GROUP BY t.bcs_account_id
),
-- Confirmed-meeting window + count per event (Eastern days).
ev_mtg AS (
  SELECT
    m.event_id,
    MIN((m.meeting_date AT TIME ZONE 'America/New_York')::date) AS first_day,
    MAX((m.meeting_date AT TIME ZONE 'America/New_York')::date) AS last_day,
    MIN((m.meeting_date AT TIME ZONE 'America/New_York')::date) FILTER (
      WHERE (m.meeting_date AT TIME ZONE 'America/New_York')::date
              >= (SELECT d FROM today)
    ) AS soonest_day,
    COUNT(*)::int AS confirmed_meetings
  FROM public.meetings m
  WHERE m.event_id IS NOT NULL
    AND m.meeting_status_label = 'Confirmed'
    AND m.meeting_date IS NOT NULL
  GROUP BY m.event_id
),
-- Every event in the calendar universe, resolved to its bucketing window.
-- LEAST()/GREATEST() ignore NULL arguments in Postgres, so an event with only
-- one of the two actual dates still resolves to a single-day fallback window.
ev AS (
  SELECT
    e.event_id,
    e.client_account_id,
    e.name              AS event_name,
    e.event_state_label,
    e.of_slots,
    COALESCE(em.confirmed_meetings, 0) AS confirmed_meetings,
    COALESCE(
      em.first_day,
      LEAST(
        (e.event_start_actual AT TIME ZONE 'America/New_York')::date,
        (e.event_end_actual   AT TIME ZONE 'America/New_York')::date
      )
    ) AS start_day,
    COALESCE(
      em.last_day,
      GREATEST(
        (e.event_start_actual AT TIME ZONE 'America/New_York')::date,
        (e.event_end_actual   AT TIME ZONE 'America/New_York')::date
      )
    ) AS end_day,
    em.soonest_day AS meeting_soonest_day
  FROM public.events e
  LEFT JOIN ev_mtg em ON em.event_id = e.event_id
  WHERE e.state_label = 'Active'
    AND e.event_state_label IS NOT NULL
    AND e.event_state_label <> 'Pause'
    AND e.client_account_id IS NOT NULL
),
-- The soonest current/upcoming event per client.
next_ev AS (
  SELECT DISTINCT ON (client_account_id)
    client_account_id,
    event_id,
    event_name,
    event_state_label,
    start_day,
    end_day,
    confirmed_meetings,
    of_slots,
    CASE
      WHEN of_slots IS NULL THEN NULL
      ELSE GREATEST(of_slots - confirmed_meetings, 0)
    END AS open_slots
  FROM (
    SELECT
      ev.*,
      -- Soonest not-yet-occurred day: a confirmed meeting day when the event
      -- has meetings, else whichever end of the fallback window is still ahead.
      COALESCE(
        ev.meeting_soonest_day,
        CASE
          WHEN ev.start_day >= (SELECT d FROM today) THEN ev.start_day
          WHEN ev.end_day   >= (SELECT d FROM today) THEN ev.end_day
        END
      ) AS soonest_upcoming_day
    FROM ev
    WHERE ev.start_day IS NOT NULL              -- drop undated events
      AND ev.end_day >= (SELECT d FROM today)   -- current/upcoming only
  ) x
  ORDER BY
    client_account_id,
    COALESCE(soonest_upcoming_day, start_day) ASC,
    start_day ASC,
    event_id ASC
),
-- Open feedback REPORTS in the pipeline (in_progress + pending_review).
fb_reports AS (
  SELECT p.client_account_id, COUNT(*)::int AS open_reports
  FROM public.v_feedback_pipeline p
  WHERE p.client_account_id IS NOT NULL
  GROUP BY p.client_account_id
),
-- Open feedback COLLECTIONS (concluded meetings still needing feedback).
fb_collect AS (
  SELECT o.client_account_id, COUNT(*)::int AS open_collections
  FROM public.v_feedback_outstanding o
  WHERE o.client_account_id IS NOT NULL
  GROUP BY o.client_account_id
)
SELECT
  a.account_id,
  a.ticker_symbol,
  a.name                                       AS client_name,

  COALESCE(mg.meetings_ytd, 0)                 AS meetings_ytd,
  COALESCE(mg.meetings_l12m, 0)                AS meetings_l12m,

  tp.last_touch_date,
  ((SELECT d FROM today) - tp.last_touch_date)::int        AS last_touch_days,

  up.last_data_upload_date,
  ((SELECT d FROM today) - up.last_data_upload_date)::int  AS last_data_upload_days,

  ne.event_id                                  AS next_event_id,
  ne.event_name                                AS next_event_name,
  ne.event_state_label                         AS next_event_state_label,
  ne.start_day                                 AS next_event_start,
  ne.end_day                                   AS next_event_end,
  COALESCE(ne.confirmed_meetings, 0)           AS next_event_confirmed_meetings,
  ne.of_slots                                  AS next_event_total_slots,
  ne.open_slots                                AS next_event_open_slots,

  COALESCE(fr.open_reports, 0)                 AS open_reports,
  COALESCE(fc.open_collections, 0)             AS open_collections,

  n.note,
  n.updated_at                                 AS note_updated_at,

  -- LAST in the select list on purpose, even though the page renders it beside
  -- meetings_ytd / meetings_l12m: CREATE OR REPLACE VIEW can only APPEND
  -- columns -- inserting one mid-list errors with "cannot change name of view
  -- column" -- so putting it up in the Meetings block would make this file
  -- un-replaceable without a DROP, which would take the GRANT below with it.
  -- Callers read by name (the page does select("*")), so position is free.
  COALESCE(mg.meetings_upcoming, 0)            AS meetings_upcoming
FROM public.accounts a
LEFT JOIN mtg        mg ON mg.client_account_id = a.account_id
LEFT JOIN touch      tp ON tp.client_account_id = a.account_id
LEFT JOIN upload     up ON up.client_account_id = a.account_id
LEFT JOIN next_ev    ne ON ne.client_account_id = a.account_id
LEFT JOIN fb_reports fr ON fr.client_account_id = a.account_id
LEFT JOIN fb_collect fc ON fc.client_account_id = a.account_id
LEFT JOIN public.client_todo_notes n ON n.client_account_id = a.account_id
WHERE a.state_label = 'Active'
ORDER BY a.name ASC;

GRANT SELECT ON public.v_client_todo TO service_role;

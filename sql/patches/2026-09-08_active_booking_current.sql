-- -----------------------------------------------------------------------------
-- 2026-09-08 — Active-booking events stay "Current & Upcoming"; 2-month cutoff removed
--
-- Two coordinated changes so the To-Do List and Client Detail agree on both the
-- QUALIFICATION RULE and the EVENT POOL.
--
-- 1. Qualification (v_client_todo here; the mirror-image change on Client Detail
--    is in app/client-detail/client-detail-view.tsx).
--
--      BEFORE  current/upcoming  ⇔  last confirmed meeting day >= today
--      AFTER   current/upcoming  ⇔  last confirmed meeting day >= today
--                                   OR event_state_label IN
--                                      ('Live Outreach', 'Meetings Ongoing')
--
--    Those two stages mean the team is still actively booking meetings, so the
--    event is live work even when every meeting booked SO FAR is in the past.
--    Under the old rule such an event flipped to "past" the day after its last
--    booked meeting — hiding exactly the events that needed attention. The two
--    literals are the exact stored values (verified against public.events:
--    27 'Live Outreach' + 13 'Meetings Ongoing' rows at state_label='Active').
--
--    ORDERING: a state-qualified event has a NULL soonest_upcoming_day and a
--    PAST start_day, so the old key COALESCE(soonest_upcoming_day, start_day)
--    ASC would have sorted it AHEAD of a genuinely-upcoming event — and since
--    v_client_todo shows exactly one event per client (DISTINCT ON), it would
--    have displaced it. The key is now two-tier: rows with a real
--    not-yet-occurred day first (soonest first), then state-only-qualified rows
--    (most-recently-active first), with the event_id tie-break preserved.
--    Tier-1 ordering is byte-for-byte what it was: under the old WHERE clause
--    soonest_upcoming_day could never be NULL, so the COALESCE never fired.
--
--    Undated events (no meetings AND no actual window) are still dropped — the
--    column renders a date span, so there is nothing to show for one.
--
-- 2. v_marketing_calendar loses its trailing two-month cutoff:
--
--      AND COALESCE(e.event_end_actual, e.event_start_actual)
--            >= (CURRENT_DATE - INTERVAL '2 months')
--
--    That test read the event's OFFICIAL dates and never its meetings, so an
--    event whose official window closed months ago but which still had a
--    confirmed meeting ahead of it — or was still actively booking — was
--    dropped from the view before Client Detail could classify it, while the
--    To-Do List (which never had the cutoff) still showed it. Removing it makes
--    the two pools identical. It was also the only day boundary in this path
--    evaluated in UTC (CURRENT_DATE) rather than Eastern; that goes with it.
--    The other three universe filters are unchanged.
--
-- Both statements are CREATE OR REPLACE: neither view's column list, order, or
-- types change, so dependent objects survive and no CASCADE drop is needed.
-- Safe to re-run.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_marketing_calendar AS
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
ORDER BY ticker NULLS LAST, e.event_start_actual;

GRANT SELECT ON public.v_marketing_calendar TO service_role;


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
      AND (
        -- Window still open: the last meeting day is today-or-later.
        ev.end_day >= (SELECT d FROM today)
        -- ...OR the team is still actively booking it, even though every
        -- meeting booked SO FAR is in the past. That is current work, and
        -- treating it as finished hid exactly the events needing attention.
        OR ev.event_state_label IN ('Live Outreach', 'Meetings Ongoing')
      )
  ) x
  ORDER BY
    client_account_id,
    -- Two tiers. An event with a genuinely not-yet-occurred day outranks one
    -- that qualifies only on its stage: `false` sorts before `true`, so rows
    -- with a non-null soonest_upcoming_day come first, soonest day first.
    (soonest_upcoming_day IS NULL) ASC,
    soonest_upcoming_day ASC,
    -- Tier 2 only — the CASE is NULL, and therefore a no-op tie, for every
    -- tier-1 row: state-qualified events, most-recently-active first.
    CASE WHEN soonest_upcoming_day IS NULL THEN end_day END DESC,
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

-- =============================================================================
-- 20_client_todo.sql
--
-- Clients → To-Do List (/clients/to-do).
--
-- Two objects:
--   1. public.client_todo_notes — Rose-owned free-text note per client. NEVER
--      written back to Dynamics; the sync job never touches it.
--   2. public.v_client_todo     — one row per ACTIVE client assembling every
--      column the page shows, including the note.
--
-- Run in the Supabase SQL editor. Idempotent (CREATE TABLE IF NOT EXISTS +
-- CREATE OR REPLACE VIEW); safe to re-run.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- client_todo_notes
-- One free-form note per client, edited inline on the To-Do List and saved on
-- blur. Last write wins (the row is upserted on the PK), so the latest note
-- persists. No attribution is stored — deliberately, for now.
--
-- Follows the Rose-owned-table convention in 02_rose_owned_tables.sql: FK to
-- public.accounts, `updated_at` maintained by the shared touch_updated_at()
-- trigger.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_todo_notes (
  client_account_id uuid PRIMARY KEY REFERENCES public.accounts(account_id),
  note              text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- touch_updated_at() is defined in 02_rose_owned_tables.sql. Repeated here so
-- this file can be run standalone against a database that already has it.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS client_todo_notes_touch_updated_at ON public.client_todo_notes;
CREATE TRIGGER client_todo_notes_touch_updated_at
  BEFORE UPDATE ON public.client_todo_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_todo_notes TO service_role;


-- -----------------------------------------------------------------------------
-- v_client_todo
-- One row per ACTIVE client (accounts.state_label = 'Active' — the SAME
-- active-client definition v_client_portfolio uses).
--
-- Column notes (each is documented in content/docs/10-to-do-list.md):
--
--   meetings_ytd / meetings_l12m
--     public.meetings with meeting_status_label = 'Confirmed', bucketed on the
--     EASTERN meeting day. YTD = Jan 1 of the current year through today;
--     L12M = the trailing 12 months through today. Both stop at today, so a
--     future-dated confirmed meeting is never counted as already held.
--
--   last_touch_date
--     Latest public.touchpoints row for the client. `touchpoints` is the mirror
--     of the Dynamics activity Rose relabelled "Touchpoint" (the phonecall
--     entity) — the WHOLE entity is the touchpoint, so no type filter applies;
--     touchpoint_type_label is only the modality (Virtual / Email / In-Person /
--     Social / Onboarding Call). Dated on scheduled_start (Eastern day) and
--     capped at today so a future-scheduled touchpoint is not reported as a
--     touch that already happened.
--
--   last_data_upload_date
--     Latest COMPLETED Outreach task of subtype 'Data Upload'
--     (tasks.bcs_task_type_label = 'Outreach' AND
--      tasks.bcs_task_subtype_label = 'Data Upload' AND state_label =
--      'Completed'), linked to the client via tasks.bcs_account_id. Dated on
--     actual_end (when the upload was completed), falling back to
--     scheduled_end / scheduled_start. Open (not-yet-done) upload tasks are
--     excluded — they are not an upload that happened.
--
--   next_event_* / open slots
--     The SOONEST current-or-upcoming marketing event, bucketed EXACTLY as the
--     Client Detail "Marketing Events & Dates" block does: an event's window is
--     the min..max EASTERN day of its CONFIRMED meetings, falling back to its
--     own event_start_actual..event_end_actual when it has no confirmed
--     meetings. The event is current/upcoming while that window's END is
--     today-or-later — i.e. it is not complete until its last meeting ends.
--     Undated events (no meetings and no actual window) are dropped. Ordering
--     is by the soonest not-yet-occurred day, then the window start.
--     Same event universe as v_marketing_calendar (state_label = 'Active',
--     event_state_label present and not 'Pause') MINUS that view's trailing
--     two-month cutoff, which is irrelevant here (we only want windows that end
--     today-or-later) and would otherwise hide a long-dormant event that still
--     has a meeting ahead of it.
--
--     next_event_total_slots is events.of_slots (Dynamics bcs_ofslots) — the
--     event's slot capacity. open_slots = of_slots - confirmed meetings,
--     floored at 0, and NULL (unknown, not zero) when the event has no
--     of_slots. Confirmed meetings are counted from public.meetings, NOT from
--     the events.confirmed_meetings Dynamics rollup, which lags (it was stale
--     on 8 of 200 sampled active events).
--
--   open_reports / open_collections
--     open_reports     = this client's rows in v_feedback_pipeline (both
--                        categories: in_progress + pending_review).
--     open_collections = this client's rows in v_feedback_outstanding.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_client_todo AS
WITH today AS (
  SELECT (now() AT TIME ZONE 'America/New_York')::date AS d
),
-- Confirmed-meeting counts per client, YTD and trailing 12 months.
mtg AS (
  SELECT
    m.client_account_id,
    COUNT(*) FILTER (
      WHERE (m.meeting_date AT TIME ZONE 'America/New_York')::date
              >= date_trunc('year', (SELECT d FROM today))::date
        AND (m.meeting_date AT TIME ZONE 'America/New_York')::date
              <= (SELECT d FROM today)
    )::int AS meetings_ytd,
    COUNT(*) FILTER (
      WHERE (m.meeting_date AT TIME ZONE 'America/New_York')::date
              >  (SELECT d FROM today) - INTERVAL '12 months'
        AND (m.meeting_date AT TIME ZONE 'America/New_York')::date
              <= (SELECT d FROM today)
    )::int AS meetings_l12m
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
  n.updated_at                                 AS note_updated_at
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

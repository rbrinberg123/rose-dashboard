-- =============================================================================
-- 2026-08-20 — v_client_onboarding: step dates, Data-Upload-backed Meeting
--              History, Contract Start Date, Onboarding Notes
-- =============================================================================
-- RUN THIS AGAINST SUPABASE. Nothing here takes effect until it is executed.
--
-- Why this patch exists: sql/03_views.sql already described the step-date and
-- Meeting-History-from-Data-Upload behaviour, but the LIVE view had never been
-- rebuilt from it. Live was still the older shape -- it exposed
-- f_meeting_history_received and had no onboarding_call_date / teach_in_date /
-- meeting_history_date columns at all -- while the page code had already moved
-- on. The UI therefore read undefined for every date and for f_meeting_history,
-- so Meeting History always rendered as missing and no dates ever printed.
-- Running this file reconciles live with the repo AND adds the two new columns.
--
-- What changes versus the live view as of 2026-08-20:
--   1. ADDS onboarding_call_date and teach_in_date (Eastern calendar days) so
--      the grid can print the date under those two checkmarks.
--   2. REPLACES f_meeting_history_received with f_meeting_history, now derived
--      from the client latest COMPLETED Outreach -> Data Upload task, and ADDS
--      meeting_history_date for the date line under that checkmark.
--      accounts.meeting_history_received still syncs; it just no longer feeds
--      this step (it was false on every client on the page).
--   3. ADDS contract_start_date -- the CONTRACT TERM start from
--      public.contracts (Dynamics bcs_contractstartdate). This is deliberately
--      NOT accounts.original_start_date (bcs_originalstartdate), which is the
--      onboarding anchor already exposed as onboarding_start_date and which
--      runs about a day earlier on current data.
--   4. ADDS onboarding_notes -- the free-text Dynamics field bcs_onboardingnotes,
--      already synced onto public.accounts by mapAccount in lib/sync/mappers.ts.
--      Blank strings are normalised to NULL so the page can show one muted state
--      for "no note" without having to test for whitespace.
--
-- The yes/no steps are unchanged and keep their existing CRM wiring:
--   Calendar Confirmed -> accounts.calendar_confirmed (bcs_calendarconfirmed)
--   Recurring Call Scheduled -> accounts.recurring_call_scheduled
--                               (bcs_recurringcallscheduled)
--   Peers -> accounts.bda_peers (bcs_bdapeers).  NB accounts.peers is a
--            different, free-text field (bcs_peers) and is NOT this step.
--   Internal Distro Created -> accounts.distro (bcs_distro)
--
-- filled_count stays at 9 steps: the two new columns are informational, not
-- steps, so they do not move the progress ring.
--
-- Safe to re-run. Nothing else in the schema selects from this view (checked
-- 2026-08-20), so the CASCADE drops only the view itself.
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

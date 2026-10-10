-- =============================================================================
-- Patch: expose feedback_status_label on v_admin_meetings_all
-- Date:  2026-10-10
--
-- WHY
--   The CRM Meetings table (app/meetings) shows ONE feedback column by default:
--   Feedback Status (meetings.feedback_status_label, Dynamics bcs_feedbackstatus)
--   -- the authoritative feedback-state field that closes meeting feedback
--   (v_feedback_outstanding, Feedback Collection, Planning, Productivity and
--   Capacity all read it). Its values are "Closed - All in", "Closed - No
--   Feedback" and "Awaiting Additional".
--
--   The two feedback columns the table showed before -- FB in BDA
--   (feedback_bda_label) and FB Rec'd (fb_received) -- are informational only;
--   BDA is no longer used. They stay on the view and in the Columns menu.
--
--   v_admin_meetings_all never selected feedback_status_label, so the table
--   could not show it. Until this patch runs, the page simply leaves the
--   column out (lib/meetings/columns.ts DEFAULT_COLUMNS + availableColumns).
--
-- VIEW
--   Restated VERBATIM from sql/patches/2026-09-23e_meetings_flatten_full_fields.sql
--   (PART C) -- the latest definition -- with ONE change: feedback_status_label
--   appended LAST. CREATE OR REPLACE VIEW may only append columns, so nothing
--   above it may move. No table or data changes.
--
-- AFTER RUNNING
--   Production caches the view's column list per process; the column appears
--   after the next deploy / restart. In `next dev` it appears on reload.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_admin_meetings_all AS
SELECT
  m.meeting_id,

  m.meeting_type_label,
  m.meeting_status_label,
  m.meeting_date,

  m.client_account_name,
  e.name                                        AS event_name,
  m.institution_name,
  m.investor_text                               AS investor_name,

  NULLIF(concat_ws(', ',
    NULLIF(m.host_name, ''),
    NULLIF(m.host2_name, '')
  ), '')                                        AS host_names,

  NULLIF(btrim(m.feedback_name), '')            AS feedback_name,

  m.booker_name,
  NULLIF(btrim(m.on_behalf_of_name), '')        AS on_behalf_of,

  m.calendar_label,
  m.feedback_bda_label,

  to_char(m.fb_received_date, 'FMMM/FMDD/YYYY') AS fb_received,

  m.state_label,
  m.client_account_id,
  m.event_id,
  a.ticker_symbol                               AS client_ticker,

  NULLIF(btrim(m.city_name), '')                AS city_name,
  NULLIF(btrim(m.state_region_name), '')        AS state_region_name,
  m.group_meeting,
  m.hosted_in_hq,
  m.general_notes,
  m.client_booked,
  m.host_notes_label,
  m.profile_label,
  m.feedback_notes,
  m.sent,
  m.confirm,
  m.driver,
  m.food_order,
  m.logistics_notes,
  m.created_by_name,
  m.created_on,
  m.modified_by_name,
  m.modified_on,

  m.host_id,

  m.created_by_id,
  m.modified_by_id,

  -- NEW (2026-10-10): the authoritative feedback-state field. LAST on purpose.
  m.feedback_status_label
FROM public.meetings m
LEFT JOIN public.events e ON e.event_id = m.event_id
LEFT JOIN public.accounts a ON a.account_id = m.client_account_id;

GRANT SELECT ON public.v_admin_meetings_all TO service_role;


-- ---- CHECK IT (run by hand after the patch) ---------------------------------
-- 1. The view now has 41 columns, the last being feedback_status_label.
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'v_admin_meetings_all'
-- ORDER BY ordinal_position DESC LIMIT 1;
--
-- 2. Value spread -- expect the three Closed / Awaiting labels plus NULLs.
--
-- SELECT feedback_status_label, count(*) FROM public.v_admin_meetings_all
-- GROUP BY 1 ORDER BY 2 DESC;

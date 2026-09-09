-- =============================================================================
-- Patch: Admin -> Meetings -- v_admin_meetings_all
-- Date: 2026-09-09
--
-- Creates the view behind the new super-user-only /meetings page: EVERY meeting
-- in the CRM mirror, with no scoping, no status filter and no date floor.
--
-- SECURITY -- READ BEFORE REUSING
--   This view is intentionally unscoped. It returns every client's meetings, and
--   the page that reads it does NOT call resolveMeetingScope. Access is gated at
--   the route instead:
--     * lib/access-control.ts ADMIN_ONLY_ROUTES makes /meetings super-user-only
--       and NOT grantable through the Admin -> Roles matrix, and
--     * app/meetings/page.tsx re-checks the effective role server-side BEFORE
--       fetching any rows.
--   Do not reference this view from any row-scoped page.
--
-- INCLUDES ALL RECORDS, including state_label = 'Inactive' (deactivated) and
-- every meeting_status_label. state_label is exposed as a column so that default
-- is easy to see and easy to reverse.
--
-- FOUR COLUMNS COME FROM _raw, not from a flattened column. Two of those use key
-- names that have NOT been confirmed against live data (on_behalf_of and
-- fb_received, plus the second host in host_names). A missing jsonb key yields
-- NULL rather than an error, so if a guess is wrong the column simply renders
-- empty -- the view is safe to deploy either way.
--
--   Run this to settle them, then correct the COALESCE lists above if needed:
--
--     SELECT jsonb_object_keys(_raw) AS k
--     FROM public.meetings
--     WHERE _raw IS NOT NULL
--     ORDER BY 1;
--
--   Look for the real logical names of "On Behalf Of", "FB Rec'd" and any second
--   host lookup, then update both this patch and sql/03_views.sql.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_admin_meetings_all AS
SELECT
  m.meeting_id,

  -- 1-3: type, status, date (stored UTC; the page renders it Eastern)
  m.meeting_type_label,
  m.meeting_status_label,
  m.meeting_date,

  -- 4-7: who/what
  m.client_account_name,
  e.name                                        AS event_name,
  m.institution_name,
  m.investor_text                               AS investor_name,

  -- 8: host(s). One meeting can carry more than one; both are shown.
  NULLIF(concat_ws(', ',
    NULLIF(m.host_name, ''),
    NULLIF(m._raw->>'_bcs_host2_value@OData.Community.Display.V1.FormattedValue', '')
  ), '')                                        AS host_names,

  -- 9: feedback assignee (bcs_feedback) -- _raw only, same expression as
  -- v_feedback_outstanding.
  NULLIF(m._raw->>'_bcs_feedback_value@OData.Community.Display.V1.FormattedValue', '')
                                                AS feedback_name,

  -- 10-11: the two booking people
  m.booker_name,
  COALESCE(
    NULLIF(m._raw->>'_bcs_onbehalfof_value@OData.Community.Display.V1.FormattedValue', ''),
    NULLIF(m._raw->>'_createdonbehalfby_value@OData.Community.Display.V1.FormattedValue', '')
  )                                             AS on_behalf_of,

  -- 12-13: workflow choice fields (both flattened)
  m.calendar_label,
  m.feedback_bda_label,

  -- 14: FB Rec'd -- flag or date depending on how Dynamics models it. Rendered
  -- as text so either shape displays without the view having to commit.
  COALESCE(
    NULLIF(m._raw->>'bcs_feedbackreceived@OData.Community.Display.V1.FormattedValue', ''),
    NULLIF(m._raw->>'bcs_feedbackreceiveddate@OData.Community.Display.V1.FormattedValue', ''),
    NULLIF(m._raw->>'crdfa_feedbackreceiveddate@OData.Community.Display.V1.FormattedValue', '')
  )                                             AS fb_received,

  -- Not rendered as one of the 14 CRM columns, but carried for the row link,
  -- the Excel export and any future filtering.
  m.state_label,
  m.client_account_id,
  m.event_id
FROM public.meetings m
LEFT JOIN public.events e ON e.event_id = m.event_id;

GRANT SELECT ON public.v_admin_meetings_all TO service_role;

-- =============================================================================
-- Patch: Admin -> Meetings -- expand v_admin_meetings_all for the saved-view
--        column catalog
-- Date: 2026-09-09
--
-- WHY
--   The Meetings table's new "Edit columns" panel offers the SAME field list the
--   record drawer shows (MEETING_SECTIONS in dashboard/lib/meeting-record.ts).
--   The drawer loads those per row on demand; the table needs them in bulk, so
--   this patch surfaces the missing 18 on the view.
--
--   Before this patch, "Edit columns" can only offer the 14 original CRM
--   columns plus Ticker -- the rest of the catalog is marked unavailable in the
--   panel rather than erroring. After it, the whole catalog is selectable.
--
-- COST
--   general_notes / feedback_notes / host_notes_label / logistics_notes are long
--   text. Nothing regressed by adding them: the page does NOT do SELECT * any
--   more -- dashboard/lib/meetings/query.ts selects only the ACTIVE VIEW's
--   columns -- so a view that does not ask for notes does not pay for them.
--
-- SUPERSEDES 2026-09-09_admin_meetings_ticker.sql
--   This patch includes client_ticker in the same position, so it is safe to run
--   whether or not the ticker patch was applied. If you have not run that one,
--   run this instead of it -- you do not need both.
--
-- POSITION -- WHY THIS IS STILL A SAFE CREATE OR REPLACE
--   CREATE OR REPLACE VIEW matches columns POSITIONALLY and may only APPEND. All
--   18 new columns therefore go at the END, after client_ticker, rather than
--   beside the fields they relate to. sql/03_views.sql carries the same order for
--   the same reason -- keep the two in step.
--
-- SAFE TO RE-RUN. Read-only for callers: nothing but added columns.
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
  m.event_id,

  -- Client ticker: the table's Client column shows the SYMBOL, full name on
  -- hover, so the column fits ~92px instead of ~200px.
  a.ticker_symbol                               AS client_ticker,

  -- ---------------------------------------------------------------------------
  -- SAVED-VIEW COLUMN CATALOG (new in this patch)
  -- Same order as MEETING_SECTIONS in dashboard/lib/meeting-record.ts.
  -- ---------------------------------------------------------------------------

  -- Overview. Only the ids are flattened (city_id / state_region_id), so the
  -- readable names come from the lookups' formatted values in _raw.
  NULLIF(m._raw->>'_bcs_city_value@OData.Community.Display.V1.FormattedValue', '')
                                                AS city_name,
  NULLIF(m._raw->>'_bcs_stateregion_value@OData.Community.Display.V1.FormattedValue', '')
                                                AS state_region_name,
  m.group_meeting,
  m.hosted_in_hq,
  m.general_notes,

  -- Representatives
  m.client_booked,
  m.host_notes_label,

  -- Planning
  m.profile_label,

  -- Feedback
  m.feedback_notes,

  -- Logistics -- Live meetings only, so null on virtual rows.
  m.sent,
  m.confirm,
  m.driver,
  m.food_order,
  m.logistics_notes,

  -- System. created_by / modified_by are not flattened columns on
  -- public.meetings, so both come from _raw -- the drawer's expressions.
  NULLIF(m._raw->>'_createdby_value@OData.Community.Display.V1.FormattedValue', '')
                                                AS created_by_name,
  m.created_on,
  NULLIF(m._raw->>'_modifiedby_value@OData.Community.Display.V1.FormattedValue', '')
                                                AS modified_by_name,
  m.modified_on
FROM public.meetings m
LEFT JOIN public.events e ON e.event_id = m.event_id
LEFT JOIN public.accounts a ON a.account_id = m.client_account_id;

-- Confirm the new columns landed:
--   SELECT column_name, ordinal_position
--   FROM information_schema.columns
--   WHERE table_name = 'v_admin_meetings_all'
--   ORDER BY ordinal_position;

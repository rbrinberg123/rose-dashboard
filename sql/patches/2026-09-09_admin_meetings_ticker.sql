-- =============================================================================
-- Patch: Admin -> Meetings -- add client_ticker to v_admin_meetings_all
-- Date: 2026-09-09
--
-- WHY
--   The /meetings table's Client column now shows the client's TICKER SYMBOL
--   instead of the full account name, so the column shrinks from ~200px to
--   ~92px. The full name is still carried (client_account_name) and is what the
--   hover tooltip and the Excel export use -- the symbol is screen-only.
--
--   The view had no ticker at all, hence this patch. Until it is run, the page
--   degrades gracefully: with client_ticker absent/NULL the Client cell falls
--   back to the (truncated) account name, still linked, still hovering the full
--   name. Nothing breaks; the column just is not as tight as it will be after.
--
-- WHERE THE TICKER COMES FROM
--   public.accounts.ticker_symbol, joined on account_id -- the same source and
--   the same "AS client_ticker" alias that v_planning_events, v_client_todo and
--   the Portfolio views already use, so a ticker reads the same everywhere.
--
-- POSITION -- THE REASON THIS IS A SAFE CREATE OR REPLACE
--   CREATE OR REPLACE VIEW matches columns POSITIONALLY: it may APPEND columns
--   at the end, but may not rename, drop or reorder existing ones. client_ticker
--   is therefore appended LAST, after event_id, rather than being slotted in
--   beside client_account_name where it would read more naturally. That is what
--   lets this run without DROP ... CASCADE. sql/03_views.sql carries the same
--   ordering for the same reason -- keep the two in step.
--
-- SAFE TO RE-RUN. Read-only for callers: nothing but an added column.
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

  -- NEW in this patch. Appended last -- see the POSITION note in the header.
  a.ticker_symbol                               AS client_ticker
FROM public.meetings m
LEFT JOIN public.events e ON e.event_id = m.event_id
LEFT JOIN public.accounts a ON a.account_id = m.client_account_id;

-- Sanity check: how many rows actually resolve a ticker?
--   SELECT count(*) FILTER (WHERE client_ticker IS NOT NULL) AS with_ticker,
--          count(*)                                          AS total
--   FROM public.v_admin_meetings_all;

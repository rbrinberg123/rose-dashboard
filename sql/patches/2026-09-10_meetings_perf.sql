-- =============================================================================
-- Patch: Meetings -- performance. Indexable Host and Feedback filters.
-- Date: 2026-09-10
--
-- SUPERSEDES sql/patches/2026-09-10_admin_meetings_filter_options.sql.
-- Run this INSTEAD of (or after) that one -- it recreates the same options view
-- with a cheaper definition and a different `value` for hosts. Running both in
-- either order is fine; this file wins.
--
-- WHAT AND WHY
--   Measured on live data before this patch: the Client filter cost 115 ms (it
--   sits on an indexed column), while Host cost 992 ms and Feedback 415 ms --
--   both because they filtered on expressions the planner cannot index.
--
--   1. feedback_name stops being a _raw extraction.
--      public.meetings.feedback_name has been a real flattened column for a
--      while; the view was still digging the same value out of the jsonb blob
--      because the column did not exist when the view was first written.
--      Verified identical across 600 live rows (0 differ, same 44 nulls), so
--      this is a swap, not a behaviour change -- and it makes the column
--      indexable.
--
--   2. host_id is exposed so the Host filter can use idx_meetings_host.
--      The filter used to match a NAME inside host_names, which is
--      concat_ws(host_name, _raw->>host2) -- an expression, so no index applies.
--      host_id is a real indexed column and is 1:1 with host_name on live data
--      (12,966 rows have both, 0 have one without the other).
--
--      *** THE ALIAS TRAP ***  There are 28 distinct host_ids but only 26
--      distinct host names: Brian Smith and Blair Mutschler each have TWO
--      Dynamics systemuser records. Filtering on a single host_id would
--      silently return half of either person's meetings. So the options list
--      below emits the CANONICAL id (public.canonical_user_id) and the app
--      expands it back to every id in that alias group, filtering with
--      `host_id IN (...)`. That is still a plain indexed lookup.
--
--      KNOWN LIMIT: a meeting's SECOND host lives only in _raw and has no
--      flattened column, so it is not covered by a host_id filter. That affects
--      0 rows today (no live meeting has a second host). If co-hosting starts
--      happening, flatten bcs_host2 into a real column and add it to the IN
--      list -- do not go back to matching strings.
--
--   3. The options view reads public.meetings directly instead of
--      v_admin_meetings_all, so it no longer pays for the joins and the jsonb
--      extractions it never used.
--
-- SAFE TO RE-RUN.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Indexes for the two filters.
-- ---------------------------------------------------------------------------

-- Feedback filter: equality on the flattened name.
CREATE INDEX IF NOT EXISTS idx_meetings_feedback_name
  ON public.meetings (feedback_name);

-- Host filter uses idx_meetings_host (host_id, meeting_date DESC), which already
-- exists -- an IN over host_id is a plain index scan on its leading column.

-- ---------------------------------------------------------------------------
-- 2. v_admin_meetings_all
--    - feedback_name now reads the flattened column
--    - host_id appended (LAST -- CREATE OR REPLACE may only append)
-- ---------------------------------------------------------------------------

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

  -- 8: host(s). One meeting can carry more than one; both are shown. Display
  -- only -- the Host FILTER goes through host_id (appended at the end).
  NULLIF(concat_ws(', ',
    NULLIF(m.host_name, ''),
    NULLIF(m._raw->>'_bcs_host2_value@OData.Community.Display.V1.FormattedValue', '')
  ), '')                                        AS host_names,

  -- 9: feedback assignee. WAS a _raw extraction; now the flattened column, which
  -- is identical in content and can be indexed (idx_meetings_feedback_name).
  NULLIF(btrim(m.feedback_name), '')            AS feedback_name,

  -- 10-11: the two booking people
  m.booker_name,
  COALESCE(
    NULLIF(m._raw->>'_bcs_onbehalfof_value@OData.Community.Display.V1.FormattedValue', ''),
    NULLIF(m._raw->>'_createdonbehalfby_value@OData.Community.Display.V1.FormattedValue', '')
  )                                             AS on_behalf_of,

  -- 12-13: workflow choice fields (both flattened)
  m.calendar_label,
  m.feedback_bda_label,

  -- 14: FB Rec'd -- flag or date depending on how Dynamics models it.
  COALESCE(
    NULLIF(m._raw->>'bcs_feedbackreceived@OData.Community.Display.V1.FormattedValue', ''),
    NULLIF(m._raw->>'bcs_feedbackreceiveddate@OData.Community.Display.V1.FormattedValue', ''),
    NULLIF(m._raw->>'crdfa_feedbackreceiveddate@OData.Community.Display.V1.FormattedValue', '')
  )                                             AS fb_received,

  -- Carried for the row link, the Excel export and filtering.
  m.state_label,
  m.client_account_id,
  m.event_id,
  a.ticker_symbol                               AS client_ticker,

  -- Saved-view column catalog.
  NULLIF(m._raw->>'_bcs_city_value@OData.Community.Display.V1.FormattedValue', '')
                                                AS city_name,
  NULLIF(m._raw->>'_bcs_stateregion_value@OData.Community.Display.V1.FormattedValue', '')
                                                AS state_region_name,
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
  NULLIF(m._raw->>'_createdby_value@OData.Community.Display.V1.FormattedValue', '')
                                                AS created_by_name,
  m.created_on,
  NULLIF(m._raw->>'_modifiedby_value@OData.Community.Display.V1.FormattedValue', '')
                                                AS modified_by_name,
  m.modified_on,

  -- NEW in this patch, appended last. The Host filter's indexed target; never
  -- rendered as a column.
  m.host_id
FROM public.meetings m
LEFT JOIN public.events e ON e.event_id = m.event_id
LEFT JOIN public.accounts a ON a.account_id = m.client_account_id;

-- ---------------------------------------------------------------------------
-- 3. v_admin_meetings_filter_options
--    Reads public.meetings directly (cheaper), and hosts are keyed by CANONICAL
--    user id so a person with duplicate systemuser records is ONE option.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_admin_meetings_filter_options AS
  -- Clients, keyed by account id (two accounts could share a display name).
  SELECT
    'client'::text                             AS kind,
    m.client_account_id::text                  AS value,
    min(m.client_account_name)                 AS label,
    count(*)::bigint                           AS meeting_count
  FROM public.meetings m
  WHERE m.client_account_id IS NOT NULL
    AND NULLIF(btrim(m.client_account_name), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  -- Hosts, keyed by CANONICAL user id -- see THE ALIAS TRAP in the header. Both
  -- of a duplicated person's systemuser records collapse into one option, and
  -- the count is the sum across them.
  SELECT
    'host'::text                               AS kind,
    public.canonical_user_id(m.host_id)::text  AS value,
    min(m.host_name)                           AS label,
    count(*)::bigint                           AS meeting_count
  FROM public.meetings m
  WHERE m.host_id IS NOT NULL
    AND NULLIF(btrim(m.host_name), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  -- Feedback assignees, keyed by name. The name is what the view exposes and
  -- what the filter matches; a duplicated person shares one name, so aliases
  -- already collapse here without any extra work.
  SELECT
    'feedback'::text                           AS kind,
    btrim(m.feedback_name)                     AS value,
    btrim(m.feedback_name)                     AS label,
    count(*)::bigint                           AS meeting_count
  FROM public.meetings m
  WHERE NULLIF(btrim(m.feedback_name), '') IS NOT NULL
  GROUP BY 1, 2;

GRANT SELECT ON public.v_admin_meetings_filter_options TO service_role;

-- Check it:
--   SELECT kind, count(*) AS options FROM public.v_admin_meetings_filter_options
--   GROUP BY 1 ORDER BY 1;              -- expect client 189, host 26, feedback 26
--
--   EXPLAIN ANALYZE SELECT count(*) FROM public.meetings
--   WHERE feedback_name = 'CRM Administration';   -- expect an index scan

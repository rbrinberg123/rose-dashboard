-- =============================================================================
-- Patch: Admin -> Meetings -- distinct options for the Client / Host / Feedback
--        filter dropdowns
-- Date: 2026-09-10
--
-- WHY
--   The Meetings toolbar has three quick filters. Each needs its list of choices
--   -- 189 clients, 26 hosts, 26 feedback reps against live data -- and the one
--   thing it must NOT do is pull all ~13.6k rows down to work them out. PostgREST
--   has no DISTINCT, so the distinct-ing happens here, in one view, and the app
--   reads a few hundred rows instead of thirteen thousand.
--
-- SHAPE
--   One row per (kind, value, label), with the meeting count so the dropdowns can
--   show "Fidelity Management (81)". Three kinds in one view rather than three
--   views, so the app makes ONE request to populate all three dropdowns.
--
--     kind      value                    label
--     client    accounts.account_id      client_account_name
--     host      the host's name          same
--     feedback  the feedback rep's name  same
--
-- HOSTS ARE UNNESTED
--   v_admin_meetings_all.host_names is a ", "-joined list (a meeting can carry a
--   second host from _raw), so a row with two hosts must contribute to BOTH
--   hosts' option rows and to both their counts. string_to_array + unnest does
--   that. Today no live row has two hosts, but the view can produce them, and an
--   option list that quietly omitted a co-host would be a silent wrong answer.
--
-- CLIENT IS KEYED BY ID, NOT NAME
--   Two accounts could share a display name. The filter matches on
--   client_account_id, so `value` is the id and `label` is the name.
--
-- OPTIONAL. Without this view the page still works: the loader falls back to a
-- three-column scan of the admin view and de-duplicates in the server process.
-- That is correct but slower, which is exactly what this view removes.
--
-- SAFE TO RE-RUN.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_admin_meetings_filter_options AS
  -- Clients, keyed by account id.
  SELECT
    'client'::text                        AS kind,
    v.client_account_id::text             AS value,
    v.client_account_name                 AS label,
    count(*)::bigint                      AS meeting_count
  FROM public.v_admin_meetings_all v
  WHERE v.client_account_id IS NOT NULL
    AND NULLIF(btrim(v.client_account_name), '') IS NOT NULL
  GROUP BY 1, 2, 3

  UNION ALL

  -- Hosts, one row per host per meeting (see HOSTS ARE UNNESTED above).
  SELECT
    'host'::text                          AS kind,
    btrim(h)                              AS value,
    btrim(h)                              AS label,
    count(*)::bigint                      AS meeting_count
  FROM public.v_admin_meetings_all v
  CROSS JOIN LATERAL unnest(string_to_array(v.host_names, ', ')) AS h
  WHERE v.host_names IS NOT NULL
    AND btrim(h) <> ''
  GROUP BY 1, 2, 3

  UNION ALL

  -- Feedback assignees. Single-valued, so no unnesting.
  SELECT
    'feedback'::text                      AS kind,
    btrim(v.feedback_name)                AS value,
    btrim(v.feedback_name)                AS label,
    count(*)::bigint                      AS meeting_count
  FROM public.v_admin_meetings_all v
  WHERE NULLIF(btrim(v.feedback_name), '') IS NOT NULL
  GROUP BY 1, 2, 3;

-- Same service-role-only posture as everything else this page reads.
GRANT SELECT ON public.v_admin_meetings_filter_options TO service_role;

-- Check it:
--   SELECT kind, count(*) AS options, sum(meeting_count) AS rows_covered
--   FROM public.v_admin_meetings_filter_options GROUP BY 1 ORDER BY 1;

-- =============================================================================
-- Patch: expose origin + is_test on v_admin_touchpoints_all
-- Date:  2026-09-23
--
-- WHY
--   Touches is the third entity the dashboard writes itself ("Add New Touch",
--   app/touchpoints/actions.ts createTouch) and the second the reconciliation
--   sweep covers. The Touches list reads v_admin_touchpoints_all, so the view
--   must carry is_test for the list's TEST badge.
--
-- WHAT
--   The view body is IDENTICAL to sql/patches/2026-09-16_flatten_raw_fields.sql
--   (verified against the live column list 2026-09-23 — 30 columns, same order),
--   with t.origin and t.is_test APPENDED LAST. NO ROW IS FILTERED, and no other
--   view is touched: test touches flow to Client Detail and the AI summary by
--   design (containment is the ZVZZT test client, not a filter).
--
-- Safe to re-run.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_admin_touchpoints_all AS
SELECT
  t.touchpoint_id,

  -- ---- identity ----
  NULLIF(btrim(t.subject), '')                        AS subject,
  NULLIF(btrim(t.description), '')                    AS description,

  -- ---- classification ----
  t.touchpoint_type_label,
  -- Multi-select, semicolon-joined ("CFO; IRO"). A ROLE, never a person.
  t.contact_type_label,
  t.state_label,
  t.status_label,
  CASE
    WHEN t.direction_code IS TRUE  THEN 'Outgoing'
    WHEN t.direction_code IS FALSE THEN 'Incoming'
    ELSE NULL
  END                                                 AS direction_label,

  -- ---- dates ----
  t.scheduled_start                                   AS touchpoint_date,
  t.scheduled_end,
  t.actual_duration_minutes                           AS duration_minutes,
  (t.scheduled_start >= (now() - interval '12 months')) AS is_recent,
  t.created_on,
  t.modified_on,

  -- ---- links ----
  t.client_account_id,
  t.client_account_name,
  a.ticker_symbol                                     AS client_ticker,
  t.regarding_id,

  -- ---- people ----
  t.created_by_id,
  t.created_by_name,
  t.modified_by_name,
  t.modified_by_id,
  -- A per-account TEAM named after the client, NOT a person.
  t.owner_id                                          AS owner_team_id,
  t.owner_name                                        AS owner_team_name,

  -- ---- raw codes (available-but-hidden; for auditing a label) ----
  t.touchpoint_type_code,
  t.contact_type_code,
  t.state_code,
  t.status_code,
  t.direction_code,
  t._synced_at,

  -- ---- NEW in this patch, appended last ----
  t.origin,
  t.is_test
FROM public.touchpoints t
LEFT JOIN public.accounts a ON a.account_id = t.client_account_id;

GRANT SELECT ON public.v_admin_touchpoints_all TO service_role;


-- ---- CHECK IT ---------------------------------------------------------------
-- Same row count as the table (1156 on 2026-09-23 before any dashboard touch);
-- every row dynamics / not test until the first dashboard touch.
--
-- SELECT origin, is_test, count(*) FROM public.v_admin_touchpoints_all GROUP BY 1, 2;
--
-- ---- PURGE TEST TOUCHES (manual equivalent of the page's button) -----------
-- DELETE FROM public.touchpoints WHERE origin = 'dashboard' AND is_test = true
-- RETURNING touchpoint_id, client_account_name, subject, scheduled_start;

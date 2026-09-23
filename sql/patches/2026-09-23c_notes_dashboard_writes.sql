-- =============================================================================
-- Patch: expose origin + is_test on v_admin_notes_all
-- Date:  2026-09-23
--
-- WHY
--   Notes is the second entity the dashboard writes itself ("Add New Note",
--   app/notes/actions.ts createNote) and the first the reconciliation sweep
--   covers. Those rows carry origin = 'dashboard' and, during testing,
--   is_test = true. The Notes list reads v_admin_notes_all, so the view must
--   carry is_test for the list's TEST badge.
--
-- WHAT
--   The view body is IDENTICAL to sql/patches/2026-09-16_flatten_raw_fields.sql
--   (verified against the live column list 2026-09-23), with cn.origin and
--   cn.is_test APPENDED LAST. NO ROW IS FILTERED: test notes appear on the
--   Notes page, and no other view is touched -- test data flows through to
--   Portfolio, Client Detail, the AI summary and Live Outreach by design
--   (containment is the ZVZZT test client, not a filter).
--
-- Safe to re-run.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_admin_notes_all AS
SELECT
  cn.note_id,

  NULLIF(btrim(cn.name), '')                          AS review_cycle,
  (cn.note_date::timestamp AT TIME ZONE 'America/New_York')
                                                      AS note_date,
  cn.note_body                                        AS note_body,
  NULLIF(btrim(cn.notes_text), '')                    AS notes_text,

  NULLIF(btrim(cn.status_text), '')                   AS status_text,
  NULLIF(btrim(cn.primary_risk_driver), '')           AS primary_risk_driver,

  NULLIF(btrim(cn.action_step), '')                   AS action_step,
  NULLIF(btrim(cn.action_owner), '')                  AS action_owner,
  (cn.action_deadline::timestamp AT TIME ZONE 'America/New_York')
                                                      AS action_deadline,

  cn.client_account_id,
  cn.client_account_name,
  a.ticker_symbol                                     AS client_ticker,

  cn.owner_id,
  cn.owner_name,
  cn.created_by_id,
  cn.created_by_name,
  cn.modified_by_name,

  (cn.note_date >= ((now() AT TIME ZONE 'America/New_York')::date - interval '12 months'))
                                                      AS is_recent,
  cn.state_label,
  cn.status_label,
  cn.created_on,
  cn.modified_on,
  cn._synced_at,

  cn.modified_by_id,

  -- ---- NEW in this patch, appended last ----
  cn.origin,
  cn.is_test
FROM public.client_notes cn
LEFT JOIN public.accounts a ON a.account_id = cn.client_account_id;

GRANT SELECT ON public.v_admin_notes_all TO service_role;


-- ---- CHECK IT ---------------------------------------------------------------
-- Same row count as the table (668 on 2026-09-23 before any dashboard note);
-- every row dynamics / not test until the first dashboard note.
--
-- SELECT origin, is_test, count(*) FROM public.v_admin_notes_all GROUP BY 1, 2;
--
-- ---- PURGE TEST NOTES (manual equivalent of the page's button) -------------
-- DELETE FROM public.client_notes WHERE origin = 'dashboard' AND is_test = true
-- RETURNING note_id, client_account_name, note_date;

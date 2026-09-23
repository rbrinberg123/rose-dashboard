-- =============================================================================
-- Patch: expose origin + is_test on v_admin_contacts_all
-- Date:  2026-09-23
--
-- WHY
--   Contacts is the first entity the dashboard writes itself ("Add New
--   Contact", app/contacts/actions.ts createContact). Those rows carry
--   origin = 'dashboard' and, during the test phase, is_test = true
--   (columns added by sql/patches/2026-09-23_origin_ownership_fence.sql).
--   The Contacts list reads v_admin_contacts_all, not the table, so the view
--   must carry is_test for the list's TEST badge.
--
-- WHAT
--   The view body is IDENTICAL to sql/patches/2026-09-16_flatten_raw_fields.sql,
--   with c.origin and c.is_test APPENDED LAST (CREATE OR REPLACE VIEW may only
--   add columns at the end). No row is filtered: test contacts stay visible on
--   the Contacts page by design.
--
-- ORDER
--   Requires the ownership-fence patch (already run). Run this BEFORE the
--   contacts-write code ships. The list degrades safely without it (the badge
--   column is skipped when the view lacks it), but the badge will not show.
--
-- Safe to re-run.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_admin_contacts_all AS
SELECT
  c.contact_id,
  NULLIF(btrim(c.full_name), '')                      AS full_name,
  NULLIF(btrim(c.first_name), '')                     AS first_name,
  NULLIF(btrim(c.last_name), '')                      AS last_name,
  NULLIF(btrim(c.job_title), '')                      AS job_title,

  c.parent_customer_id,
  NULLIF(btrim(c.parent_customer_name), '')           AS parent_customer_name,
  c.parent_customer_type,
  c.company_master_record_id,
  NULLIF(btrim(c.company_master_record_name), '')     AS company_master_record_name,

  a.account_id                                        AS client_account_id,
  a.name                                              AS client_account_name,
  a.ticker_symbol                                     AS client_ticker,

  NULLIF(btrim(c.contact_type_label), '')             AS contact_type_label,
  NULLIF(btrim(c.industry_label), '')                 AS industry_label,
  NULLIF(btrim(c.internal_assignment_label), '')      AS internal_assignment_label,
  NULLIF(btrim(c.lead_state_label), '')               AS lead_state_label,
  NULLIF(btrim(c.state_for_address_label), '')        AS state_for_address_label,
  NULLIF(btrim(c.previous_company), '')               AS previous_company,
  NULLIF(btrim(c.ticker_symbol), '')                  AS ticker_symbol,

  c.ir_only,
  c.poc,
  c.do_not_call,
  c.distribution_list,
  c.ex_employee,

  NULLIF(btrim(c.last_activity_subject), '')          AS last_activity_subject,
  NULLIF(btrim(c.last_activity_type_label), '')       AS last_activity_type_label,
  c.last_activity_time,
  (c.verified_on::timestamp AT TIME ZONE 'America/New_York')
                                                      AS verified_on,

  (c.state_code = 0)                                  AS is_active,
  c.state_code,
  c.state_label,
  c.status_code,
  c.status_label,

  c.created_on,
  c.modified_on,
  c._synced_at,

  c.email,
  c.mobile_phone,
  c.direct_phone,
  c.city,
  c.street,
  c.owner_id,
  c.owner_name,
  c.created_by_id,
  c.created_by_name,
  c.modified_by_id,
  c.modified_by_name,

  -- ---- NEW in this patch, appended last ----
  c.origin,
  c.is_test
FROM public.contacts c
LEFT JOIN LATERAL (
  SELECT CASE
           WHEN c.parent_customer_type = 'account' THEN c.parent_customer_id
         END AS account_key
) link ON true
LEFT JOIN public.accounts a ON a.account_id = link.account_key;

GRANT SELECT ON public.v_admin_contacts_all TO service_role;


-- ---- CHECK IT ---------------------------------------------------------------
-- Same row count as the table; every row dynamics / not test until the first
-- dashboard contact is created.
--
-- SELECT origin, is_test, count(*) FROM public.v_admin_contacts_all GROUP BY 1, 2;
--
-- ---- PURGE TEST CONTACTS (manual equivalent of the page's button) ----------
-- Only dashboard-authored test rows. Never touches anything from Dynamics.
--
-- DELETE FROM public.contacts WHERE origin = 'dashboard' AND is_test = true
-- RETURNING contact_id, full_name;

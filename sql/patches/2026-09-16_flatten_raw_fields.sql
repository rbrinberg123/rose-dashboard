-- =============================================================================
-- Patch: Flatten fields we already capture in _raw but never exposed.
-- Date: 2026-09-16
--
-- Three parts:
--   A. client_notes  — remove the JSON-extraction fragility from v_admin_notes_all
--   B. contacts      — contact-ability (email / phone / address) + provenance
--   C. everywhere    — the uniform created-by / modified-by audit pair
--
-- ── NO RE-SYNC IS NEEDED ───────────────────────────────────────────────────
-- Every field here is ALREADY in `_raw` on every row: the sync's fetchAll sends
-- no $select, so `_raw` is the complete Dynamics record, annotations included
-- (Prefer: odata.include-annotations="*"). So each column is ALTER TABLE + a
-- one-time backfill straight out of `_raw`. The matching mapper changes in
-- lib/sync/mappers.ts keep future syncs populating them.
--
-- ── WHY THIS MATTERS MORE THAN "A FEW NEW COLUMNS" ─────────────────────────
-- THREE admin views are currently extracting these values from `_raw` with
-- `->>` at QUERY TIME:
--   v_admin_notes_all        note_body, owner_name, created_by_*, modified_by_name
--   v_admin_touchpoints_all  modified_by_name, modified_by_id
--   v_admin_meetings_all     created_by_name, modified_by_name
-- That works, but no index can serve a `->>` expression, and it breaks silently
-- if an upstream key is renamed. After this patch all three read real columns.
-- The views keep the SAME column names, types and order, so nothing downstream
-- changes — the pages render identically off a sturdier source.
--
-- ── THE BACKFILLS DISABLE touch_synced_at ON PURPOSE ───────────────────────
-- `_synced_at` means "when the sync last wrote this row". A backfill is not a
-- sync, and letting the trigger fire would stamp every row with now() and
-- destroy the staleness signal documented in 03-data-model.md. Each UPDATE is
-- therefore wrapped in DISABLE/ENABLE TRIGGER.
--
-- Each of those blocks is its own TRANSACTION. `ALTER TABLE … DISABLE TRIGGER`
-- is transactional in Postgres, so if an UPDATE fails the DISABLE rolls back
-- with it and no table is ever left with its trigger switched off. Without the
-- explicit BEGIN/COMMIT a mid-backfill failure would leave the trigger disabled
-- and the NEXT SYNC would silently stop stamping _synced_at.
--
-- ── UUID CASTS ARE GUARDED ─────────────────────────────────────────────────
-- `(_raw ->> '_createdby_value')::uuid` throws 22P02 on any row where that key
-- holds something that is not a GUID, which would abort the whole patch. Every
-- id cast below is therefore guarded by a shape test and yields NULL instead:
--     CASE WHEN x ~* '^[0-9a-f]{8}-...$' THEN x::uuid END
-- A malformed id becomes a NULL id — the NAME still lands — rather than a
-- failed migration.
--
-- SAFE TO RE-RUN. Every ALTER is IF NOT EXISTS; every UPDATE is idempotent.
-- =============================================================================

-- The FormattedValue annotation suffix, written out in full because Postgres
-- has no way to abbreviate it inside a ->> :
--   '_createdby_value@OData.Community.Display.V1.FormattedValue'
--
-- The guarded-cast shape test used throughout:
--   ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'


-- =============================================================================
-- PART A — client_notes
-- =============================================================================

ALTER TABLE public.client_notes
  ADD COLUMN IF NOT EXISTS note_body        text,
  ADD COLUMN IF NOT EXISTS owner_name       text,
  ADD COLUMN IF NOT EXISTS created_by_id    uuid,
  ADD COLUMN IF NOT EXISTS created_by_name  text,
  ADD COLUMN IF NOT EXISTS modified_by_id   uuid,
  ADD COLUMN IF NOT EXISTS modified_by_name text;

-- owner_name is included although it was not in the original brief: it is the
-- SAME fragility (trap 3 in 2026-09-15_admin_notes.sql reads it out of _raw),
-- the table already has owner_id, and leaving it behind would mean the view
-- still could not stop touching _raw.

BEGIN;
ALTER TABLE public.client_notes DISABLE TRIGGER client_notes_touch_synced_at;

UPDATE public.client_notes SET
  -- bcs_notes keeps the author's LINE BREAKS; notes_text has them collapsed.
  -- Same COALESCE the view has been doing, now materialised once.
  note_body = COALESCE(
    NULLIF(btrim(_raw ->> 'bcs_notes'), ''),
    NULLIF(btrim(notes_text), '')
  ),
  owner_name = NULLIF(btrim(_raw ->> '_ownerid_value@OData.Community.Display.V1.FormattedValue'), ''),
  created_by_id = CASE WHEN _raw ->> '_createdby_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       THEN (_raw ->> '_createdby_value')::uuid END,
  created_by_name = NULLIF(btrim(_raw ->> '_createdby_value@OData.Community.Display.V1.FormattedValue'), ''),
  modified_by_id = CASE WHEN _raw ->> '_modifiedby_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        THEN (_raw ->> '_modifiedby_value')::uuid END,
  modified_by_name = NULLIF(btrim(_raw ->> '_modifiedby_value@OData.Community.Display.V1.FormattedValue'), '')
WHERE _raw IS NOT NULL;

ALTER TABLE public.client_notes ENABLE TRIGGER client_notes_touch_synced_at;
COMMIT;


-- =============================================================================
-- PART B — contacts
-- =============================================================================
-- The contacts mirror had NO email, phone or address columns at all: the curated
-- field set was classification-and-flags. emailaddress1 alone is populated on
-- ~77% of contacts.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email            text,
  ADD COLUMN IF NOT EXISTS mobile_phone     text,
  ADD COLUMN IF NOT EXISTS direct_phone     text,
  ADD COLUMN IF NOT EXISTS city             text,
  ADD COLUMN IF NOT EXISTS street           text,
  ADD COLUMN IF NOT EXISTS owner_id         uuid,
  ADD COLUMN IF NOT EXISTS owner_name       text,
  ADD COLUMN IF NOT EXISTS created_by_id    uuid,
  ADD COLUMN IF NOT EXISTS created_by_name  text,
  ADD COLUMN IF NOT EXISTS modified_by_id   uuid,
  ADD COLUMN IF NOT EXISTS modified_by_name text;

BEGIN;
ALTER TABLE public.contacts DISABLE TRIGGER contacts_touch_synced_at;

UPDATE public.contacts SET
  email        = NULLIF(btrim(_raw ->> 'emailaddress1'), ''),
  mobile_phone = NULLIF(btrim(_raw ->> 'mobilephone'), ''),
  direct_phone = NULLIF(btrim(_raw ->> 'telephone1'), ''),
  -- address1_* is the PRIMARY address block on contact (address2_* is barely
  -- used here, the opposite of accounts — see the coverage report).
  city         = NULLIF(btrim(_raw ->> 'address1_city'), ''),
  street       = NULLIF(btrim(_raw ->> 'address1_line1'), ''),
  owner_id         = CASE WHEN _raw ->> '_ownerid_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (_raw ->> '_ownerid_value')::uuid END,
  owner_name       = NULLIF(btrim(_raw ->> '_ownerid_value@OData.Community.Display.V1.FormattedValue'), ''),
  created_by_id    = CASE WHEN _raw ->> '_createdby_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (_raw ->> '_createdby_value')::uuid END,
  created_by_name  = NULLIF(btrim(_raw ->> '_createdby_value@OData.Community.Display.V1.FormattedValue'), ''),
  modified_by_id   = CASE WHEN _raw ->> '_modifiedby_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (_raw ->> '_modifiedby_value')::uuid END,
  modified_by_name = NULLIF(btrim(_raw ->> '_modifiedby_value@OData.Community.Display.V1.FormattedValue'), '')
WHERE _raw IS NOT NULL;

ALTER TABLE public.contacts ENABLE TRIGGER contacts_touch_synced_at;
COMMIT;

-- Email is a natural lookup key (paste an address, find the person).
CREATE INDEX IF NOT EXISTS idx_contacts_email ON public.contacts (email);
-- City becomes a filter dropdown, so it is indexed like every other dropdown
-- target on this table.
CREATE INDEX IF NOT EXISTS idx_contacts_city  ON public.contacts (city);


-- =============================================================================
-- PART C — the uniform created-by / modified-by audit pair
-- =============================================================================
-- Pairs with the dashboard's own audit_log: that records who changed something
-- HERE, this records who last changed it in DYNAMICS. Together they answer "who
-- last touched this record?" for any CRM row.

-- ---- meetings (neither half was flattened) --------------------------------
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS created_by_id    uuid,
  ADD COLUMN IF NOT EXISTS created_by_name  text,
  ADD COLUMN IF NOT EXISTS modified_by_id   uuid,
  ADD COLUMN IF NOT EXISTS modified_by_name text;

BEGIN;
ALTER TABLE public.meetings DISABLE TRIGGER meetings_touch_synced_at;
UPDATE public.meetings SET
  created_by_id    = CASE WHEN _raw ->> '_createdby_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (_raw ->> '_createdby_value')::uuid END,
  created_by_name  = NULLIF(btrim(_raw ->> '_createdby_value@OData.Community.Display.V1.FormattedValue'), ''),
  modified_by_id   = CASE WHEN _raw ->> '_modifiedby_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (_raw ->> '_modifiedby_value')::uuid END,
  modified_by_name = NULLIF(btrim(_raw ->> '_modifiedby_value@OData.Community.Display.V1.FormattedValue'), '')
WHERE _raw IS NOT NULL;
ALTER TABLE public.meetings ENABLE TRIGGER meetings_touch_synced_at;
COMMIT;

-- ---- touchpoints (created_by was already flattened; modified_by was not) ---
ALTER TABLE public.touchpoints
  ADD COLUMN IF NOT EXISTS modified_by_id   uuid,
  ADD COLUMN IF NOT EXISTS modified_by_name text;

BEGIN;
ALTER TABLE public.touchpoints DISABLE TRIGGER touchpoints_touch_synced_at;
UPDATE public.touchpoints SET
  modified_by_id   = CASE WHEN _raw ->> '_modifiedby_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (_raw ->> '_modifiedby_value')::uuid END,
  modified_by_name = NULLIF(btrim(_raw ->> '_modifiedby_value@OData.Community.Display.V1.FormattedValue'), '')
WHERE _raw IS NOT NULL;
ALTER TABLE public.touchpoints ENABLE TRIGGER touchpoints_touch_synced_at;
COMMIT;

-- ---- contracts ------------------------------------------------------------
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS created_by_id    uuid,
  ADD COLUMN IF NOT EXISTS created_by_name  text,
  ADD COLUMN IF NOT EXISTS modified_by_id   uuid,
  ADD COLUMN IF NOT EXISTS modified_by_name text;

BEGIN;
ALTER TABLE public.contracts DISABLE TRIGGER contracts_touch_synced_at;
UPDATE public.contracts SET
  created_by_id    = CASE WHEN _raw ->> '_createdby_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (_raw ->> '_createdby_value')::uuid END,
  created_by_name  = NULLIF(btrim(_raw ->> '_createdby_value@OData.Community.Display.V1.FormattedValue'), ''),
  modified_by_id   = CASE WHEN _raw ->> '_modifiedby_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (_raw ->> '_modifiedby_value')::uuid END,
  modified_by_name = NULLIF(btrim(_raw ->> '_modifiedby_value@OData.Community.Display.V1.FormattedValue'), '')
WHERE _raw IS NOT NULL;
ALTER TABLE public.contracts ENABLE TRIGGER contracts_touch_synced_at;
COMMIT;

-- ---- accounts -------------------------------------------------------------
-- Provenance ONLY. The other ~40 unflattened accounts content fields (the staff
-- initials cluster, address1_*, etc.) are deliberately left for a dedicated
-- accounts pass.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS created_by_id    uuid,
  ADD COLUMN IF NOT EXISTS created_by_name  text,
  ADD COLUMN IF NOT EXISTS modified_by_id   uuid,
  ADD COLUMN IF NOT EXISTS modified_by_name text;

BEGIN;
ALTER TABLE public.accounts DISABLE TRIGGER accounts_touch_synced_at;
UPDATE public.accounts SET
  created_by_id    = CASE WHEN _raw ->> '_createdby_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (_raw ->> '_createdby_value')::uuid END,
  created_by_name  = NULLIF(btrim(_raw ->> '_createdby_value@OData.Community.Display.V1.FormattedValue'), ''),
  modified_by_id   = CASE WHEN _raw ->> '_modifiedby_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (_raw ->> '_modifiedby_value')::uuid END,
  modified_by_name = NULLIF(btrim(_raw ->> '_modifiedby_value@OData.Community.Display.V1.FormattedValue'), '')
WHERE _raw IS NOT NULL;
ALTER TABLE public.accounts ENABLE TRIGGER accounts_touch_synced_at;
COMMIT;


-- =============================================================================
-- VIEWS — repoint at the real columns
-- =============================================================================
-- Each view keeps its EXISTING column names, types and order, so
-- CREATE OR REPLACE succeeds and nothing downstream needs to change. New
-- columns are APPENDED LAST, which is the only place CREATE OR REPLACE allows.


-- ---- v_admin_notes_all ----------------------------------------------------
-- Identical to sql/patches/2026-09-15_admin_notes.sql except that note_body,
-- owner_name, created_by_id, created_by_name and modified_by_name now read
-- COLUMNS instead of `_raw ->>`, and modified_by_id is appended.
CREATE OR REPLACE VIEW public.v_admin_notes_all AS
SELECT
  cn.note_id,

  NULLIF(btrim(cn.name), '')                          AS review_cycle,
  (cn.note_date::timestamp AT TIME ZONE 'America/New_York')
                                                      AS note_date,
  -- WAS: COALESCE(NULLIF(btrim(cn._raw ->> 'bcs_notes'),''), ...)
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

  -- WAS: all three dug out of cn._raw (trap 3).
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

  -- NEW in this patch, appended last.
  cn.modified_by_id
FROM public.client_notes cn
LEFT JOIN public.accounts a ON a.account_id = cn.client_account_id;

GRANT SELECT ON public.v_admin_notes_all TO service_role;


-- ---- v_admin_touchpoints_all ----------------------------------------------
-- Only the two modified_by expressions change; everything else is byte-for-byte
-- the shape sql/patches/2026-09-15_admin_touchpoints.sql produced.
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
  -- Constant "Outgoing" on live data; derived anyway. See the DIRECTION note.
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
  -- THE ONLY CHANGE IN THIS VIEW. Both were:
  --   NULLIF(btrim(t._raw ->> '_modifiedby_value@...FormattedValue'), '')
  --   NULLIF(t._raw ->> '_modifiedby_value', '')::uuid
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
  t._synced_at
FROM public.touchpoints t
LEFT JOIN public.accounts a ON a.account_id = t.client_account_id;

GRANT SELECT ON public.v_admin_touchpoints_all TO service_role;


-- ---- v_admin_meetings_all -------------------------------------------------
-- Body taken verbatim from sql/patches/2026-09-10_meetings_perf.sql (the latest
-- of the four patches that have touched this view). VERIFIED 2026-09-16 that it
-- reproduces the live column list exactly — all 38 names in the same order — so
-- restating it here cannot regress a drifted live definition.
--
-- The ONLY changes: created_by_name and modified_by_name now read columns
-- instead of `_raw ->>`, and created_by_id / modified_by_id are appended.
--
-- NOTE: several OTHER expressions in this view are still `_raw` extractions —
-- host_names, on_behalf_of, fb_received, city_name, state_region_name. They are
-- deliberately left alone: they are outside this patch's scope and each needs
-- its own decision (host2 is a second lookup, fb_received coalesces three
-- different possible fields). They are the obvious next candidates.
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
    NULLIF(m._raw->>'_bcs_host2_value@OData.Community.Display.V1.FormattedValue', '')
  ), '')                                        AS host_names,

  NULLIF(btrim(m.feedback_name), '')            AS feedback_name,

  m.booker_name,
  COALESCE(
    NULLIF(m._raw->>'_bcs_onbehalfof_value@OData.Community.Display.V1.FormattedValue', ''),
    NULLIF(m._raw->>'_createdonbehalfby_value@OData.Community.Display.V1.FormattedValue', '')
  )                                             AS on_behalf_of,

  m.calendar_label,
  m.feedback_bda_label,

  COALESCE(
    NULLIF(m._raw->>'bcs_feedbackreceived@OData.Community.Display.V1.FormattedValue', ''),
    NULLIF(m._raw->>'bcs_feedbackreceiveddate@OData.Community.Display.V1.FormattedValue', ''),
    NULLIF(m._raw->>'crdfa_feedbackreceiveddate@OData.Community.Display.V1.FormattedValue', '')
  )                                             AS fb_received,

  m.state_label,
  m.client_account_id,
  m.event_id,
  a.ticker_symbol                               AS client_ticker,

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
  -- WAS: NULLIF(m._raw->>'_createdby_value@...FormattedValue', '')
  m.created_by_name,
  m.created_on,
  -- WAS: NULLIF(m._raw->>'_modifiedby_value@...FormattedValue', '')
  m.modified_by_name,
  m.modified_on,

  m.host_id,

  -- NEW in this patch, appended last.
  m.created_by_id,
  m.modified_by_id
FROM public.meetings m
LEFT JOIN public.events e ON e.event_id = m.event_id
LEFT JOIN public.accounts a ON a.account_id = m.client_account_id;

GRANT SELECT ON public.v_admin_meetings_all TO service_role;


-- ---- v_admin_contacts_all -------------------------------------------------
-- The eleven new contacts columns, appended last. Everything above the append
-- block is unchanged from sql/patches/2026-09-16_admin_contacts.sql.
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

  -- ---- NEW in this patch, appended last ----
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
  c.modified_by_name
FROM public.contacts c
-- CLIENT LINK — unchanged. Confirmed correct 2026-09-16: parent_customer
-- resolves for 742 of 758 contacts; company_master_record matches 0 accounts.
LEFT JOIN LATERAL (
  SELECT CASE
           WHEN c.parent_customer_type = 'account' THEN c.parent_customer_id
         END AS account_key
) link ON true
LEFT JOIN public.accounts a ON a.account_id = link.account_key;

GRANT SELECT ON public.v_admin_contacts_all TO service_role;


-- ---- v_admin_contacts_filter_options — add the City dropdown ---------------
-- Everything above the City branch is unchanged.
CREATE OR REPLACE VIEW public.v_admin_contacts_filter_options AS
  SELECT
    'client'::text                                    AS kind,
    c.parent_customer_id::text                        AS value,
    min(btrim(c.parent_customer_name))                AS label,
    count(*)::bigint                                  AS contact_count
  FROM public.contacts c
  WHERE c.parent_customer_id IS NOT NULL
    AND NULLIF(btrim(c.parent_customer_name), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL
  SELECT 'contact_type'::text, btrim(c.contact_type_label), btrim(c.contact_type_label),
         count(*)::bigint
  FROM public.contacts c
  WHERE NULLIF(btrim(c.contact_type_label), '') IS NOT NULL GROUP BY 1, 2

  UNION ALL
  SELECT 'industry'::text, btrim(c.industry_label), btrim(c.industry_label), count(*)::bigint
  FROM public.contacts c
  WHERE NULLIF(btrim(c.industry_label), '') IS NOT NULL GROUP BY 1, 2

  UNION ALL
  SELECT 'internal_assignment'::text, btrim(c.internal_assignment_label),
         btrim(c.internal_assignment_label), count(*)::bigint
  FROM public.contacts c
  WHERE NULLIF(btrim(c.internal_assignment_label), '') IS NOT NULL GROUP BY 1, 2

  UNION ALL
  SELECT 'lead_state'::text, btrim(c.lead_state_label), btrim(c.lead_state_label),
         count(*)::bigint
  FROM public.contacts c
  WHERE NULLIF(btrim(c.lead_state_label), '') IS NOT NULL GROUP BY 1, 2

  UNION ALL
  -- NEW: the City dropdown.
  SELECT 'city'::text, btrim(c.city), btrim(c.city), count(*)::bigint
  FROM public.contacts c
  WHERE NULLIF(btrim(c.city), '') IS NOT NULL GROUP BY 1, 2

  UNION ALL
  SELECT 'state'::text, c.state_code::text,
         COALESCE(min(btrim(c.state_label)), CASE WHEN c.state_code = 0 THEN 'Active' ELSE 'Inactive' END),
         count(*)::bigint
  FROM public.contacts c WHERE c.state_code IS NOT NULL GROUP BY 1, 2, c.state_code

  UNION ALL
  SELECT 'ir_only'::text, c.ir_only::text,
         CASE WHEN c.ir_only THEN 'Yes' ELSE 'No' END, count(*)::bigint
  FROM public.contacts c WHERE c.ir_only IS NOT NULL GROUP BY 1, 2, c.ir_only

  UNION ALL
  SELECT 'poc'::text, c.poc::text,
         CASE WHEN c.poc THEN 'Yes' ELSE 'No' END, count(*)::bigint
  FROM public.contacts c WHERE c.poc IS NOT NULL GROUP BY 1, 2, c.poc

  UNION ALL
  SELECT 'do_not_call'::text, c.do_not_call::text,
         CASE WHEN c.do_not_call THEN 'Yes' ELSE 'No' END, count(*)::bigint
  FROM public.contacts c WHERE c.do_not_call IS NOT NULL GROUP BY 1, 2, c.do_not_call

  UNION ALL
  SELECT 'distribution_list'::text, c.distribution_list::text,
         CASE WHEN c.distribution_list THEN 'Yes' ELSE 'No' END, count(*)::bigint
  FROM public.contacts c WHERE c.distribution_list IS NOT NULL
  GROUP BY 1, 2, c.distribution_list;

GRANT SELECT ON public.v_admin_contacts_filter_options TO service_role;


-- =============================================================================
-- Check it
-- =============================================================================
--   -- A: every note body carried across, and the view no longer touches _raw
--   SELECT count(*) FILTER (WHERE note_body IS NOT NULL)        AS body,
--          count(*) FILTER (WHERE created_by_name IS NOT NULL)  AS created_by,
--          count(*) FILTER (WHERE modified_by_name IS NOT NULL) AS modified_by,
--          count(*) FILTER (WHERE owner_name IS NOT NULL)       AS owner,
--          count(*)                                             AS total
--   FROM public.client_notes;                       -- expect body ~650, rest = total
--
--   -- B: contact-ability
--   SELECT count(*) FILTER (WHERE email IS NOT NULL)        AS email,
--          count(*) FILTER (WHERE mobile_phone IS NOT NULL) AS mobile,
--          count(*) FILTER (WHERE direct_phone IS NOT NULL) AS direct,
--          count(*) FILTER (WHERE city IS NOT NULL)         AS city,
--          count(*)                                         AS total
--   FROM public.contacts;                           -- expect email ~77% of total
--
--   -- C: provenance everywhere
--   SELECT 'accounts' t, count(*) FILTER (WHERE modified_by_name IS NOT NULL) n, count(*) FROM public.accounts
--   UNION ALL SELECT 'meetings',    count(*) FILTER (WHERE modified_by_name IS NOT NULL), count(*) FROM public.meetings
--   UNION ALL SELECT 'touchpoints', count(*) FILTER (WHERE modified_by_name IS NOT NULL), count(*) FROM public.touchpoints
--   UNION ALL SELECT 'contracts',   count(*) FILTER (WHERE modified_by_name IS NOT NULL), count(*) FROM public.contracts
--   UNION ALL SELECT 'contacts',    count(*) FILTER (WHERE modified_by_name IS NOT NULL), count(*) FROM public.contacts;
--
--   -- No trigger was left disabled by a failed backfill:
--   SELECT tgrelid::regclass AS table_name, tgname, tgenabled
--   FROM pg_trigger WHERE tgname LIKE '%touch_synced_at' AND tgenabled <> 'O';
--   -- expect ZERO rows. 'D' means disabled — re-enable before the next sync.

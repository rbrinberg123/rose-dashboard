-- 23_contacts_table.sql
-- Mirror table for the standard Dataverse `contact` entity (entity set:
-- contacts), which Rose has heavily customized with bcs_* fields.
--
-- Conventions (see 03_data_taxonomy.md) — identical to 14_tasks_table.sql:
--   - PK is the Dynamics GUID (contactid) typed uuid, named contact_id
--   - Choice fields -> {field}_code (int) + {field}_label (text)
--   - Lookups -> {field}_id (uuid) + {field}_name (text)
--   - NO foreign keys: this is an analytics-phase mirror; referential
--     integrity is deferred to the future CRM-migration phase (see decision
--     log entry "Mirror Dynamics entities without FKs during analytics phase").
--   - parentcustomerid is polymorphic: id + name + type
--   - Full Dynamics row preserved in _raw
--
-- CLIENT LINK — deliberately UNRESOLVED at this stage.
-- Two candidates are mirrored side by side because we could not measure their
-- populate/match rates before syncing (no Dynamics credentials off-Vercel):
--   * parent_customer_*        <- _parentcustomerid_value       ("Company Name")
--   * company_master_record_*  <- _bcs_companymasterrecord_value ("Master Company Record")
-- Both are cheap to carry. The canonical one is chosen AFTER the first sync,
-- from real populate + match rates against public.accounts.account_id. Do not
-- build views or joins on either until that decision is made.
--
-- Fields deliberately NOT flattened (they stay in _raw, nothing is lost):
-- the activity-pointer lookups (last appointment / email / phone / task
-- activity), primary opportunity, segment id, the country lookup, and
-- parent_contactid.
--
-- "Mirror everything" per Decisions 09 and 12.

CREATE TABLE IF NOT EXISTS public.contacts (
  -- Primary key (Dataverse contactid)
  contact_id                    uuid PRIMARY KEY,

  -- Standard backbone
  first_name                    text,
  last_name                     text,
  full_name                     text,
  job_title                     text,

  -- CLIENT LINK candidate 1: parentcustomerid ("Company Name").
  -- Polymorphic in Dynamics — points at EITHER an account OR a contact — so
  -- the target entity type is stored alongside the GUID. Always filter on
  -- parent_customer_type when joining to accounts.
  parent_customer_id            uuid,
  parent_customer_name          text,
  parent_customer_type          text,            -- lookuplogicalname: "account" | "contact"

  -- CLIENT LINK candidate 2: bcs_CompanyMasterRecord ("Master Company Record").
  company_master_record_id      uuid,
  company_master_record_name    text,

  -- Rose custom choice fields.
  --
  -- TWO ARE MULTI-SELECT, so their code columns are text, NOT integer:
  -- Dynamics returns comma-joined codes ("755860001,755860004") whose labels
  -- are semicolon-joined ("Robert Brinberg; Brian Smith"). Modeling them as
  -- integer failed 150 contacts outright in Sept 2026 — run.ts upserts the row
  -- as a unit, so one rejected column loses the whole contact.
  -- See sql/patches/2026-09-16_contacts_multiselect_fix.sql.
  -- CHECK ANY NEW CHOICE FIELD before making it integer:
  --   SELECT count(*) FROM public.contacts WHERE _raw ->> '<field>' LIKE '%,%';
  contact_type_code             text,            -- MULTI-SELECT
  contact_type_label            text,
  industry_code                 integer,
  industry_label                text,
  internal_assignment_code      text,            -- MULTI-SELECT
  internal_assignment_label     text,
  lead_state_code               integer,         -- bcs_state ("LeadState")
  lead_state_label              text,
  state_for_address_code        integer,
  state_for_address_label       text,
  last_activity_type_code       integer,
  last_activity_type_label      text,

  -- Rose custom Yes/No fields
  distribution_list             boolean,
  do_not_call                   boolean,
  ex_employee                   boolean,
  ir_only                       boolean,
  poc                           boolean,

  -- Rose custom other-typed fields
  last_activity_subject         text,
  last_activity_time            timestamptz,
  previous_company              text,
  ticker_symbol                 text,
  verified_on                   date,

  -- Standard Dataverse system fields
  state_code                    integer,
  state_label                   text,
  status_code                   integer,
  status_label                  text,
  created_on                    timestamptz,
  modified_on                   timestamptz,

  -- Catch-all + sync bookkeeping.
  -- _synced_at MUST exist on this table: the touch_synced_at trigger below
  -- resolves NEW._synced_at at RUNTIME, so a missing column does not fail at
  -- CREATE TRIGGER time — it fails silently on every sync upsert instead.
  -- That is exactly what broke public.users for five days in Sept 2026.
  -- See 05-sync-and-integrations.md.
  _raw                          jsonb NOT NULL,
  _synced_at                    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common access patterns + the incremental watermark
CREATE INDEX IF NOT EXISTS idx_contacts_modified_on      ON public.contacts (modified_on DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_parent_customer  ON public.contacts (parent_customer_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company_master   ON public.contacts (company_master_record_id);
CREATE INDEX IF NOT EXISTS idx_contacts_state_code       ON public.contacts (state_code);
CREATE INDEX IF NOT EXISTS idx_contacts_last_name        ON public.contacts (last_name);
CREATE INDEX IF NOT EXISTS idx_contacts_ticker_symbol    ON public.contacts (ticker_symbol);

-- Sync writes via service_role (same grant pattern as every mirror table)
GRANT INSERT, UPDATE, SELECT ON public.contacts TO service_role;

-- Lock down: RLS on, zero policies => only service_role (which bypasses RLS)
-- can read/write. The anon key used by the browser gets nothing. Belt and
-- braces: `anon` is not granted SELECT either, so it is already blocked at the
-- privilege layer — but contacts is the most PII-heavy mirror table (names,
-- job titles, employers), and RLS costs nothing because the sync and every
-- dashboard read go through service_role.
--
-- NOTE: the older mirror tables (accounts, meetings, tasks, ...) do NOT have
-- RLS enabled; they rely on grants alone. This follows the newer house pattern
-- used by every Rose-owned table since sql/17_user_roles.sql instead.
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- Stamp _synced_at on every sync (see public.touch_synced_at in 01_mirror_tables.sql).
DROP TRIGGER IF EXISTS contacts_touch_synced_at ON public.contacts;
CREATE TRIGGER contacts_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

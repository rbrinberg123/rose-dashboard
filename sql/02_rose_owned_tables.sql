-- =============================================================================
-- 02_rose_owned_tables.sql
--
-- Rose-owned schema: read-write tables for admin-entered data.
-- These are NEVER touched by the sync job.
-- =============================================================================

DROP TABLE IF EXISTS public.revenue_overrides CASCADE;
DROP TABLE IF EXISTS public.overhead_overrides CASCADE;
DROP TABLE IF EXISTS public.overhead_periods CASCADE;
DROP TABLE IF EXISTS public.client_direct_costs CASCADE;
DROP TABLE IF EXISTS public.salary_schedule CASCADE;
DROP TABLE IF EXISTS public.cost_assumptions CASCADE;


-- -----------------------------------------------------------------------------
-- cost_assumptions
-- Single-row table holding the cost-model parameters.
-- Editable via admin UI; defaults seeded in 04_seed_data.sql.
-- -----------------------------------------------------------------------------
CREATE TABLE public.cost_assumptions (
  id                              int PRIMARY KEY DEFAULT 1,
  work_hours_per_year             int     NOT NULL DEFAULT 2000,
  booker_hours_per_meeting_base   numeric NOT NULL DEFAULT 0.5,
  host_hours_per_meeting_base     numeric NOT NULL DEFAULT 1.5,
  in_person_multiplier            numeric NOT NULL DEFAULT 2.0,
  default_benefits_multiplier     numeric NOT NULL DEFAULT 1.15,
  primary_manager_hours_monthly   numeric NOT NULL DEFAULT 4
    CHECK (primary_manager_hours_monthly >= 0),
  secondary_manager_hours_monthly numeric NOT NULL DEFAULT 2
    CHECK (secondary_manager_hours_monthly >= 0),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_assumptions_singleton CHECK (id = 1)
);


-- -----------------------------------------------------------------------------
-- salary_schedule
-- One row per (user, effective period). Add a new row when salary changes.
-- -----------------------------------------------------------------------------
CREATE TABLE public.salary_schedule (
  id                  bigserial PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES public.users(user_id),
  effective_from      date NOT NULL,
  effective_to        date,            -- NULL = currently active
  annual_salary       numeric NOT NULL CHECK (annual_salary >= 0),
  annual_bonus        numeric NOT NULL DEFAULT 0 CHECK (annual_bonus >= 0),
  benefits_multiplier numeric NOT NULL DEFAULT 1.15 CHECK (benefits_multiplier > 0),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT salary_schedule_period_valid
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX idx_salary_schedule_user_period
  ON public.salary_schedule (user_id, effective_from, effective_to);

-- Prevent overlapping periods for the same user.
-- Implemented as a function-based exclusion: any two rows for the same user
-- whose [effective_from, COALESCE(effective_to, '9999-12-31')] ranges overlap
-- are rejected.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE public.salary_schedule
  ADD CONSTRAINT salary_schedule_no_overlap
  EXCLUDE USING gist (
    user_id WITH =,
    daterange(effective_from, COALESCE(effective_to, DATE '9999-12-31'), '[]') WITH &&
  );


-- -----------------------------------------------------------------------------
-- client_direct_costs
-- T&E, event fees, ad-hoc client-attributable costs.
-- -----------------------------------------------------------------------------
CREATE TABLE public.client_direct_costs (
  id                  bigserial PRIMARY KEY,
  client_account_id   uuid NOT NULL REFERENCES public.accounts(account_id),
  cost_date           date NOT NULL,
  amount              numeric NOT NULL CHECK (amount >= 0),
  category            text NOT NULL CHECK (category IN (
                        'T&E', 'Event Fee', 'Sponsorship',
                        'External Research', 'Other')),
  description         text,
  created_by_user_id  uuid REFERENCES public.users(user_id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_direct_costs_client_date
  ON public.client_direct_costs (client_account_id, cost_date DESC);


-- -----------------------------------------------------------------------------
-- overhead_periods
-- Total quarterly overhead pot to allocate.
-- -----------------------------------------------------------------------------
CREATE TABLE public.overhead_periods (
  id                       bigserial PRIMARY KEY,
  period_year              int NOT NULL CHECK (period_year >= 2020),
  period_quarter           int NOT NULL CHECK (period_quarter BETWEEN 1 AND 4),
  total_overhead_amount    numeric NOT NULL CHECK (total_overhead_amount >= 0),
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT overhead_periods_unique UNIQUE (period_year, period_quarter)
);


-- -----------------------------------------------------------------------------
-- overhead_overrides
-- Direct allocations to specific clients for a quarter (advisory-only clients).
-- Exactly one of fixed_amount or percent_of_total must be set.
-- -----------------------------------------------------------------------------
CREATE TABLE public.overhead_overrides (
  id                   bigserial PRIMARY KEY,
  client_account_id    uuid NOT NULL REFERENCES public.accounts(account_id),
  period_year          int NOT NULL,
  period_quarter       int NOT NULL CHECK (period_quarter BETWEEN 1 AND 4),
  fixed_amount         numeric CHECK (fixed_amount IS NULL OR fixed_amount >= 0),
  percent_of_total     numeric CHECK (percent_of_total IS NULL OR
                                      (percent_of_total >= 0 AND percent_of_total <= 1)),
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT overhead_override_one_only
    CHECK ((fixed_amount IS NOT NULL)::int + (percent_of_total IS NOT NULL)::int = 1),
  CONSTRAINT overhead_override_unique
    UNIQUE (client_account_id, period_year, period_quarter)
);


-- -----------------------------------------------------------------------------
-- revenue_overrides
-- Optional manual adjustments to contract-derived revenue.
-- Use cases: refunds, project fees, billing accuracy fixes.
-- -----------------------------------------------------------------------------
CREATE TABLE public.revenue_overrides (
  id                   bigserial PRIMARY KEY,
  client_account_id    uuid NOT NULL REFERENCES public.accounts(account_id),
  period_year          int NOT NULL,
  period_quarter       int NOT NULL CHECK (period_quarter BETWEEN 1 AND 4),
  adjustment_amount    numeric NOT NULL,    -- can be positive or negative
  reason               text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_revenue_overrides_client_period
  ON public.revenue_overrides (client_account_id, period_year, period_quarter);


-- -----------------------------------------------------------------------------
-- updated_at triggers (keep timestamps fresh on edit)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER salary_schedule_touch_updated_at
  BEFORE UPDATE ON public.salary_schedule
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER overhead_periods_touch_updated_at
  BEFORE UPDATE ON public.overhead_periods
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER overhead_overrides_touch_updated_at
  BEFORE UPDATE ON public.overhead_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER cost_assumptions_touch_updated_at
  BEFORE UPDATE ON public.cost_assumptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- -----------------------------------------------------------------------------
-- user_id_aliases
-- Curated identity map for people who exist under MORE THAN ONE Dynamics
-- systemuserid (sync artifact: the same human re-created across business units /
-- import batches, with meetings attributed to both ids over time). Each row
-- folds an alias id into the canonical (high-volume) id for that person.
--
-- Rose-owned: NEVER touched by the Dynamics sync, so the mapping survives the
-- nightly mirror refresh. Curated MANUALLY and only for people VERIFIED to be a
-- single human (shared top clients / continuous timeline) — never a blanket
-- display_name merge, which would wrongly fuse two different people sharing a
-- name (e.g. a common name like "Brian Smith").
--
-- Resolve identity everywhere via public.canonical_user_id(uuid) — one source
-- of truth. Views LEFT JOIN this table (or call the function) and group by the
-- canonical id; the base per-meeting view exposes canonical_user_id so the JS
-- aggregations (Productivity Summary, Capacity) group by it without re-deriving
-- the map. The per-person, user_id-keyed views that fold by canonical id are:
-- v_productivity_person_meeting (exposes the column), v_person_role_ttm,
-- v_person_activity_windows, v_person_feedback_windows,
-- v_productivity_detail_summary, v_productivity_detail_institutions,
-- v_productivity_person_manager_stats.
--
-- ADDING A NEW DUPLICATE: only after VERIFYING the two systemusers are the same
-- human (trace shared top clients + a continuous/overlapping timeline, as was
-- done for Brian Smith and Blair Mutschler). Add one row (alias -> canonical,
-- canonical = the high-volume id) and re-run the affected views; no app change
-- is needed. Do NOT add a row on a name match alone.
--
-- THIS TABLE IS A BRIDGE, not the cure. The duplicates originate upstream in
-- Dynamics (one person with two systemuserid records). The durable fix is to
-- MERGE the duplicate systemusers in Dynamics; once merged, the corresponding
-- alias row here becomes a harmless no-op and can be removed.
--
-- NOT YET on the canonical model: the three name-merge views
-- v_analyst_monthly_activity, v_institution_detail_top_hosts and
-- v_client_detail_top_hosts still group by display_name / host_name. They are
-- correct TODAY only because the sole duplicates (Brian, Blair) are same-person,
-- so name-merge == canonical-merge for them. See those views' headers for the
-- collision caveat and the conversion path.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.canonical_user_id(uuid) CASCADE;
DROP TABLE IF EXISTS public.user_id_aliases CASCADE;

CREATE TABLE public.user_id_aliases (
  alias_user_id     uuid PRIMARY KEY,
  canonical_user_id uuid NOT NULL,
  note              text,
  CHECK (alias_user_id <> canonical_user_id)
);

-- Verified-same people only (traced: shared top clients + continuous timeline).
INSERT INTO public.user_id_aliases (alias_user_id, canonical_user_id, note) VALUES
  -- Brian Smith: alias …4b51 (3 mtgs, 2026, Royal Gold/IAMGOLD) -> canonical …4e0c
  -- (1031 host since 2020; Royal Gold is its #1 client).
  ('b5f90f22-c40b-ee11-8f6e-0022482a4b51',
   '21d086fe-e441-ee11-bdf3-0022482a4e0c',
   'Brian Smith duplicate Dynamics systemuser; verified same person (shared Royal Gold book).'),
  -- Blair Mutschler: alias …4e0c (1 mtg, 2026-03, L3 Harris) -> canonical …4b51
  -- (362 host since 2020; L3 Harris is a top client).
  ('6aaa104f-dd0b-ee11-8f6e-0022482a4e0c',
   'cc5afa45-a5ee-ed11-8849-0022482a4b51',
   'Blair Mutschler duplicate Dynamics systemuser; verified same person (shared L3 Harris).');

-- canonical_user_id(id) -> the canonical id for a person, or the id itself when
-- it is not an alias. STABLE so the planner can cache it within a query. This is
-- the single identity resolver for the whole app.
CREATE FUNCTION public.canonical_user_id(p_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT a.canonical_user_id FROM public.user_id_aliases a WHERE a.alias_user_id = p_id),
    p_id
  );
$$;


-- -----------------------------------------------------------------------------
-- meeting_saved_views
-- The Meetings page's saved views -- the app's first write path. USER
-- PREFERENCES ONLY (columns / filters / sort); no CRM data is written here.
--
-- Two locks: RLS on with zero policies (so only service_role, which bypasses
-- RLS, reaches it), AND authorisation in dashboard/app/meetings/views-actions.ts
-- for the service-role path that the app actually uses. The constraints below
-- are a third layer. See sql/patches/2026-09-09_meeting_saved_views.sql.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meeting_saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 'system'   = shared, visible to everyone, super-user managed.
  -- 'personal' = private to owner_user_id.
  scope         text NOT NULL CHECK (scope IN ('system', 'personal')),

  -- NULL for system views; the canonical user id for personal ones. The pairing
  -- is enforced below so a personal view can never become ownerless (and so
  -- visible to all) through a bad update.
  owner_user_id uuid REFERENCES public.users(user_id),

  name          text NOT NULL CHECK (btrim(name) <> ''),

  -- { columns: string[], filters: {field,op,value}[], sort: {field,dir} }
  -- Validated in the action layer against the column catalog before it lands
  -- here; jsonb keeps the shape free to grow (e.g. related-table columns).
  config        jsonb NOT NULL,

  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT meeting_saved_views_owner_matches_scope CHECK (
    (scope = 'system'   AND owner_user_id IS NULL) OR
    (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

-- At most ONE default personal view per user. Partial unique index rather than a
-- trigger: the constraint is declarative, and a second default fails loudly at
-- write time instead of quietly winning a race.
CREATE UNIQUE INDEX IF NOT EXISTS meeting_saved_views_one_personal_default
  ON public.meeting_saved_views (owner_user_id)
  WHERE scope = 'personal' AND is_default;

-- At most ONE default system view overall. Indexing `scope` works because the
-- predicate already pins it to a single value across the whole indexed subset.
CREATE UNIQUE INDEX IF NOT EXISTS meeting_saved_views_one_system_default
  ON public.meeting_saved_views (scope)
  WHERE scope = 'system' AND is_default;

-- Names are unique per owner (and across system views), case- and
-- whitespace-insensitively, so "Q4 prep" cannot shadow "Q4 Prep ".
CREATE UNIQUE INDEX IF NOT EXISTS meeting_saved_views_personal_name
  ON public.meeting_saved_views (owner_user_id, lower(btrim(name)))
  WHERE scope = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS meeting_saved_views_system_name
  ON public.meeting_saved_views (lower(btrim(name)))
  WHERE scope = 'system';

-- The switcher's read: "system views + my personal views".
CREATE INDEX IF NOT EXISTS idx_meeting_saved_views_scope_owner
  ON public.meeting_saved_views (scope, owner_user_id);

-- Reuses the shared trigger function from 02_rose_owned_tables.sql.
DROP TRIGGER IF EXISTS meeting_saved_views_touch_updated_at ON public.meeting_saved_views;
CREATE TRIGGER meeting_saved_views_touch_updated_at
  BEFORE UPDATE ON public.meeting_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Lock down: RLS on, zero policies => only service_role can read/write. The
-- anon key used by the browser gets nothing. Same pattern as user_roles.
ALTER TABLE public.meeting_saved_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_saved_views TO service_role;

-- Check what is there:
--   SELECT scope, name, is_default, owner_user_id
--   FROM public.meeting_saved_views ORDER BY scope, name;


-- -----------------------------------------------------------------------------
-- event_saved_views
-- The Events page's saved views. Identical shape and identical rules to
-- meeting_saved_views; the APP CODE is shared (one parameterised module in
-- dashboard/lib/table-views/saved-views.ts enforces both), so only the storage
-- is duplicated. USER PREFERENCES ONLY -- no CRM data is written here.
--
-- RLS on with zero policies => only service_role reaches it. See
-- sql/patches/2026-09-10_admin_events.sql for the full rationale.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('system', 'personal')),
  owner_user_id uuid REFERENCES public.users(user_id),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  config        jsonb NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_saved_views_owner_matches_scope CHECK (
    (scope = 'system'   AND owner_user_id IS NULL) OR
    (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS event_saved_views_one_personal_default
  ON public.event_saved_views (owner_user_id)
  WHERE scope = 'personal' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS event_saved_views_one_system_default
  ON public.event_saved_views (scope)
  WHERE scope = 'system' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS event_saved_views_personal_name
  ON public.event_saved_views (owner_user_id, lower(btrim(name)))
  WHERE scope = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS event_saved_views_system_name
  ON public.event_saved_views (lower(btrim(name)))
  WHERE scope = 'system';

CREATE INDEX IF NOT EXISTS idx_event_saved_views_scope_owner
  ON public.event_saved_views (scope, owner_user_id);

DROP TRIGGER IF EXISTS event_saved_views_touch_updated_at ON public.event_saved_views;
CREATE TRIGGER event_saved_views_touch_updated_at
  BEFORE UPDATE ON public.event_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.event_saved_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_saved_views TO service_role;

-- -----------------------------------------------------------------------------
-- touchpoint_saved_views
-- Saved views for the CRM -> Touchpoints admin table. Identical shape and
-- identical rules to meeting_saved_views and event_saved_views above; the APP
-- CODE is shared (one parameterised module in dashboard/lib/table-views/
-- saved-views.ts enforces all of them), so only the storage is duplicated.
--
-- RLS on, zero policies => only service_role reaches it.
-- Added 2026-09-15; see sql/patches/2026-09-15_admin_touchpoints.sql.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.touchpoint_saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('system', 'personal')),
  owner_user_id uuid REFERENCES public.users(user_id),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  config        jsonb NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT touchpoint_saved_views_owner_matches_scope CHECK (
    (scope = 'system'   AND owner_user_id IS NULL) OR
    (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS touchpoint_saved_views_one_personal_default
  ON public.touchpoint_saved_views (owner_user_id)
  WHERE scope = 'personal' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS touchpoint_saved_views_one_system_default
  ON public.touchpoint_saved_views (scope)
  WHERE scope = 'system' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS touchpoint_saved_views_personal_name
  ON public.touchpoint_saved_views (owner_user_id, lower(btrim(name)))
  WHERE scope = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS touchpoint_saved_views_system_name
  ON public.touchpoint_saved_views (lower(btrim(name)))
  WHERE scope = 'system';

CREATE INDEX IF NOT EXISTS idx_touchpoint_saved_views_scope_owner
  ON public.touchpoint_saved_views (scope, owner_user_id);

DROP TRIGGER IF EXISTS touchpoint_saved_views_touch_updated_at ON public.touchpoint_saved_views;
CREATE TRIGGER touchpoint_saved_views_touch_updated_at
  BEFORE UPDATE ON public.touchpoint_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.touchpoint_saved_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.touchpoint_saved_views TO service_role;

-- -----------------------------------------------------------------------------
-- note_saved_views
-- Saved views for the CRM -> Notes admin table. Identical shape and identical
-- rules to the other *_saved_views tables above; the APP CODE is shared (one
-- parameterised module in dashboard/lib/table-views/saved-views.ts enforces all
-- five), so only the storage is duplicated.
--
-- RLS on, zero policies => only service_role reaches it.
-- Added 2026-09-15; see sql/patches/2026-09-15_admin_notes.sql.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.note_saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('system', 'personal')),
  owner_user_id uuid REFERENCES public.users(user_id),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  config        jsonb NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT note_saved_views_owner_matches_scope CHECK (
    (scope = 'system'   AND owner_user_id IS NULL) OR
    (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS note_saved_views_one_personal_default
  ON public.note_saved_views (owner_user_id)
  WHERE scope = 'personal' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS note_saved_views_one_system_default
  ON public.note_saved_views (scope)
  WHERE scope = 'system' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS note_saved_views_personal_name
  ON public.note_saved_views (owner_user_id, lower(btrim(name)))
  WHERE scope = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS note_saved_views_system_name
  ON public.note_saved_views (lower(btrim(name)))
  WHERE scope = 'system';

CREATE INDEX IF NOT EXISTS idx_note_saved_views_scope_owner
  ON public.note_saved_views (scope, owner_user_id);

DROP TRIGGER IF EXISTS note_saved_views_touch_updated_at ON public.note_saved_views;
CREATE TRIGGER note_saved_views_touch_updated_at
  BEFORE UPDATE ON public.note_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.note_saved_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_saved_views TO service_role;

-- -----------------------------------------------------------------------------
-- account_team_members
-- The DASHBOARD-OWNED account team: who holds each of six roles on each client.
-- Not a Dynamics mirror (no _raw, no _synced_at; the sync never writes here).
--
-- SEEDED from the CRM's account-level role lookups, then owned here. The
-- role -> accounts-column mapping, the memo=teaser reasoning, and the
-- re-runnable seed all live in sql/patches/2026-09-15_account_team_members.sql.
--
-- SETUP ONLY as of 2026-09-15: the ONLY reader/writer is /admin/account-teams.
-- It is deliberately NOT wired into teamAccountIds, resolveClientScope,
-- lib/access/*, lib/account-team.ts, or any CRM or reporting page. It is
-- intended to become the source of truth for account-team-based visibility
-- later; that is a separate, deliberate change.
--
-- NO UNIQUE (account_id, role) ON PURPOSE: the UI allows one assignee per slot
-- and enforces that in the server action, but the schema permits several so a
-- future multi-assignee role needs no migration. The unique index below only
-- blocks the meaningless case -- the same person twice in the same slot.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_team_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(account_id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN (
                'account_manager','secondary_manager','feedback_report',
                'associate','memo','logistics'
              )),
  user_id     uuid NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('crm_seed','manual')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  updated_by  text
);

CREATE UNIQUE INDEX IF NOT EXISTS account_team_members_unique_assignment
  ON public.account_team_members (account_id, role, user_id);
CREATE INDEX IF NOT EXISTS idx_account_team_members_account
  ON public.account_team_members (account_id, role);
CREATE INDEX IF NOT EXISTS idx_account_team_members_user
  ON public.account_team_members (user_id);
CREATE INDEX IF NOT EXISTS idx_account_team_members_role
  ON public.account_team_members (role);

DROP TRIGGER IF EXISTS account_team_members_touch_updated_at ON public.account_team_members;
CREATE TRIGGER account_team_members_touch_updated_at
  BEFORE UPDATE ON public.account_team_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.account_team_members ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_team_members TO service_role;

-- -----------------------------------------------------------------------------
-- account_status
-- A DASHBOARD-OWNED Active/Inactive flag per client, one row per account.
-- Seeded from public.accounts.state_label (the Dynamics statecode: Active 106 /
-- Inactive 122 today). Full reasoning + the re-runnable seed live in
-- sql/patches/2026-09-15b_account_status.sql.
--
-- SETUP ONLY as of 2026-09-15: the ONLY reader/writer is the toggle on
-- /admin/account-teams. It filters nothing, hides nothing, and appears in no
-- query's WHERE clause.
--
-- NOTE accounts.state_label is LOAD-BEARING elsewhere -- 'WHERE state_label =
-- ''Active''' appears ~15 times in sql/03_views.sql and in
-- app/institution-style/page.tsx. This table is a PARALLEL copy that nothing
-- reads; the CRM field stays the source of truth for every existing filter
-- until a separate, deliberate change switches those readers over.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_status (
  account_id  uuid PRIMARY KEY REFERENCES public.accounts(account_id) ON DELETE CASCADE,
  is_active   boolean NOT NULL,
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('crm_seed','manual')),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  changed_by  text
);

CREATE INDEX IF NOT EXISTS idx_account_status_is_active ON public.account_status (is_active);
CREATE INDEX IF NOT EXISTS idx_account_status_source    ON public.account_status (source);

ALTER TABLE public.account_status ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_status TO service_role;

-- -----------------------------------------------------------------------------
-- audit_log
-- APPEND-ONLY change history for every write the dashboard makes on a person's
-- behalf. One row per mutation: who, what action, which entity/record, and a
-- field-level {old,new} diff (a full row snapshot for creates and deletes).
--
-- THE RULE: every server action or route handler that inserts/updates/deletes
-- on a person's behalf calls recordAudit() in dashboard/lib/audit.ts. There is
-- no second logging mechanism. Background machinery on a schedule (the nightly
-- sync, the reconcile sweep, the cron send log) is deliberately excluded -- it
-- has its own run logs and would bury the human trail.
--
-- APPEND-ONLY IS ENFORCED, not merely intended: UPDATE/DELETE are revoked from
-- service_role AND blocked by a trigger (which also catches the table owner
-- typing in the SQL editor). To correct an entry, append a correcting row.
--
-- Full reasoning + the check queries: sql/patches/2026-09-15c_audit_log.sql.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  -- No FK on actor_user_id on purpose: history must survive the person.
  actor_user_id uuid,
  actor_email   text,
  action        text NOT NULL CHECK (action IN ('create','update','delete')),
  entity        text NOT NULL,
  record_id     text,
  changes       jsonb,
  context       text
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity_record
  ON public.audit_log (entity, record_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at
  ON public.audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON public.audit_log (actor_email, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.audit_log_is_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log is append-only: % is not permitted. Append a correcting row instead.',
    TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON public.audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_is_append_only();

DROP TRIGGER IF EXISTS audit_log_no_delete ON public.audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_is_append_only();

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

REVOKE UPDATE, DELETE ON public.audit_log FROM service_role;
GRANT SELECT, INSERT ON public.audit_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO service_role;

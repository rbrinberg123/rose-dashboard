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

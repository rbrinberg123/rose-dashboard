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

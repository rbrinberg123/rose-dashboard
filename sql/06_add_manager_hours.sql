-- =============================================================================
-- 06_add_manager_hours.sql
--
-- Adds primary/secondary account manager monthly hours to cost_assumptions.
-- Used by the Productivity page to attribute account-management labor to each
-- person who appears as Primary or Secondary Manager on a client account.
--
-- Idempotent: re-running is safe.
-- =============================================================================

ALTER TABLE public.cost_assumptions
  ADD COLUMN IF NOT EXISTS primary_manager_hours_monthly   numeric NOT NULL DEFAULT 4
    CHECK (primary_manager_hours_monthly >= 0);

ALTER TABLE public.cost_assumptions
  ADD COLUMN IF NOT EXISTS secondary_manager_hours_monthly numeric NOT NULL DEFAULT 2
    CHECK (secondary_manager_hours_monthly >= 0);

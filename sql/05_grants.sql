-- =============================================================================
-- 05_grants.sql
--
-- Grants required for the Next.js dashboard to read mirror tables, read
-- computed views, and read/write Rose-owned admin tables via the Supabase
-- service_role key.
--
-- Default Supabase setups grant service_role wide access to schema `public`
-- via default privileges, but that didn't take effect for these objects in
-- this project. Run this file once after 03_views.sql to fix it.
--
-- This file is idempotent and safe to re-run. It does NOT grant anything to
-- `anon` or `authenticated` — the dashboard talks to the database server-side
-- only, using service_role.
--
-- Run in the Supabase SQL editor.
-- =============================================================================

-- Schema usage (required before any GRANT on tables takes effect).
GRANT USAGE ON SCHEMA public TO service_role;

-- Read mirror tables (sync-managed, treated as read-only by the dashboard).
GRANT SELECT ON public.users        TO service_role;
GRANT SELECT ON public.accounts     TO service_role;
GRANT SELECT ON public.meetings     TO service_role;
GRANT SELECT ON public.touchpoints  TO service_role;
GRANT SELECT ON public.client_notes TO service_role;
GRANT SELECT ON public.contracts    TO service_role;

-- Read + write Rose-owned admin tables (entered through the dashboard).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_assumptions     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_schedule      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_direct_costs  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.overhead_periods     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.overhead_overrides   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_overrides    TO service_role;

-- Sequences for the bigint PKs on Rose-owned tables (required for INSERT).
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Read computed views.
GRANT SELECT ON public.v_meeting_costs        TO service_role;
GRANT SELECT ON public.v_client_quarterly_pnl TO service_role;
GRANT SELECT ON public.v_client_portfolio     TO service_role;
GRANT SELECT ON public.v_analyst_activity     TO service_role;
GRANT SELECT ON public.v_feedback_by_client   TO service_role;
GRANT SELECT ON public.v_feedback_by_analyst  TO service_role;
GRANT SELECT ON public.v_feedback_overall     TO service_role;
GRANT SELECT ON public.v_pipeline_30d         TO service_role;
GRANT SELECT ON public.v_contract_renewals    TO service_role;

-- Future-proofing: any new tables/views/sequences created in `public` by the
-- role running this script will automatically grant service_role what it
-- needs, so we don't repeat this every time the schema evolves.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO service_role;

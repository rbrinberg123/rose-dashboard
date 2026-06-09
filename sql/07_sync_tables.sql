-- =============================================================================
-- 07_sync_tables.sql
--
-- Phase 6a: persistent Dynamics → Supabase sync via Vercel Cron.
--
-- Adds the two bookkeeping tables the automated sync route relies on
-- (sync_runs, sync_errors) and grants the service_role the write access it
-- needs to populate the mirror tables.
--
-- WHY THE EXTRA GRANTS: the manual Python loader (loader/load.py) connects to
-- Postgres directly as the database owner via SUPABASE_DB_URL, so it could
-- always write to the mirror tables. The new TypeScript route writes through
-- PostgREST using the service_role key, which only had SELECT on the mirror
-- tables (see 05_grants.sql). Without INSERT/UPDATE here the upserts fail with
-- "permission denied for table accounts".
--
-- This file is idempotent and safe to re-run. Run it once in the Supabase SQL
-- editor after 05_grants.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- sync_runs — one row per entity, holding the incremental-sync watermark and
-- the outcome of the most recent run.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_runs (
  entity_name      text PRIMARY KEY,
  last_synced_at   timestamptz,
  last_status      text,
  error_count      int DEFAULT 0,
  total_records    int DEFAULT 0
);

-- -----------------------------------------------------------------------------
-- sync_errors — per-record (and per-entity) failures captured during a run.
-- Append-only; the status page reads the most recent rows.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_errors (
  id               serial PRIMARY KEY,
  run_started_at   timestamptz NOT NULL,
  entity_name      text NOT NULL,
  dynamics_id      text,
  error_message    text NOT NULL,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_errors_created_at
  ON public.sync_errors (created_at DESC);

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

-- The sync route writes the mirror tables through PostgREST (service_role).
GRANT INSERT, UPDATE ON public.users        TO service_role;
GRANT INSERT, UPDATE ON public.accounts     TO service_role;
GRANT INSERT, UPDATE ON public.meetings     TO service_role;
GRANT INSERT, UPDATE ON public.touchpoints  TO service_role;
GRANT INSERT, UPDATE ON public.client_notes TO service_role;
GRANT INSERT, UPDATE ON public.contracts    TO service_role;

-- Bookkeeping tables: full access for the route, read for the status endpoint
-- (also service_role).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_runs   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_errors TO service_role;

-- sync_errors.id is a serial → needs its sequence usable for INSERT.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

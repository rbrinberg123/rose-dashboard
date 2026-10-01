-- =============================================================================
-- Patch: Client Health — AI retention-risk rating per active client
-- Date:  2026-10-01
--
-- WHY
--   Clients → Client Health (/client-health, super-user only) shows one row per
--   ACTIVE client: Client | Note | Rating. The rating and note are produced by
--   an LLM (lib/client-health.ts) from the client's structured data + dated
--   notes, refreshed weekly by cron (Mon 09:00 UTC) and on demand from the page.
--   A super-user may override either; the override survives every regeneration.
--
-- CREATES
--   public.client_health_assessments   ONE current row per client (unique on
--                                      account_id). Dashboard-owned — not a
--                                      Dynamics mirror; the sync never writes it
--                                      and the deletion sweep never reads it.
--   public.client_health_runs          one row per batch run: single-flight
--                                      guard (one 'running' row max), lease +
--                                      heartbeat for self-chained batches.
--
-- THE TWO HALVES OF A ROW
--   ai_*        written ONLY by the batch / per-client regenerate
--               (lib/client-health.ts). A regeneration updates ai_rating,
--               ai_note, ai_model, ai_generated_at, run_id and clears ai_error*.
--   override_*  written ONLY by the super-user override actions
--               (app/client-health/actions.ts). A regeneration NEVER touches
--               them — its upsert names only the ai_* columns.
--   Effective rating / note = override_* when present, else ai_*.
--
-- ERRORS
--   ai_error / ai_error_at record the last failed classification for a client
--   (bad model output after one retry, API error). The previous ai_* values are
--   left in place, so a failure never blanks a rating.
--
-- SECURITY
--   RLS on, zero policies => only service_role reaches this table. Every read
--   and write goes through super-user-gated server code.
--
-- Safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.client_health_assessments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL UNIQUE REFERENCES public.accounts (account_id) ON DELETE CASCADE,

  ai_rating        text,
  ai_note          text,
  ai_model         text,
  ai_generated_at  timestamptz,
  run_id           uuid,
  ai_error         text,
  ai_error_at      timestamptz,

  override_rating  text,
  override_note    text,
  overridden_by    uuid,          -- public.users.user_id of the real (not impersonated) super-user
  overridden_at    timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT client_health_ai_rating_allowed
    CHECK (ai_rating IS NULL OR ai_rating IN ('1','2','3','Management / IR Change')),
  CONSTRAINT client_health_override_rating_allowed
    CHECK (override_rating IS NULL OR override_rating IN ('1','2','3','Management / IR Change'))
);

CREATE INDEX IF NOT EXISTS idx_client_health_run ON public.client_health_assessments (run_id);

ALTER TABLE public.client_health_assessments ENABLE ROW LEVEL SECURITY;

-- ---- Part 2 (added 2026-10-01): run tracking + single-flight ----------------
-- Which run a client's last FAILURE belongs to, so a resumed run skips clients
-- it already tried (succeeded: run_id = R; failed: ai_error_run_id = R).
ALTER TABLE public.client_health_assessments
  ADD COLUMN IF NOT EXISTS ai_error_run_id uuid;

-- One row per batch run. The partial unique index allows at most ONE row with
-- status 'running' at a time — the single-flight guard. lease_until is the
-- per-batch lock: a self-chained batch claims it (conditional UPDATE where the
-- lease has expired) and releases it when it hands off. A run whose lease has
-- lapsed with no handoff (crashed / timed out) is reclaimed by the next start
-- request or the cron watchdog and resumed — completed clients are skipped.
CREATE TABLE IF NOT EXISTS public.client_health_runs (
  run_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger       text NOT NULL CHECK (trigger IN ('cron','manual')),
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running','finished')),
  total         integer NOT NULL DEFAULT 0,
  started_by    text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  heartbeat_at  timestamptz NOT NULL DEFAULT now(),
  lease_until   timestamptz,
  finished_at   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS client_health_runs_one_running
  ON public.client_health_runs (status) WHERE status = 'running';

ALTER TABLE public.client_health_runs ENABLE ROW LEVEL SECURITY;

-- ---- Verify ------------------------------------------------------------------
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conrelid = 'public.client_health_assessments'::regclass;

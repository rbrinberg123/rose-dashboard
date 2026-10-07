-- ===========================================================================
-- 2026-10-07_feedback_claims.sql
--
-- Feedback task CLAIMING — claim / release / reassign / close on Feedback
-- tasks, driven from Logistics → Feedback Reports (/feedback-manager).
-- See dashboard/content/docs/14-tasks.md ("Feedback claiming").
--
--   1. user_data_scopes.claim_feedback — the per-person "Can claim feedback"
--      capability (Admin → Users). Deny-by-default; Super Users are granted in
--      code and never rely on this column.
--   2. Dashboard-owned claim / close columns on public.tasks. The Dynamics
--      sync NEVER writes these (lib/sync/mappers.ts mapTask does not emit them,
--      and the upsert only sets the columns it sends), so they survive every
--      sync run — which is what lets the same mechanism extend to
--      Dynamics-origin tasks at cutover with no rebuild.
--   3. feedback_claim_events — append-only claim history (who claimed /
--      released / reassigned / closed which task, when, by whom).
--
-- TODAY only origin = 'dashboard' Feedback tasks are claimable; Dynamics-origin
-- tasks stay read-only until the cutover switch in
-- dashboard/lib/feedback-claims/policy.ts is turned on.
--
-- Run this ONCE in the Supabase SQL editor. Safe to re-run.
-- ===========================================================================

-- ---- 1. The capability -----------------------------------------------------
ALTER TABLE public.user_data_scopes
  ADD COLUMN IF NOT EXISTS claim_feedback boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_data_scopes.claim_feedback IS
  'CAPABILITY (not a row scope): may this person claim Feedback tasks on '
  'Feedback Reports? Read via getUserScopes().claimFeedback (dashboard/lib/feedback-claims/server.ts). '
  'Deny-by-default; Super Users are granted in code.';

-- ---- 2. Dashboard-owned claim / close columns on tasks ----------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS claimed_by_id   uuid,
  ADD COLUMN IF NOT EXISTS claimed_by_name text,
  ADD COLUMN IF NOT EXISTS claimed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by_id    uuid,
  ADD COLUMN IF NOT EXISTS closed_by_name  text,
  ADD COLUMN IF NOT EXISTS closed_at       timestamptz;

COMMENT ON COLUMN public.tasks.claimed_by_id IS
  'DASHBOARD-OWNED (never written by the Dynamics sync). The Feedback-claim '
  'owner, a users.user_id. Distinct from bcs_claimed_by_id, the Dynamics '
  'mirror field, which the sync overwrites. On dashboard-origin rows the claim '
  'actions keep bcs_claimed_by_* in step so existing readers need no change.';
COMMENT ON COLUMN public.tasks.claimed_at IS
  'DASHBOARD-OWNED. When the current Feedback-claim owner claimed (or was assigned) the task.';
COMMENT ON COLUMN public.tasks.closed_at IS
  'DASHBOARD-OWNED. When the task was closed through Feedback Reports (the Close action).';

-- "Mine" lookups (My Dashboard, Feedback Reports filter).
CREATE INDEX IF NOT EXISTS idx_tasks_claimed_by_id
  ON public.tasks (claimed_by_id) WHERE claimed_by_id IS NOT NULL;

-- ---- 3. Claim history -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feedback_claim_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL,          -- public.tasks.task_id (no FK: history outlives a purged task)
  event           text NOT NULL CHECK (event IN ('claim','release','reassign','close')),
  from_user_id    uuid,                   -- owner before (null = was unclaimed)
  from_user_name  text,
  to_user_id      uuid,                   -- owner after (null = now unclaimed)
  to_user_name    text,
  actor_user_id   uuid,                   -- the REAL signed-in person who acted
  actor_name      text,
  actor_email     text,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_claim_events_task
  ON public.feedback_claim_events (task_id, occurred_at DESC);

ALTER TABLE public.feedback_claim_events ENABLE ROW LEVEL SECURITY;
-- Append-only from the app: insert + read, never update / delete.
GRANT SELECT, INSERT ON public.feedback_claim_events TO service_role;

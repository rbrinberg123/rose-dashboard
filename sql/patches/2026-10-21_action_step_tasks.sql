-- ===========================================================================
-- Patch: Action step → task links (Client Detail "＋ Task").
-- Date:  2026-10-21
--
-- WHAT
--   Creates public.action_step_tasks — one row per task created from an action
--   step on Client Detail's Most Recent Client Note. Written by createTask
--   (app/tasks/actions.ts) ONLY when the task is actually saved; never on
--   opening the form or on cancel.
--
--   Client Detail reads the rows for the note it is showing and marks those
--   steps "✓ Task created" (click = open the task). Creating another from a
--   linked step is allowed after a light confirm — so a step may have several
--   rows; there is deliberately no unique key.
--
--   A step is matched by its TEXT (step_text, trimmed) first, then by its
--   position (step_index, 0-based, the order of the semicolon-split
--   action_step) when the text no longer matches any current step.
--
--   Dashboard-owned: no Dynamics sync writes this table. No foreign keys (the
--   mirror tables have none); a link whose task no longer exists (e.g. a
--   purged test task) is ignored by the app.
--
-- BEFORE THIS RUNS
--   "＋ Task" still creates tasks exactly as now; the link write fails soft
--   (task saved, nothing marked) and no step shows "✓ Task created".
--
-- RLS on, NO policies: only the service role (the app's server code) can read
-- or write it. SAFE TO RE-RUN.
--
-- Run ONCE in the Supabase SQL editor.
-- See dashboard/content/docs/02-pages.md → /client-detail.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.action_step_tasks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id         uuid        NOT NULL,   -- client_notes.note_id
  step_index      integer     NOT NULL,   -- 0-based position in the split action_step (fallback key)
  step_text       text        NOT NULL,   -- the step as shown (trimmed) — primary match key
  task_id         uuid        NOT NULL,   -- tasks.task_id of the created task
  created_by_id   uuid,                   -- users.user_id of who saved it
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_step_tasks_note ON public.action_step_tasks (note_id);

ALTER TABLE public.action_step_tasks ENABLE ROW LEVEL SECURITY;

-- Verify: should return 0 rows and no error.
-- SELECT * FROM public.action_step_tasks;

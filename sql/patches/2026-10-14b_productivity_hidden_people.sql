-- ===========================================================================
-- Patch: Productivity exclusions — people hidden from the per-person
-- Productivity breakdowns.
-- Date:  2026-10-14
--
-- WHAT
--   Creates public.productivity_hidden_people — one row per person a super
--   user has hidden (Summary by Person → "Excluded people"). No row = shown.
--
--   Hidden people disappear AS INDIVIDUALS from Summary by Person, Resource
--   Statistics, Person Detail's picker and Capacity. Their numbers still count
--   in every firm total: each page sums them into one "Former / Excluded
--   (N people)" row (Capacity just drops them). The split happens server-side
--   in the app (dashboard/lib/productivity-exclusions.ts); nothing here changes
--   any view, so the totals are untouched by construction.
--
--   user_id is the CANONICAL CRM user id (public.canonical_user_id() /
--   user_id_aliases), so hiding a merged person hides all their Dynamics ids.
--   Dashboard-owned: no Dynamics / personnel sync writes this table.
--
-- BEFORE THIS RUNS
--   The app reads nobody as hidden — every page looks exactly as before — and
--   the "Excluded people" switches fail to save with a hint to run this file.
--
-- RLS on, NO policies: only the service role (the app's server code) can read
-- or write it. SAFE TO RE-RUN.
--
-- Run ONCE in the Supabase SQL editor.
-- See dashboard/content/docs → Productivity exclusions.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.productivity_hidden_people (
  user_id   uuid        PRIMARY KEY,   -- canonical CRM user id
  hidden_by text        NOT NULL,      -- the super user's email
  hidden_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.productivity_hidden_people ENABLE ROW LEVEL SECURITY;

-- Verify: should return 0 rows and no error.
-- SELECT * FROM public.productivity_hidden_people;

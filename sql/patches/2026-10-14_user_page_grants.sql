-- ===========================================================================
-- Patch: per-user page grants (Admin → Users → Pages).
-- Date:  2026-10-14
--
-- WHAT
--   Creates public.user_page_grants — one row per (person, page) a super user
--   has granted ON TOP OF the person's role. Effective page access =
--   role pages (role_page_access) ∪ these grants, folded together in
--   getAllowedRoutes (dashboard/lib/page-access.ts).
--
--   Grants are PAGE ACCESS ONLY. Writes, admin powers and data scopes on the
--   page still run through the existing role / scope checks.
--
--   Only GRANTABLE pages may be stored (isGrantableRoute in
--   dashboard/lib/access-control.ts). The app enforces that on write AND
--   ignores any non-grantable row on read, so a hand-inserted row for a strict
--   page (Users, Roles, Sync, CRM tables, …) has no effect.
--
--   Keyed on the LOWER-CASED email, like user_role_grants and
--   user_data_scopes. Revoking = deleting the row (the app audits both).
--
-- BEFORE THIS RUNS
--   The app reads no grants (the query error is treated as "none") — access is
--   exactly role-only, as today. Toggling a page in Admin → Users fails to save.
--
-- RLS on, NO policies: only the service role (the app's server code) can read
-- or write it. SAFE TO RE-RUN.
--
-- Run ONCE in the Supabase SQL editor.
-- See dashboard/content/docs/01-access-and-users.md → "Per-user page grants".
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. READ-ONLY PRE-CHECK (optional — run on its own first and keep the result).
--    Does the live Roles matrix currently open any of the five pages that
--    2026-10-14 moved into ADMIN_ONLY_ROUTES to a non-super-user role? Any
--    `allowed = true` row returned here was a live hole until the code change
--    deploys (after which such rows are inert). Changes nothing.
-- ---------------------------------------------------------------------------
-- SELECT role, route, allowed
-- FROM public.role_page_access
-- WHERE route IN ('/admin/users', '/admin/roles', '/admin/sync',
--                 '/admin/reconciliation', '/admin/database', '/admin')
-- ORDER BY route, role;

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_page_grants (
  email      text        NOT NULL CHECK (email = lower(email)),
  route      text        NOT NULL,
  granted_by text        NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, route)
);

ALTER TABLE public.user_page_grants ENABLE ROW LEVEL SECURITY;

-- Verify: should return 0 rows on a fresh install, and no error.
-- SELECT * FROM public.user_page_grants ORDER BY email, route;

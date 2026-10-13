-- ===========================================================================
-- Patch: add the "admin" role to the RBAC vocabulary.
-- Date:  2026-10-13
--
-- WHAT
--   Widens the CHECK constraint on public.user_role_grants so 'admin' is a
--   permitted value. Until this runs, picking Admin in Admin → Users fails at
--   the database — the safe failure: the role is refused outright rather than
--   saved.
--
-- WHAT IT DOES NOT DO
--   No INSERT into role_page_access. Admin's page set is CODE-DEFINED, like
--   super_user: canAccessRoute lets it reach everything except
--   ADMIN_EXCLUDED_ROUTES and hidden pages (dashboard/lib/access-control.ts),
--   and its Roles-matrix column is locked and never written. Its powers come
--   from hasSuperUserPrivileges() in code — nothing in the database grants them.
--
-- SAFE TO RE-RUN. Dropping and re-adding the constraint is idempotent, and the
-- new value set is a superset of the old one, so no existing row can violate it.
--
-- Run ONCE in the Supabase SQL editor.
-- See dashboard/content/docs/01-access-and-users.md → "Admin role".
-- ===========================================================================

ALTER TABLE public.user_role_grants
  DROP CONSTRAINT IF EXISTS user_role_grants_role_check;

ALTER TABLE public.user_role_grants
  ADD CONSTRAINT user_role_grants_role_check
  CHECK (role IN ('user', 'associate', 'client_manager', 'logistics', 'admin', 'super_user'));

-- Verify: should list the widened constraint (including 'admin').
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.user_role_grants'::regclass
--   AND conname = 'user_role_grants_role_check';

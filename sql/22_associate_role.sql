-- 22_associate_role.sql
-- Add the "Associate" role to the RBAC vocabulary.
--
-- WHAT THIS DOES
--   Widens the CHECK constraint on public.user_role_grants so 'associate' is a
--   permitted value. Until this runs, picking Associate in Admin → Users fails
--   at the database — which is the safe failure: the role is refused outright
--   rather than saved and silently ungated.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   It grants Associate NOTHING. There is no INSERT into role_page_access here.
--   Associate starts denied everywhere (deny-by-default) and stays that way
--   until a super-user ticks boxes for it in the Admin → Roles matrix. That is
--   the whole point: adding a role must not create access.
--
--   Page access is enforced by role_page_access + canAccessRoute, neither of
--   which enumerates roles, so no further DDL is needed for gating to work.
--   super_user remains a hard backstop in code and is never written to
--   role_page_access.
--
-- SAFE TO RE-RUN. Dropping and re-adding the constraint is idempotent, and the
-- new value set is a superset of the old one, so no existing row can violate it.
--
-- Run once in the Supabase SQL editor. See dashboard/content/docs/01-access-and-users.md.

ALTER TABLE public.user_role_grants
  DROP CONSTRAINT IF EXISTS user_role_grants_role_check;

ALTER TABLE public.user_role_grants
  ADD CONSTRAINT user_role_grants_role_check
  CHECK (role IN ('user', 'associate', 'client_manager', 'logistics', 'super_user'));

-- Verify: should list the widened constraint.
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.user_role_grants'::regclass
--   AND conname = 'user_role_grants_role_check';

-- Verify Associate has no page grants yet (expect zero rows):
-- SELECT role, route, allowed
-- FROM public.role_page_access
-- WHERE role = 'associate';

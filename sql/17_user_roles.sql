-- 17_user_roles.sql
-- Role-based access control (RBAC) for the dashboard.
--
-- Maps a signed-in user's email -> role. Two roles:
--   'super_user' — sees every page.
--   'user'       — sees only the Logistics pages. The exact allow-list of
--                  routes lives in dashboard/lib/access-control.ts.
--
-- Enforcement is SERVER-SIDE in dashboard/proxy.ts, which reads this table
-- with the service_role client before any page renders. Model is
-- DENY-BY-DEFAULT: a signed-in @roseandco.com email that is NOT present in
-- this table has NO role and therefore no access to anything (they see the
-- "request access" landing page).
--
-- RLS is ENABLED with NO policies. That locks the table to the service_role
-- key only (service_role bypasses RLS), consistent with the rest of the app
-- where all business data is read via service_role. The anon/browser client
-- can never read or write it.
--
-- Roles are managed for now by editing this table directly in Supabase. A
-- future in-app admin page can write to it via the same service_role path.
-- A BEFORE trigger lowercases email on every insert/update so that manual
-- edits with mixed-case emails still match the app's lower-cased lookups.

CREATE TABLE IF NOT EXISTS public.user_roles (
  email       text        PRIMARY KEY,           -- unique; stored lower-cased (see trigger)
  role        text        NOT NULL CHECK (role IN ('super_user', 'user')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Normalize email to lower-case and keep updated_at current on every write.
-- Runs on INSERT and UPDATE so directly-edited rows are normalized too.
CREATE OR REPLACE FUNCTION public.user_roles_set_metadata()
RETURNS trigger AS $$
BEGIN
  NEW.email = lower(NEW.email);
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_roles_set_metadata ON public.user_roles;
CREATE TRIGGER trg_user_roles_set_metadata
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_set_metadata();

-- Lock down: RLS on, zero policies => only service_role (which bypasses RLS)
-- can read/write. The anon key used by the browser gets nothing.
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Explicit service-role grant, matching the app's existing table pattern.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO service_role;

-- Seed the first Super User so you are never locked out. Add more rows the
-- same way (role = 'super_user' or 'user').
INSERT INTO public.user_roles (email, role)
VALUES ('scott@roseandco.com', 'super_user')
ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, updated_at = now();

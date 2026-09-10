-- =============================================================================
-- Patch: Meetings -> Saved Views (system + personal)
-- Date: 2026-09-09
--
-- The app's FIRST WRITE PATH. Everything else in this dashboard is read-only
-- against the Dynamics mirror; this table holds USER PREFERENCES only -- which
-- columns a saved view shows, what it filters on, how it sorts. No CRM data is
-- written here, and nothing in this table can change a meeting.
--
-- SECURITY -- TWO INDEPENDENT LOCKS
--
--   LOCK 1: THE DATABASE SHUTS OUT EVERYTHING BUT service_role.
--   RLS is enabled with ZERO policies, so any role that does not bypass RLS
--   gets nothing -- the same pattern user_roles and cron_send_log use. Note the
--   anon/authenticated roles also have no GRANT on this schema today, so RLS is
--   belt AND braces rather than the only thing standing there: it is what keeps
--   the table shut if a future GRANT, a Supabase dashboard toggle, or a change
--   in default privileges ever opens the direct PostgREST path. The browser
--   ships NEXT_PUBLIC_SUPABASE_ANON_KEY, so that path is real and public; a
--   table of per-user private rows should not depend on one lock.
--
--   LOCK 2: THE APP AUTHORISES EVERY CALL.
--   RLS does NOT constrain the dashboard itself -- every read and write goes
--   through the service-role key, which bypasses it. So authorisation for the
--   path that is actually used lives in application code, in ONE place:
--
--       dashboard/app/meetings/views-actions.ts
--
--   which resolves the caller's identity server-side and refuses anything else.
--   A missing check THERE is a real hole; RLS will not catch it. The rules:
--     * personal views  -- a caller may read/create/update/delete only rows
--                          whose owner_user_id is their own canonical user id.
--     * system  views  --  readable by everyone; only super_user may write.
--     * impersonation  --  a super-user in "View as" mode may READ the
--                          impersonated person's views (that is the point of
--                          the preview) but may NOT write as them.
--
--   The CHECK constraints and partial unique indexes below are a third layer:
--   the DATABASE backstop for the invariants the action layer enforces, so a bug
--   in the app surfaces as a failed write rather than as silently corrupt state.
--
-- IDENTITY
--   owner_user_id stores the CANONICAL user id (public.canonical_user_id), so a
--   person carrying duplicate Dynamics systemuser records has one set of views
--   rather than one per alias.
--
-- SAFE TO RE-RUN.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.meeting_saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 'system'   = shared, visible to everyone, super-user managed.
  -- 'personal' = private to owner_user_id.
  scope         text NOT NULL CHECK (scope IN ('system', 'personal')),

  -- NULL for system views; the canonical user id for personal ones. The pairing
  -- is enforced below so a personal view can never become ownerless (and so
  -- visible to all) through a bad update.
  owner_user_id uuid REFERENCES public.users(user_id),

  name          text NOT NULL CHECK (btrim(name) <> ''),

  -- { columns: string[], filters: {field,op,value}[], sort: {field,dir} }
  -- Validated in the action layer against the column catalog before it lands
  -- here; jsonb keeps the shape free to grow (e.g. related-table columns).
  config        jsonb NOT NULL,

  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT meeting_saved_views_owner_matches_scope CHECK (
    (scope = 'system'   AND owner_user_id IS NULL) OR
    (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

-- At most ONE default personal view per user. Partial unique index rather than a
-- trigger: the constraint is declarative, and a second default fails loudly at
-- write time instead of quietly winning a race.
CREATE UNIQUE INDEX IF NOT EXISTS meeting_saved_views_one_personal_default
  ON public.meeting_saved_views (owner_user_id)
  WHERE scope = 'personal' AND is_default;

-- At most ONE default system view overall. Indexing `scope` works because the
-- predicate already pins it to a single value across the whole indexed subset.
CREATE UNIQUE INDEX IF NOT EXISTS meeting_saved_views_one_system_default
  ON public.meeting_saved_views (scope)
  WHERE scope = 'system' AND is_default;

-- Names are unique per owner (and across system views), case- and
-- whitespace-insensitively, so "Q4 prep" cannot shadow "Q4 Prep ".
CREATE UNIQUE INDEX IF NOT EXISTS meeting_saved_views_personal_name
  ON public.meeting_saved_views (owner_user_id, lower(btrim(name)))
  WHERE scope = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS meeting_saved_views_system_name
  ON public.meeting_saved_views (lower(btrim(name)))
  WHERE scope = 'system';

-- The switcher's read: "system views + my personal views".
CREATE INDEX IF NOT EXISTS idx_meeting_saved_views_scope_owner
  ON public.meeting_saved_views (scope, owner_user_id);

-- Reuses the shared trigger function from 02_rose_owned_tables.sql.
DROP TRIGGER IF EXISTS meeting_saved_views_touch_updated_at ON public.meeting_saved_views;
CREATE TRIGGER meeting_saved_views_touch_updated_at
  BEFORE UPDATE ON public.meeting_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Lock down: RLS on, zero policies => only service_role (which bypasses RLS)
-- can read/write. The anon key used by the browser gets nothing. Same pattern as
-- public.user_roles and public.cron_send_log -- see LOCK 1 in the header.
ALTER TABLE public.meeting_saved_views ENABLE ROW LEVEL SECURITY;

-- Explicit service-role grant, matching the app's existing table pattern.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_saved_views TO service_role;

-- Check what is there:
--   SELECT scope, name, is_default, owner_user_id
--   FROM public.meeting_saved_views ORDER BY scope, name;

-- =============================================================================
-- Patch: audit_log — an APPEND-ONLY change-history trail for every write the
--        dashboard makes on a person's behalf.
-- Date: 2026-09-15
--
-- CREATES
--   1. public.audit_log  -- the trail
--   2. Indexes on (entity, record_id) and occurred_at
--   3. An append-only enforcement: UPDATE and DELETE are revoked and blocked
--
-- WHY NOW. There was no history table of any kind before this. The write
-- surfaces are still few (18 server actions across 13 tables) and several of
-- them record nothing about who changed what — role_page_access and
-- user_data_scopes have no actor columns at all, and client_todo_notes records
-- only updated_at. Establishing the trail while the surface area is small means
-- every future write feature has one obvious place to log to, instead of
-- thirteen tables each growing their own half-answer.
--
-- WHAT IT DOES NOT DO. This patch adds a table. It changes no existing write,
-- no read, no page, and no permission. The application writes to it ALONGSIDE
-- the saves it already performs; every one of those saves still does exactly
-- what it did before, and a failure to log is swallowed rather than allowed to
-- fail a user's save (see lib/audit.ts).
--
-- SAFE TO RE-RUN.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. public.audit_log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  occurred_at   timestamptz NOT NULL DEFAULT now(),

  -- WHO. Resolved server-side from the verified session, never sent by the
  -- client. Both are nullable: a cron-triggered run has no human actor, and a
  -- person may not resolve to a public.users row.
  --
  -- NO FOREIGN KEY on actor_user_id, deliberately. The trail must survive the
  -- person: if a users row is ever removed or re-keyed, an FK would either
  -- block the delete or cascade away the history, and an audit record that can
  -- be erased by tidying up the user table is not an audit record.
  actor_user_id uuid,
  actor_email   text,

  action        text NOT NULL CHECK (action IN ('create', 'update', 'delete')),

  -- WHAT. `entity` is the table or feature name ('account_team_members',
  -- 'accounts.ai_summary'); `record_id` is text so it can hold a uuid, a bigint
  -- id, or a composite key ('role:client_manager|route:/portfolio') without a
  -- column per shape.
  entity        text NOT NULL,
  record_id     text,

  -- THE DIFF.
  --   update        { "field": { "old": …, "new": … } } for CHANGED fields only
  --   create/delete the full row snapshot
  changes       jsonb,

  -- Free-text breadcrumb: which page, whether a super-user was impersonating,
  -- whether a run was cron-triggered.
  context       text
);

-- The two reads a future audit viewer needs: one record's history, and the
-- recent-activity feed.
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_record
  ON public.audit_log (entity, record_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at
  ON public.audit_log (occurred_at DESC);

-- "What has this person changed?" — the other question that gets asked.
CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON public.audit_log (actor_email, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 2. APPEND-ONLY — enforced, not merely intended
--
--    The app only ever INSERTs. These two guards make that true of the database
--    as well, so a mistaken UPDATE from a future code path or a hand-typed
--    statement in the SQL editor cannot quietly rewrite history.
--
--    Belt AND braces, because they fail differently:
--      * The REVOKE is the permission answer. It stops service_role (the key
--        the app uses) from issuing UPDATE or DELETE at all.
--      * The TRIGGER is the behaviour answer. It raises even for a superuser or
--        the table owner, who the REVOKE does not constrain — which is exactly
--        who is typing in the Supabase SQL editor.
--
--    TO CORRECT A BAD ENTRY: do not update it. Append a new row describing the
--    correction. That is what append-only means.
--
--    TO PURGE OLD ROWS (a retention policy, years from now): drop the trigger,
--    delete, recreate the trigger — deliberately, in one reviewed migration.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_log_is_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log is append-only: % is not permitted. Append a correcting row instead.',
    TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON public.audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_is_append_only();

DROP TRIGGER IF EXISTS audit_log_no_delete ON public.audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_is_append_only();

-- RLS on, zero policies => only service_role reaches it. The anon key that
-- ships in the browser gets nothing.
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- INSERT and SELECT only. Note the explicit REVOKE: a prior GRANT ALL from an
-- earlier run of this patch would otherwise survive.
REVOKE UPDATE, DELETE ON public.audit_log FROM service_role;
GRANT SELECT, INSERT ON public.audit_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO service_role;


-- ---------------------------------------------------------------------------
-- 3. CHECK IT
-- ---------------------------------------------------------------------------

-- Both of these MUST fail with "audit_log is append-only".
--   UPDATE public.audit_log SET context = 'tampered' WHERE id = 1;
--   DELETE FROM public.audit_log WHERE id = 1;

-- Recent activity.
--   SELECT occurred_at, actor_email, action, entity, record_id, context
--     FROM public.audit_log ORDER BY occurred_at DESC LIMIT 50;

-- One record's full history.
--   SELECT occurred_at, actor_email, action, changes
--     FROM public.audit_log
--    WHERE entity = 'account_team_members' AND record_id = '<account_id>'
--    ORDER BY occurred_at;

-- Coverage: which write surfaces have actually logged anything yet.
--   SELECT entity, action, count(*), max(occurred_at) AS last_seen
--     FROM public.audit_log GROUP BY 1,2 ORDER BY 1,2;

-- A worked example of the update diff shape:
--   {"is_active": {"old": true, "new": false}}

-- =============================================================================
-- Patch: drop the _synced_at trigger from public.users
-- Date:  2026-09-16
--
-- THE BUG
--   sql/patches/2026-09-09_feedback_received_and_synced_at.sql (Part B) added
--   public.touch_synced_at() and attached it BEFORE INSERT OR UPDATE to nine
--   mirror tables. Eight of them have a _synced_at column. public.users does
--   not -- it has never had one. It tracks freshness with first_seen_at /
--   last_seen_at, and lib/sync/mappers.ts mapSystemUser writes last_seen_at
--   directly on every run.
--
--   So every write to public.users has failed since the patch was applied:
--
--     record "new" has no field "_synced_at"
--
--   The systemusers sync upserts, throws, and logs to sync_errors -- every run
--   since 2026-09-11. No new or changed Dynamics user has mirrored in since.
--   jfoley@roseandco.com is the visible symptom: the user exists in Dynamics,
--   is absent from public.users, and therefore cannot be granted a role or
--   appear anywhere in permissions.
--
-- THE FIX
--   Drop the trigger from public.users. The other eight stay exactly as they
--   are. users' first_seen_at / last_seen_at handling is untouched.
--
--   Considered and rejected: adding a _synced_at column to users for
--   uniformity. users is not shaped like the other mirrors (no _raw either),
--   last_seen_at already carries the same meaning, and v_* views and
--   lib/access read the existing columns. Adding a column to fit a trigger is
--   the tail wagging the dog. Revisit only if users is ever reworked into a
--   standard mirror table.
--
-- Safe to re-run.
-- =============================================================================

-- ---- PART A -- drop the trigger --------------------------------------------
DROP TRIGGER IF EXISTS users_touch_synced_at ON public.users;


-- ---- PART B -- re-pull the users missed while the trigger was broken -------
--
-- The sync watermark advanced past the failing records (the run recorded its
-- high-water mark even though the users upsert threw), so an ordinary
-- incremental run will NOT go back for them. Clearing the watermark forces a
-- full systemuser re-pull on the next sync.
--
-- Run this AFTER Part A. Then trigger a sync (the 10-minute cron, or the
-- manual run in 08-runbook.md).
UPDATE public.sync_runs
   SET last_synced_at = NULL
 WHERE entity_name = 'systemusers';


-- =============================================================================
-- VERIFICATION -- run after Part A + Part B + a sync
-- =============================================================================

-- V1. No _synced_at trigger left on users. Expect 0 rows.
SELECT tgname
  FROM pg_trigger
 WHERE tgrelid = 'public.users'::regclass
   AND NOT tgisinternal
   AND tgname = 'users_touch_synced_at';

-- V2. Every remaining touch_synced_at trigger is on a table that really has
--     the column. Expect 8 rows, all has_column = true.
SELECT c.relname AS table_name,
       t.tgname,
       EXISTS (
         SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name   = c.relname
            AND col.column_name  = '_synced_at'
       ) AS has_column
  FROM pg_trigger t
  JOIN pg_class   c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal
   AND t.tgfoid = 'public.touch_synced_at'::regproc
 ORDER BY c.relname;

-- V3. Jordan Foley mirrored in. Expect 1 row.
SELECT user_id, display_name, email, is_active, first_seen_at, last_seen_at
  FROM public.users
 WHERE email = 'jfoley@roseandco.com';

-- V4. sync_errors has stopped logging the failure. Expect no rows newer than
--     the sync you just ran.
SELECT created_at, entity_name, dynamics_id, error_message
  FROM public.sync_errors
 WHERE error_message ILIKE '%_synced_at%'
 ORDER BY created_at DESC
 LIMIT 20;

-- =============================================================================
-- Patch: reconcile mirror-table DDL with what the sync mappers actually write
-- Date: 2026-09-09
--
-- SAFE TO RUN, AND EXPECTED TO BE A NO-OP AGAINST THE LIVE DATABASE.
--   Every column below already exists live -- that is precisely why the daily
--   sync succeeds. lib/sync/run.ts upserts each mapped object straight into its
--   table with no key filtering, so a column the mapper writes but the table
--   lacks would fail every row of that entity and fill sync_errors. accounts and
--   meetings sync clean, therefore live has all 26 of these.
--
--   The DRIFT was one-directional: sql/01_mirror_tables.sql had fallen behind the
--   mappers. This patch exists so any OTHER environment -- a staging project, a
--   local Postgres, or a database rebuilt from sql/ -- ends up with the same
--   shape. ADD COLUMN IF NOT EXISTS makes it re-runnable anywhere.
--
-- WHAT WAS OUT OF SYNC (mapper writes it, DDL did not declare it):
--   accounts   24 columns  -- 10 workflow booleans, 6 milestone dates,
--                             2 lookups (id+name each), 4 free-text fields
--   meetings    2 columns  -- feedback_id / feedback_name, the bcs_feedback
--                             assignee. This is the case that started the sweep:
--                             v_feedback_outstanding and v_admin_meetings_all
--                             both read that person out of _raw precisely
--                             because the column was not in this file.
--   Every other mirror table (users, touchpoints, client_notes, contracts,
--   tasks, new_vacationrequest, events) was already in agreement.
--
-- NOT INCLUDED HERE, because they are not sync columns and must not be added by
-- a sync-reconciliation patch:
--   accounts.ai_summary / ai_summary_generated_at   Rose-owned AI summary cache
--   users.first_seen_at, *._synced_at               DEFAULT-populated
--   events.sharepoint_url                           Rose-owned -- but see
--                                                   SECTION B: it turns out this
--                                                   column does not exist live.
--
-- SECTION A below is the no-op reconciliation described above. SECTION B at the
-- end is a REAL change to the live database and is opt-in -- read it first.
--
-- SEPARATE, AND NOT FIXABLE BY THIS PATCH -- sql/15_ooo_table.sql created
--   public.ooo, but the sync writes public.new_vacationrequest and every view and
--   page reads that name. The repo file has been corrected; the live database
--   already has the right table, so there is nothing to ALTER. Worth confirming
--   with the verification query below that no stray public.ooo exists.
--
-- TYPES were inferred from the mapper helper that populates each column
-- (parseDt -> timestamptz, bool -> boolean, lookupId -> uuid, str/fv -> text).
-- If the live column type differs, the live one wins -- ADD COLUMN IF NOT EXISTS
-- will not alter an existing column, so a mismatch is invisible here. The
-- verification query below is what surfaces it.
--
-- NO foreign keys on the two new *_id columns, deliberately. meetings.host_id
-- and booker_id carry REFERENCES public.users, but these were added live without
-- one, and an FK would reject any row whose lookup target is missing from the
-- mirror.
-- =============================================================================

-- accounts (24 columns)
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS bda_peers                        boolean;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS calendar                         boolean;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS calendar_confirmed               boolean;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS distro                           boolean;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS meeting_history_received         boolean;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS mgmt_review                      boolean;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS recurring_call_scheduled         boolean;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS report                           boolean;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS rep_short_interest               boolean;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS sh_report                        boolean;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS current_event_id                 uuid;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS current_event_name               text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS current_project_id               uuid;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS current_project_name             text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS last_data_upload                 timestamptz;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS onboarding_call                  timestamptz;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS original_start_date              timestamptz;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS shareholder_report_received_date timestamptz;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS teach_in                         timestamptz;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS teach_in_date                    timestamptz;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS dietary_restrictions             text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS ipreo_ticker                     text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS onboarding_notes                 text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS peers                            text;

-- meetings (2 columns)
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS feedback_id   uuid;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS feedback_name text;


-- =============================================================================
-- VERIFICATION -- run this and report the output back.
--
-- This patch only closes the MAPPER -> DDL direction, which is the confirmed
-- problem. It cannot see the opposite case: columns that exist in the live
-- database but are written by no mapper and declared in no DDL file (orphans
-- from an out-of-band ALTER, a dropped feature, or an older schema).
--
-- Query 1 -- every column of every mirror table, live.
-- =============================================================================
SELECT c.table_name,
       c.ordinal_position,
       c.column_name,
       c.data_type,
       c.is_nullable,
       c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN (
    'accounts', 'users', 'meetings', 'touchpoints', 'client_notes',
    'contracts', 'tasks', 'new_vacationrequest', 'events'
  )
ORDER BY c.table_name, c.ordinal_position;

-- Query 2 -- compact per-table column counts, to diff against the repo quickly.
SELECT table_name, count(*) AS live_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'accounts', 'users', 'meetings', 'touchpoints', 'client_notes',
    'contracts', 'tasks', 'new_vacationrequest', 'events'
  )
GROUP BY table_name
ORDER BY table_name;

-- Query 3 -- is there a stray public.ooo left over from the old DDL file name?
-- Expect ZERO rows. Any row means a rebuild created it and it is dead weight.
SELECT table_name,
       (SELECT count(*) FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = t.table_name) AS cols
FROM information_schema.tables t
WHERE t.table_schema = 'public' AND t.table_name = 'ooo';

-- =============================================================================
-- Query 4 -- SCHEMA FINGERPRINT (preferred: 9 rows instead of ~600)
--
-- Query 1 returns a row per column, which is too much to read back. This hashes
-- each table's sorted column list instead, so one short row per table settles
-- whether the repo DDL and the live database agree -- in BOTH directions at
-- once. A matching hash means the column SETS are identical (ordering and types
-- are not part of the hash).
--
-- EXPECTED, computed from the reconciled repo DDL on 2026-09-09:
--
--   accounts              85  155309f7fda2732c7a6d6019efdc6670   [CONFIRMED MATCH]
--   users                  6  3923f35f23f29d33d0a8331d1aa90e53
--   meetings              52  275d5389d645a8fa09721dd97f1bf592
--   touchpoints           26  8625edb49e1e8df69fdfbc53ae1a704f
--   client_notes          20  eafdda8a8c7cbebb1bc4c0e3f267676f
--   contracts             44  30dbc62b6e2a8b4240b6c9f21387d763
--   tasks                 87  4fa3e336a0b988e81b89dca92cbb305b
--   new_vacationrequest   30  178cbf474a356872a86d31c6a68caa56
--   events               138  0e873e73c478bb9aedab7b601c29f117
--
-- accounts was verified column-by-column against a live information_schema dump
-- on 2026-09-09: 85 live vs 85 declared, no orphans in either direction.
--
-- If a hash differs, re-run Query 1 filtered to that ONE table to see which
-- columns diverge.
-- =============================================================================
SELECT table_name,
       count(*)                                                   AS cols,
       md5(string_agg(column_name, ',' ORDER BY column_name))     AS fingerprint
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'accounts', 'users', 'meetings', 'touchpoints', 'client_notes',
    'contracts', 'tasks', 'new_vacationrequest', 'events'
  )
GROUP BY table_name
ORDER BY table_name;


-- =============================================================================
-- SECTION B -- events.sharepoint_url  (NOT a no-op: this ADDS a column live)
--
-- Found by the Query 4 fingerprint check on 2026-09-09. Eight of nine mirror
-- tables matched the repo exactly. events did not:
--
--     repo DDL  138 columns   0e873e73c478bb9aedab7b601c29f117
--     live      137 columns   7422f6e32e27a2135fa15781d949075c
--
-- The single difference is `sharepoint_url`, and it runs the OPPOSITE way to
-- everything in Section A: the repo declares a column the live database does not
-- have. It is not a sync column -- no mapper writes it -- so the daily sync never
-- had a reason to fail over it, which is why it went unnoticed.
--
-- CONSEQUENCE TODAY: the Profiles page's SharePoint document link is silently
-- inert in production.
--   * sql/03_views.sql's v_profiles_upcoming selects
--     `e.sharepoint_url AS event_sharepoint_url`, so the LIVE view cannot have
--     that column either -- it must still be an older revision, because the view
--     could not have been created against a table lacking the column.
--   * app/profiles/page.tsx reads the view with .select("*"), so the field comes
--     back undefined rather than erroring, and profiles-view.tsx renders
--     `row.event_sharepoint_url?.trim()` as a muted placeholder icon.
--   Nothing is broken. The feature has simply never been able to work.
--
-- TO ENABLE IT, run both statements below, in order. Adding the column first is
-- required: the view cannot be replaced while the column is missing.
-- Both are safe to skip if the SharePoint link is not wanted -- in which case
-- delete sharepoint_url from sql/16_events_table.sql and the select from
-- v_profiles_upcoming instead, so the repo stops claiming a feature that is off.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS sharepoint_url text;

-- Then re-run the v_profiles_upcoming block from sql/03_views.sql (it is a
-- CREATE OR REPLACE and event_sharepoint_url is its LAST column, so replacing it
-- only ADDS a trailing column -- Postgres allows that).
--
-- Verify afterwards: this should return one row.
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'v_profiles_upcoming'
--     AND column_name = 'event_sharepoint_url';
-- =============================================================================

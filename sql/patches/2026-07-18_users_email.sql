-- =============================================================================
-- Patch: add users.email (Office 365 mailbox) for calendar free/busy lookups
-- Date: 2026-07-18
--
-- Adds a nullable email column to public.users, populated by the sync from the
-- Dynamics systemuser field `internalemailaddress` (see lib/sync/mappers.ts →
-- mapSystemUser). This is the durable source of truth for host → mailbox
-- mapping used by all Microsoft Graph calendar features (lib/graph/hosts.ts).
--
-- Nullable on purpose: system/application accounts (e.g. CRM Administration)
-- and some deactivated ex-employees have no mailbox. Those hosts are skipped
-- cleanly ("no calendar available") — never queried against Graph.
--
-- Idempotent: safe to run more than once. Paste into the Supabase SQL Editor.
-- Source of truth for the base schema: sql/01_mirror_tables.sql
-- =============================================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email text;

COMMENT ON COLUMN public.users.email IS
  'Office 365 mailbox (Dynamics systemuser.internalemailaddress). Nullable: '
  'system/app accounts and some ex-employees have none. Source of truth for '
  'host->email in Microsoft Graph calendar features.';

-- Existing rows are NOT backfilled by this DDL. The sync only refreshes users
-- it re-fetches, and the systemusers pull is incremental. To fill every
-- existing row in one pass, force a full re-pull by resetting that entity's
-- watermark, then run the sync (Vercel cron / the admin "Run sync now" button):
--
--   DELETE FROM public.sync_runs WHERE entity_name = 'systemusers';
--
-- (Run that only when you're ready to trigger the backfill sync.)

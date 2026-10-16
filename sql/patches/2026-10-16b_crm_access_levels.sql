-- =============================================================================
-- Patch: CRM access levels (None / View / Edit / Manage) for the four primary
--        CRM tables — Clients (/accounts), Events, Meetings, Contacts
-- Date:  2026-10-16
--
-- WHY
--   Each of the four tables gets a per-role and per-person ACCESS LEVEL
--   (lib/access/crm-levels-policy.ts):
--     none    no access
--     view    list, filters, export, saved views, read-only drawer — exactly
--             today's boolean page grant
--     edit    + edit existing dashboard-created records
--     manage  + create, delete / purge test records, change protected fields
--   Super users and admins are implicitly Manage in code (never stored).
--
-- STORAGE — the EXISTING grant tables (no parallel system):
--   role_page_access.crm_level   refines `allowed` (which stays the view bit
--                                every reader uses; allowed=false ⇒ none).
--   user_page_grants.crm_level   a row = at least View; crm_level raises it.
--   Effective level = the HIGHER of the role's and the person's (raise-only).
--
-- CONSERVATIVE SEED (status quo on deploy): every existing grant of the four
--   routes becomes exactly 'view'. NO 'edit' or 'manage' is seeded for any
--   role or person, so nobody but super users / admins can write until
--   granted in Admin → Roles / Admin → Users → Pages.
--
-- ORDER: safe before or after the code ships. Until it runs, every grant
--   reads as View (the code selects * and treats a missing level as View) and
--   the new Edit / Manage dropdown choices refuse to save (they say so).
--
-- Safe to re-run.
-- =============================================================================

-- ---- columns -----------------------------------------------------------------
ALTER TABLE public.role_page_access
  ADD COLUMN IF NOT EXISTS crm_level text;

ALTER TABLE public.user_page_grants
  ADD COLUMN IF NOT EXISTS crm_level text;

-- Valid values only (NULL allowed: every other route never carries a level).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_page_access_crm_level_check') THEN
    ALTER TABLE public.role_page_access
      ADD CONSTRAINT role_page_access_crm_level_check
      CHECK (crm_level IS NULL OR crm_level IN ('none', 'view', 'edit', 'manage'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_page_grants_crm_level_check') THEN
    -- A person row is itself a View grant; 'none' is never stored (the row is deleted).
    ALTER TABLE public.user_page_grants
      ADD CONSTRAINT user_page_grants_crm_level_check
      CHECK (crm_level IS NULL OR crm_level IN ('view', 'edit', 'manage'));
  END IF;
END $$;

COMMENT ON COLUMN public.role_page_access.crm_level IS
  'CRM access level for /accounts, /events, /meetings, /contacts only: none | view | edit | manage. allowed stays the view bit (allowed=false ⇒ none). See lib/access/crm-levels-policy.ts.';
COMMENT ON COLUMN public.user_page_grants.crm_level IS
  'CRM access level for /accounts, /events, /meetings, /contacts only: view | edit | manage (the row itself is View). Effective = higher of role and person. See lib/access/crm-levels-policy.ts.';

-- ---- conservative seed: every existing grant → exactly View ------------------
UPDATE public.role_page_access
   SET crm_level = CASE WHEN allowed THEN 'view' ELSE 'none' END
 WHERE route IN ('/accounts', '/events', '/meetings', '/contacts')
   AND crm_level IS NULL;

UPDATE public.user_page_grants
   SET crm_level = 'view'
 WHERE route IN ('/accounts', '/events', '/meetings', '/contacts')
   AND crm_level IS NULL;

-- ---- check (read-only): expect only 'view' / 'none', and zero edit / manage ---
-- SELECT 'role' AS src, crm_level, count(*) FROM public.role_page_access
--  WHERE route IN ('/accounts','/events','/meetings','/contacts') GROUP BY crm_level
-- UNION ALL
-- SELECT 'person', crm_level, count(*) FROM public.user_page_grants
--  WHERE route IN ('/accounts','/events','/meetings','/contacts') GROUP BY crm_level;

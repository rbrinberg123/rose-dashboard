-- 2026-09-22_clients_alerts_grants.sql
-- Grant the new Clients → Alerts page (/clients/alerts) to the non-super roles.
--
-- WHY A PATCH IS NEEDED AT ALL
--   Page access is deny-by-default: canAccessRoute only allows a route that has
--   an `allowed = true` row in role_page_access for the viewer's role, and the
--   match is SEGMENT-AWARE — so the existing '/clients/to-do' grant does NOT
--   cover '/clients/alerts'. Until this runs, only a super_user (the hard code
--   backstop) can open the page, and nobody else even sees the nav link.
--
-- WHY THESE FOUR ROLES
--   Alerts is a PERSONAL worklist. Its loader row-scopes every section to the
--   viewer — sections 1 and 5 to the viewer themself, sections 2-4 to the
--   clients where the viewer holds one of the six account-team roles. So this
--   grant decides only WHO MAY OPEN THE PAGE; it can never widen whose alerts
--   they see. A person with no assignments sees five empty cards.
--
--   That is why client_manager is included even though it holds no /feedback-*
--   page grants today: an account manager is exactly the person who should be
--   chased about their clients' pending feedback reports. If Rose disagrees,
--   untick the box in Admin → Roles — no code change, no redeploy.
--
--   super_user is deliberately absent: it is a hard backstop in code and is
--   never written to this table.
--
-- SAFE TO RE-RUN (ON CONFLICT DO UPDATE).
--
-- Run once in the Supabase SQL editor.
-- See dashboard/content/docs/21-alerts.md and 01-access-and-users.md.

INSERT INTO public.role_page_access (role, route, allowed)
SELECT r.role, '/clients/alerts', true
FROM (VALUES ('user'), ('associate'), ('client_manager'), ('logistics')) AS r(role)
ON CONFLICT (role, route) DO UPDATE SET allowed = EXCLUDED.allowed;

-- Verify: expect four rows, all allowed = true.
-- SELECT role, route, allowed
-- FROM public.role_page_access
-- WHERE route = '/clients/alerts'
-- ORDER BY role;

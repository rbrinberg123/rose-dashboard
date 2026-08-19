-- ===========================================================================
-- 21_financials_permission.sql
--
-- Adds the independent "Financials" DATA PERMISSION.
--
-- Financials is a FIELD-level grant, orthogonal to row scoping:
--   * row scoping (scope_all / account_mgmt / booker / host / feedback) decides
--     WHICH clients and meetings a person sees;
--   * financials decides whether those rows' DOLLAR figures are sent at all
--     (Portfolio's Retainer column + contract-document link; Client Detail's
--     Annualized Retainer and $ per Meeting KPIs).
--
-- Deny-by-default. Super Users are always granted (in code — never written
-- here, so activating the permission can never lock a super out).
--
-- Run this ONCE in the Supabase SQL editor. Safe to re-run.
-- ===========================================================================

-- 1. Per-PERSON grant — the "Financials" checkbox on Admin → Users.
--    Lives on the existing data-scope row so one read serves both.
ALTER TABLE public.user_data_scopes
  ADD COLUMN IF NOT EXISTS financials boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_data_scopes.financials IS
  'FIELD-level grant (NOT a row scope): may this person see retainer / fee '
  'dollar figures? Read by canSeeFinancials (dashboard/lib/access/financials.ts). '
  'Deny-by-default; Super Users are granted in code and never rely on this row.';

-- 2. Per-ROLE grant — the "Financials" row in the Data permissions section of
--    Admin → Roles. Reuses public.role_page_access; the key is stored in the
--    `route` column with a `data:` prefix so it can never collide with a real
--    page route (getAllowedRoutes filters its result through the page registry,
--    so this row is never mistaken for a navigable page).
--
--    No DDL needed — role_page_access already exists. Nothing is inserted here:
--    every role starts UNGRANTED (deny-by-default) and a super-user ticks the
--    boxes in the matrix.
--
--    OPTIONAL seed — uncomment to grant Financials to a role up front, e.g.
--    Client Manager:
--
-- INSERT INTO public.role_page_access (role, route, allowed)
-- VALUES ('client_manager', 'data:financials', true)
-- ON CONFLICT (role, route) DO UPDATE SET allowed = EXCLUDED.allowed;

-- 3. Verify.
-- SELECT email, scope_all, account_mgmt, financials FROM public.user_data_scopes ORDER BY email;
-- SELECT role, route, allowed FROM public.role_page_access WHERE route LIKE 'data:%';

-- =============================================================================
-- Patch: account_status — a dashboard-owned Active/Inactive flag per client,
--        seeded from the CRM's Dynamics state.
-- Date: 2026-09-15
--
-- CREATES
--   1. public.account_status   -- the owned flag (one row per account)
--   2. A re-runnable seed from accounts.state_label
--   3. Reporting queries
--
-- ⚠️  SETUP ONLY — THIS CHANGES NO CURRENT BEHAVIOUR.
--     The ONLY reader and writer of this table is the Active/Inactive toggle on
--     /admin/account-teams. It does not filter, hide, or change anything
--     anywhere: not Portfolio, not To-Do / Outreach Status, not Onboarding, not
--     the CRM tables, not scoping, and it is in no query's WHERE clause.
--
-- ── WHICH CRM FIELD, AND WHY IT MATTERS THAT WE DID NOT TOUCH IT ───────────
--
--   SOURCE FIELD: public.accounts.state_label  ('Active' | 'Inactive')
--                 equivalently state_code (0 = Active, 1 = Inactive)
--   Live split: Active 106 / Inactive 122, over 228 accounts.
--
--   accounts.status_label is perfectly redundant with it — the same 106/122
--   split, statuscode 1/2 tracking statecode 0/1 exactly — so either would do
--   and state_label is the canonical Dynamics one.
--
--   accounts.client_status_label is NOT the same thing and was NOT used. It is a
--   Rose business field (Current 89 / Past 71 / null 68) and it disagrees with
--   the Dynamics state on 33 accounts:
--       Inactive | Current  -> 32
--       Active   | Past     ->  1
--   Seeding from it would have produced a different — and wrong — answer.
--
--   There is no accounts.is_active column; the brief's "state_label / is_active"
--   resolves to state_label.
--
--   ⚠️  accounts.state_label IS LOAD-BEARING TODAY. `WHERE state_label = 'Active'`
--   appears in roughly fifteen places in sql/03_views.sql (v_client_portfolio and
--   friends) and in app/institution-style/page.tsx. THIS PATCH TOUCHES NONE OF
--   THEM. The owned flag below is a PARALLEL COPY that nothing reads yet; the
--   CRM field remains the source of truth for every existing filter, and will
--   remain so until Rose starts editing here and a separate, deliberate change
--   switches those readers over. Do not "reconcile" the two by pointing an
--   existing view at this table as a drive-by.
--
-- SAFE TO RE-RUN.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. public.account_status
--
--    ONE ROW PER ACCOUNT — account_id is the PRIMARY KEY, not just a foreign
--    key. A client has exactly one active/inactive state, so the uniqueness is
--    the point and it makes the seed a plain ON CONFLICT upsert.
--
--    Kept as its own table rather than a column on account_team_members: that
--    table is per (account, role) and would carry the flag once per role, with
--    six chances to disagree with itself. There is no other owned
--    accounts-overlay table to extend — the other owned tables keyed on an
--    account (client_direct_costs, overhead_overrides, revenue_overrides) are
--    all per-period financial records, not per-account attributes.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_status (
  account_id  uuid PRIMARY KEY REFERENCES public.accounts(account_id) ON DELETE CASCADE,

  -- The owned flag. NOT NULL: every row states a position. "No opinion" is the
  -- ABSENCE of a row, which is what lets the seed fill blanks.
  is_active   boolean NOT NULL,

  -- 'crm_seed' — written by the seed below, and re-writable by it.
  -- 'manual'   — set by a human on /admin/account-teams. The seed never
  --              overwrites one of these.
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('crm_seed', 'manual')),

  -- When the flag last changed, and who changed it. 'crm_seed' for seeded rows.
  changed_at  timestamptz NOT NULL DEFAULT now(),
  changed_by  text
);

-- "Show me the inactive ones" / "what have humans overridden" — the two reads
-- the page does, and the shape any future consumer would want.
CREATE INDEX IF NOT EXISTS idx_account_status_is_active
  ON public.account_status (is_active);

CREATE INDEX IF NOT EXISTS idx_account_status_source
  ON public.account_status (source);

-- No touch_updated_at trigger here: `changed_at` is not a generic row-touch
-- timestamp, it is "when the STATUS changed". The server action sets it
-- explicitly so a no-op save does not look like a change.

-- RLS on, zero policies => only service_role reaches it. The anon key that
-- ships in the browser gets nothing. Authorisation lives in the server action.
ALTER TABLE public.account_status ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_status TO service_role;


-- ---------------------------------------------------------------------------
-- 2. THE RE-RUNNABLE SEED
--
--    One upsert. The WHERE on the DO UPDATE branch is the whole safety story:
--    a row a human has set to 'manual' is matched by the conflict, then the
--    update is filtered out — so it is neither inserted nor modified.
--
--    Re-running after a CRM change updates every crm_seed row to the CRM's
--    current state and leaves manual rows untouched. Re-running with no change
--    rewrites the same value and bumps changed_at on crm_seed rows only.
-- ---------------------------------------------------------------------------

INSERT INTO public.account_status (account_id, is_active, source, changed_at, changed_by)
SELECT
  a.account_id,
  -- THE MAPPING: Dynamics 'Active' -> true, anything else -> false.
  -- state_label is NOT NULL on all 228 live rows; COALESCE guards a future null
  -- by treating an unknown state as inactive rather than silently active.
  COALESCE(a.state_label, '') = 'Active',
  'crm_seed',
  now(),
  'crm_seed'
FROM public.accounts a
ON CONFLICT (account_id) DO UPDATE
   SET is_active  = EXCLUDED.is_active,
       changed_at = now(),
       changed_by = 'crm_seed'
 -- NEVER overwrite a human's edit.
 WHERE public.account_status.source = 'crm_seed';


-- ---------------------------------------------------------------------------
-- 3. REPORTS — run these after the seed
-- ---------------------------------------------------------------------------

-- What landed, and whether it agrees with the CRM.
--   SELECT s.source, s.is_active, count(*)
--     FROM public.account_status s GROUP BY 1,2 ORDER BY 1,2;
--     -- expected after a first seed: crm_seed/true 106, crm_seed/false 122

-- The seed is correct iff this returns ZERO rows (before anyone edits).
--   SELECT a.name, a.state_label, s.is_active, s.source
--     FROM public.accounts a JOIN public.account_status s USING (account_id)
--    WHERE s.source = 'crm_seed'
--      AND s.is_active <> (COALESCE(a.state_label,'') = 'Active');

-- Every account has a row.
--   SELECT (SELECT count(*) FROM public.accounts)       AS accounts,
--          (SELECT count(*) FROM public.account_status) AS status_rows;   -- 228 / 228

-- Human overrides, and where they disagree with the CRM — the report that
-- matters once people start using the toggle.
--   SELECT a.name, a.state_label AS crm_state, s.is_active AS owned_active,
--          s.changed_by, s.changed_at
--     FROM public.account_status s
--     JOIN public.accounts a USING (account_id)
--    WHERE s.source = 'manual'
--    ORDER BY s.changed_at DESC;

-- PROOF THE OWNED FLAG IS NOT WIRED IN: the CRM field still drives everything.
-- v_client_portfolio filters accounts.state_label = 'Active' and knows nothing
-- about account_status, so its count must not move when someone toggles.
--   SELECT count(*) FROM public.v_client_portfolio;   -- unchanged by any toggle

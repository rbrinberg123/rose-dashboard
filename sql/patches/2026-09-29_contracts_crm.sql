-- =============================================================================
-- Patch: CRM -> Contract Management (dashboard-authored contracts)
-- Date:  2026-09-29
--
-- WHY
--   Adds Admin -> Contract Management, /admin/contracts (moved from the CRM
--   nav 2026-09-30), on the same machinery as Notes / Clients: a list view, a filter-
--   options view and a saved-views table, plus the dashboard-authored columns
--   the create/edit form writes. No real contracts are entered yet; testing is
--   confined to the ZZ - Test Client (ZVZZT) with is_test = true.
--
-- WHAT
--   Part A  Dashboard-authored columns on public.contracts (ADD COLUMN IF NOT
--           EXISTS; no existing Dynamics-mirror column is altered). Two already
--           exist on the mirror and are REUSED as-is by IF NOT EXISTS:
--           quarterly_retainer (numeric) and notes (text). auto_renew also
--           exists (boolean, no default) -- left untouched; the form defaults
--           it to No.
--           The sync (lib/sync/mappers.ts mapContract) never writes these new
--           columns, so Dynamics rows keep NULL in them.
--   Part B  term_end / notice_date: GENERATED ALWAYS ... STORED from the BASE
--           columns only. Uses make_interval() rather than the
--           (n || ' months')::interval string cast: the string cast is only
--           STABLE (anytextcat + interval_in), and Postgres refuses a
--           generation expression that is not IMMUTABLE. Same arithmetic.
--   Part C  CHECK constraints for contract_status / currency / scope. The value
--           lists MUST match lib/contracts/create.ts (CONTRACT_STATUS,
--           CONTRACT_CURRENCY, CONTRACT_SCOPE). The scope list is a
--           PLACEHOLDER: to change it, edit BOTH places and re-run Part C.
--           NULL passes a CHECK, so every Dynamics row (NULL here) is fine.
--   Part D  v_admin_contracts_all -- one row per contract. For DISPLAY, each
--           field falls back to its Dynamics-mirror twin when the dashboard
--           column is NULL, so the 392 synced contracts read sensibly. Dashboard
--           rows show exactly what was typed.
--   Part E  v_admin_contracts_filter_options (read FROM the view above, so the
--           dropdowns always match the list).
--   Part F  contract_saved_views -- same shape as note_saved_views.
--
-- NOT TOUCHED
--   The ownership fence is ALREADY in place for contracts
--   (sql/patches/2026-09-23_origin_ownership_fence.sql: origin + is_test,
--   contracts_lock_origin trigger, fenced touch_synced_at; hasOrigin: true in
--   lib/sync/entities.ts). Nothing here re-creates it -- see CHECK 1 below.
--   No reporting view (Portfolio, Margin, v_contract_management, Client
--   Statistics, Onboarding ...) is changed: they read only the Dynamics
--   columns, so dashboard contracts do not reach them until a deliberate
--   cutover step.
--
-- ORDER: run this BEFORE the /admin/contracts code deploys. Safe to re-run.
-- =============================================================================


-- ---- PART A -- dashboard-authored columns -----------------------------------
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS contract_name           text,
  ADD COLUMN IF NOT EXISTS account_id              uuid REFERENCES public.accounts(account_id),
  ADD COLUMN IF NOT EXISTS scope                   text,
  ADD COLUMN IF NOT EXISTS termination_notice_days integer,
  ADD COLUMN IF NOT EXISTS start_date              date,
  ADD COLUMN IF NOT EXISTS term_length_months      integer,
  ADD COLUMN IF NOT EXISTS auto_renew              boolean DEFAULT false,  -- exists: skipped
  ADD COLUMN IF NOT EXISTS referral_source         text,
  ADD COLUMN IF NOT EXISTS notes                   text,                   -- exists: skipped
  ADD COLUMN IF NOT EXISTS contract_status         text,
  ADD COLUMN IF NOT EXISTS termination_date        date,
  ADD COLUMN IF NOT EXISTS termination_reason      text,
  ADD COLUMN IF NOT EXISTS renewal_date            date,
  ADD COLUMN IF NOT EXISTS quarterly_retainer      numeric(14,2),          -- exists: skipped
  ADD COLUMN IF NOT EXISTS currency                text,
  -- RESERVED, DEFERRED: no upload/download is built yet.
  ADD COLUMN IF NOT EXISTS contract_document       text;

CREATE INDEX IF NOT EXISTS idx_contracts_account_id ON public.contracts (account_id);


-- ---- PART B -- calculated columns (read-only, DB-generated) -----------------
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS term_end date GENERATED ALWAYS AS (
    CASE WHEN start_date IS NOT NULL AND term_length_months IS NOT NULL
         THEN (start_date + make_interval(months => term_length_months))::date
    END
  ) STORED,
  ADD COLUMN IF NOT EXISTS notice_date date GENERATED ALWAYS AS (
    CASE WHEN start_date IS NOT NULL AND term_length_months IS NOT NULL
              AND termination_notice_days IS NOT NULL
         THEN (start_date + make_interval(months => term_length_months)
                          - make_interval(days => termination_notice_days))::date
    END
  ) STORED;


-- ---- PART C -- allowed values (mirror lib/contracts/create.ts) --------------
ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_contract_status_check;
ALTER TABLE public.contracts ADD CONSTRAINT contracts_contract_status_check
  CHECK (contract_status IN ('Draft','Active','Renewed','Expired','Terminated'));

ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_currency_check;
ALTER TABLE public.contracts ADD CONSTRAINT contracts_currency_check
  CHECK (currency IN ('USD','GBP','EUR'));

-- PLACEHOLDER list -- the client will replace it.
ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_scope_check;
ALTER TABLE public.contracts ADD CONSTRAINT contracts_scope_check
  CHECK (scope IN ('Corporate Access','Investor Perception','Advisory Retainer','Project','Other'));


-- ---- PART D -- the list view ------------------------------------------------
-- Dates are lifted to EASTERN MIDNIGHT (as v_admin_notes_all does) so the
-- shared date-filter grammar, which resolves to Eastern-midnight instants, does
-- not drop the boundary day. No _raw.
CREATE OR REPLACE VIEW public.v_admin_contracts_all AS
SELECT
  c.contract_id,

  -- ---- contract ----
  COALESCE(NULLIF(btrim(c.contract_name), ''), NULLIF(btrim(c.name), ''))
                                                      AS contract_name,
  COALESCE(c.contract_status, NULLIF(btrim(c.contract_status_label), ''))
                                                      AS contract_status,
  COALESCE(c.scope, NULLIF(btrim(c.scope_label), '')) AS scope,
  NULLIF(btrim(c.referral_source), '')                AS referral_source,
  NULLIF(btrim(c.notes), '')                          AS notes,

  -- ---- client ----
  COALESCE(c.account_id, c.client_account_id)         AS account_id,
  COALESCE(a.name, c.client_account_name)             AS client_name,
  a.ticker_symbol                                     AS client_ticker,

  -- ---- term ----
  (COALESCE(c.start_date, c.contract_start_date)::timestamp
     AT TIME ZONE 'America/New_York')                 AS start_date,
  COALESCE(
    c.term_length_months,
    CASE WHEN c.initial_term_length_label ~ '^[0-9]+ Months?$'
         THEN substring(c.initial_term_length_label FROM '^[0-9]+')::int END
  )                                                   AS term_length_months,
  (COALESCE(c.term_end, c.initial_term_end)::timestamp
     AT TIME ZONE 'America/New_York')                 AS term_end,
  COALESCE(
    c.termination_notice_days,
    CASE WHEN c.termination_notice_days_label ~ '^[0-9]+$'
         THEN c.termination_notice_days_label::int END
  )                                                   AS termination_notice_days,
  (COALESCE(c.notice_date, c.renewal_notice_date)::timestamp
     AT TIME ZONE 'America/New_York')                 AS notice_date,
  c.auto_renew,
  (COALESCE(c.renewal_date, c.contract_renewal_date)::timestamp
     AT TIME ZONE 'America/New_York')                 AS renewal_date,

  -- ---- money ----
  c.quarterly_retainer,
  c.currency,

  -- ---- termination ----
  (COALESCE(c.termination_date, c.contract_termination_date)::timestamp
     AT TIME ZONE 'America/New_York')                 AS termination_date,
  COALESCE(NULLIF(btrim(c.termination_reason), ''),
           NULLIF(btrim(c.reason_for_termination_label), ''))
                                                      AS termination_reason,

  -- ---- document (reserved) ----
  c.contract_document,

  -- ---- system ----
  c.origin,
  c.is_test,
  c.created_by_id,
  c.created_by_name                                   AS created_by,
  c.modified_by_name,
  c.created_on                                        AS created_at,
  c.modified_on                                       AS updated_at
FROM public.contracts c
LEFT JOIN public.accounts a ON a.account_id = COALESCE(c.account_id, c.client_account_id);

GRANT SELECT ON public.v_admin_contracts_all TO service_role;


-- ---- PART E -- quick-filter dropdown values ---------------------------------
CREATE OR REPLACE VIEW public.v_admin_contracts_filter_options AS
  SELECT 'client'::text AS kind, v.account_id::text AS value,
         min(v.client_name) AS label, count(*)::bigint AS contract_count
  FROM public.v_admin_contracts_all v
  WHERE v.account_id IS NOT NULL AND v.client_name IS NOT NULL
  GROUP BY 1, 2
  UNION ALL
  SELECT 'scope', v.scope, v.scope, count(*)
  FROM public.v_admin_contracts_all v WHERE v.scope IS NOT NULL GROUP BY 1, 2
  UNION ALL
  SELECT 'status', v.contract_status, v.contract_status, count(*)
  FROM public.v_admin_contracts_all v WHERE v.contract_status IS NOT NULL GROUP BY 1, 2
  UNION ALL
  SELECT 'currency', v.currency, v.currency, count(*)
  FROM public.v_admin_contracts_all v WHERE v.currency IS NOT NULL GROUP BY 1, 2
  UNION ALL
  SELECT 'autoRenew', v.auto_renew::text,
         CASE WHEN v.auto_renew THEN 'Yes' ELSE 'No' END, count(*)
  FROM public.v_admin_contracts_all v WHERE v.auto_renew IS NOT NULL GROUP BY 1, 2, 3;

GRANT SELECT ON public.v_admin_contracts_filter_options TO service_role;


-- ---- PART F -- saved views (same shape as note_saved_views) -----------------
CREATE TABLE IF NOT EXISTS public.contract_saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('system', 'personal')),
  owner_user_id uuid REFERENCES public.users(user_id),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  config        jsonb NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contract_saved_views_owner_matches_scope CHECK (
    (scope = 'system'   AND owner_user_id IS NULL) OR
    (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS contract_saved_views_one_personal_default
  ON public.contract_saved_views (owner_user_id)
  WHERE scope = 'personal' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS contract_saved_views_one_system_default
  ON public.contract_saved_views (scope)
  WHERE scope = 'system' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS contract_saved_views_personal_name
  ON public.contract_saved_views (owner_user_id, lower(btrim(name)))
  WHERE scope = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS contract_saved_views_system_name
  ON public.contract_saved_views (lower(btrim(name)))
  WHERE scope = 'system';

CREATE INDEX IF NOT EXISTS idx_contract_saved_views_scope_owner
  ON public.contract_saved_views (scope, owner_user_id);

DROP TRIGGER IF EXISTS contract_saved_views_touch_updated_at ON public.contract_saved_views;
CREATE TRIGGER contract_saved_views_touch_updated_at
  BEFORE UPDATE ON public.contract_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.contract_saved_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_saved_views TO service_role;


-- ---- CHECK IT ---------------------------------------------------------------
-- 1. The fence is in place (expect 1 row: contracts_lock_origin):
--    SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.contracts'::regclass AND tgname LIKE '%lock_origin';
--
-- 2. The calculated columns (expect 2028-01-01 | 2027-10-03):
--    SELECT (DATE '2026-01-01' + make_interval(months => 24))::date AS term_end,
--           (DATE '2026-01-01' + make_interval(months => 24)
--                              - make_interval(days => 90))::date AS notice_date;
--
-- 3. Every synced contract is in the view, all Dynamics (expect dynamics | 392-ish):
--    SELECT origin, count(*) FROM public.v_admin_contracts_all GROUP BY 1;
--
-- Then, from dashboard/:  node scripts/verify-contracts.mjs
--
-- ---- PURGE TEST CONTRACTS (manual equivalent of the page's button) ----------
-- DELETE FROM public.contracts WHERE origin = 'dashboard' AND is_test = true
-- RETURNING contract_id, contract_name;

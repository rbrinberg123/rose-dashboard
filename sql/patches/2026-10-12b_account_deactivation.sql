-- ===========================================================================
-- Patch: client DEACTIVATION sidecar columns on public.accounts.
-- Date:  2026-10-12
--
-- WHAT
--   Five DASHBOARD-OWNED columns on public.accounts recording a reversible
--   "deactivate client" action and its audit trail:
--
--     deactivated_at       timestamptz  set by Deactivate; cleared by Reactivate
--     deactivated_by       text         who deactivated (display name / email)
--     deactivation_reason  text         optional free text from the confirm
--     reactivated_at       timestamptz  stamped by Reactivate (kept afterwards)
--     reactivated_by       text         who reactivated
--
--   Written only by app/accounts/actions.ts (deactivateClient /
--   reactivateClient, and updateClient when the Edit form sets a deactivated
--   client back to Active). Gate: lib/accounts/deactivation-gate.ts.
--
-- WHY THE SYNC NEVER OVERWRITES THEM
--   The Dynamics sync (lib/sync/run.ts) upserts only the columns its mapper
--   produces (lib/sync/mappers.ts mapAccount). None of these five are mapped,
--   so an upsert leaves them as they are. They are also NOT on the Dynamics
--   side at all.
--
-- HOW "ACTIVE" WORKS (Option 2 — the pre-cutover shortcut)
--   Deactivate also sets state_label = 'Inactive' (+ state/status codes), and
--   Reactivate sets it back to 'Active'. Every existing view and query already
--   means `state_label = 'Active'` by "active client", so a deactivated client
--   drops out of all of them with NO view rewrite. This is only sound because
--   deactivation is limited to origin = 'dashboard' clients, whose state_label
--   the dashboard already owns. Option 1 (a generated is_active_effective
--   column + repointing the ~50 views) is the planned cutover follow-up. See
--   dashboard/content/docs/20-clients.md, "Deactivating a client".
--
-- COHERENCE BACKSTOP (trigger below)
--   Invariant: deactivated_at IS NOT NULL ⇒ state_label = 'Inactive'. The app
--   keeps it (Reactivate and the Edit form both clear the stamp when setting
--   Active). The trigger enforces it for any OTHER writer: a row saved as
--   non-Inactive while still stamped has its deactivation cleared and
--   reactivated_at stamped, so the flag and state_label can never drift.
--
-- Until this runs, Deactivate / Reactivate return "Deactivation needs the
-- 2026-10-12b account_deactivation SQL patch run first." and nothing else
-- changes. Run ONCE in the Supabase SQL editor. Safe to re-run.
-- ===========================================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS deactivated_at      timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by      text,
  ADD COLUMN IF NOT EXISTS deactivation_reason text,
  ADD COLUMN IF NOT EXISTS reactivated_at      timestamptz,
  ADD COLUMN IF NOT EXISTS reactivated_by      text;

COMMENT ON COLUMN public.accounts.deactivated_at IS
  'Dashboard-owned (not synced). When the client was deactivated; NULL = not '
  'deactivated. Non-null implies state_label = ''Inactive'' (trigger-enforced). '
  'Written by app/accounts/actions.ts deactivateClient.';
COMMENT ON COLUMN public.accounts.deactivated_by IS
  'Dashboard-owned (not synced). Who deactivated the client (display name or email).';
COMMENT ON COLUMN public.accounts.deactivation_reason IS
  'Dashboard-owned (not synced). Optional reason entered in the Deactivate confirm.';
COMMENT ON COLUMN public.accounts.reactivated_at IS
  'Dashboard-owned (not synced). When the client was last reactivated. Kept after '
  'reactivation as the audit trail; the full history is in audit_log.';
COMMENT ON COLUMN public.accounts.reactivated_by IS
  'Dashboard-owned (not synced). Who last reactivated the client.';

-- Small partial index: "which clients are deactivated" (the Client Detail
-- notice, and any future admin list).
CREATE INDEX IF NOT EXISTS idx_accounts_deactivated
  ON public.accounts (deactivated_at)
  WHERE deactivated_at IS NOT NULL;

-- ---- coherence backstop ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.accounts_deactivation_coherence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.deactivated_at IS NOT NULL
     AND COALESCE(NEW.state_label, '') <> 'Inactive' THEN
    NEW.deactivated_at      := NULL;
    NEW.deactivated_by      := NULL;
    NEW.deactivation_reason := NULL;
    NEW.reactivated_at      := now();
    NEW.reactivated_by      := COALESCE(NEW.reactivated_by, 'system (state set to ' || COALESCE(NEW.state_label, 'null') || ')');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.accounts_deactivation_coherence() IS
  'Keeps deactivated_at IS NOT NULL ⇒ state_label = ''Inactive''. A row saved as '
  'non-Inactive while still deactivated is treated as a reactivation. Patch 2026-10-12b.';

DROP TRIGGER IF EXISTS trg_accounts_deactivation_coherence ON public.accounts;
CREATE TRIGGER trg_accounts_deactivation_coherence
  BEFORE INSERT OR UPDATE OF state_label, deactivated_at ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.accounts_deactivation_coherence();

-- ---- verify ---------------------------------------------------------------
--   -- Every deactivated client is Inactive (expect 0 rows):
--   SELECT account_id, name, state_label, deactivated_at
--     FROM public.accounts
--    WHERE deactivated_at IS NOT NULL AND state_label <> 'Inactive';
--
--   -- Deactivated clients:
--   SELECT name, origin, deactivated_at, deactivated_by, deactivation_reason
--     FROM public.accounts WHERE deactivated_at IS NOT NULL ORDER BY deactivated_at DESC;

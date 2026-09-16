-- =============================================================================
-- Patch: account_team_members — the dashboard-owned account team, plus a
--        re-runnable seed from the CRM's account-level role fields.
-- Date: 2026-09-15
--
-- CREATES
--   1. public.account_team_members   -- the owned table (NOT a Dynamics mirror)
--   2. Indexes + the one-per-slot guard
--   3. A re-runnable CRM seed that never overwrites a manual edit
--   4. Two reporting queries: the field mapping, and any unmatched people
--
-- ⚠️  SETUP ONLY — THIS CHANGES NO CURRENT BEHAVIOUR.
--     Nothing reads this table except its own management page
--     (/admin/account-teams). It is NOT wired into teamAccountIds,
--     resolveClientScope, lib/access/*, lib/account-team.ts, or any CRM or
--     reporting page. The existing account-team avatar clusters on Portfolio,
--     Profiles and the Events table still read the four *_name columns straight
--     off public.accounts, exactly as before.
--
--     It is INTENDED to become the source of truth for account-team-based
--     visibility later. Leave it clean for that; wire nothing to it until that
--     is a deliberate, separately-reviewed change.
--
-- ── THE ROLE → CRM FIELD MAPPING (confirm this) ────────────────────────────
-- public.accounts carries exactly six systemuser lookups that name a person in
-- an account-team role. Five map by their obvious name; the sixth needed work.
--
--   role                CRM lookup (_raw)                  accounts column
--   ------------------  ---------------------------------  ----------------------------
--   account_manager     _bcs_salesleadprimary_value        sales_lead_primary_id
--   secondary_manager   _bcs_secondarymanager_value        secondary_manager_id
--   feedback_report     _bcs_feedbackreport_value          feedback_report_id
--   associate           _bcs_associate_value               associate_id
--   memo                _bcs_teaser_value                  teaser_id          <-- SEE BELOW
--   logistics           _bcs_logisticscoordinator_value    logistics_coordinator_id
--
--   MEMO = TEASER. There is NO "memo" field on public.accounts — all 403 _raw
--   keys were searched and none matches /memo/i. `teaser` is the only remaining
--   person-role lookup, and the evidence that it is the memo owner is strong:
--
--     * The repo already made this call once. lib/events/record.ts and
--       content/docs/13-events.md map the Events drawer's "Memo Date" /
--       "Memo Not Required" onto events.teaser_date / teaser_not_required,
--       flagged there as an assumption. Rose's CRM calls the artefact a teaser;
--       the dashboard calls it a memo.
--     * The people line up exactly. The owners of the 1,092 live tasks with
--       sub-type "Marketing Memo" are, by initials: YL 626, SW 140, MB 118,
--       GF 102, DC 78. The people holding accounts.teaser_id are Yan Lager 134,
--       Douglas Cooper 4, Marlowe Burke 4, Gary Farber 3, Simon Willcocks 2 —
--       the same five people, same dominant name.
--     * The alternative, _bcs_targeting_value, is Joseph Saggese on 128 of its
--       129 accounts (plus one CRM Administration). That is the targeting
--       analyst, not the memo writer.
--
--   If that is wrong, change ONE line: the `memo` branch of the seed's `crm`
--   CTE below, and re-run. Nothing else depends on it.
--
-- ── SEED FACTS (measured before writing this) ──────────────────────────────
--   801 assignments across 228 accounts. EVERY ONE resolves to a public.users
--   row — the accounts.*_id columns are already declared REFERENCES
--   public.users(user_id) and every value honours it, so there is NO name- or
--   email-matching step and NO unmatched people. The report at the bottom
--   returns zero rows; it is kept so a future CRM change that breaks this is
--   caught rather than silently dropped.
--
--     account_manager    158    secondary_manager   72
--     feedback_report    152    associate          136
--     memo               148    logistics          135
--
--   38 of those 801 point at people who are INACTIVE in public.users:
--   Shawna Giust (14), Gary Farber / Simon Willcocks / Douglas Cooper (18),
--   Victoria Kemp-Sesny / Rosa Trivigno (6). They are seeded anyway — they are
--   what the CRM currently says — and the management page shows them flagged as
--   inactive so they can be reassigned deliberately rather than vanishing.
--
-- SAFE TO RE-RUN. The seed is idempotent and never touches a manual edit.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. public.account_team_members
--
--    DASHBOARD-OWNED. This is not a Dynamics mirror: it has no _raw, no
--    _synced_at, and the sync never writes to it. sql/02_rose_owned_tables.sql
--    is its home in the base DDL.
--
--    ── WHY THERE IS NO UNIQUE (account_id, role) ──────────────────────────
--    The UI allows one assignee per (account, role) today, and that is enforced
--    in the server action, NOT in the schema. The schema deliberately permits
--    several people in one role so that "two associates on this account"
--    becomes a UI change rather than a migration + backfill. What the unique
--    index below prevents is only the meaningless case: the SAME person listed
--    twice in the SAME role on the SAME account.
--
--    If one-per-slot is ever wanted as a hard rule, add:
--      CREATE UNIQUE INDEX ... ON public.account_team_members (account_id, role);
--    and the seed's manual-edit guard still holds.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_team_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  account_id  uuid NOT NULL REFERENCES public.accounts(account_id) ON DELETE CASCADE,

  -- text + CHECK rather than a Postgres ENUM: adding a role to an enum needs
  -- ALTER TYPE (and cannot be done inside a transaction with other DDL on some
  -- versions), whereas widening a CHECK is a one-line change. Same choice the
  -- *_saved_views tables make for `scope`.
  role        text NOT NULL CHECK (role IN (
                'account_manager',
                'secondary_manager',
                'feedback_report',
                'associate',
                'memo',
                'logistics'
              )),

  -- The Rose employee. RESTRICT, not CASCADE: silently dropping a team
  -- assignment because a users row went away would be a quiet data loss.
  user_id     uuid NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,

  -- 'crm_seed' — written by the seed below, and re-writable by it.
  -- 'manual'   — set by a human on /admin/account-teams. The seed never touches
  --              a slot that has one.
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('crm_seed', 'manual')),

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- The acting person's email, stamped server-side from the resolved identity.
  -- 'crm_seed' for rows this script wrote.
  created_by  text,
  updated_by  text
);

-- The only uniqueness the schema asserts: no exact duplicate. See the note above.
CREATE UNIQUE INDEX IF NOT EXISTS account_team_members_unique_assignment
  ON public.account_team_members (account_id, role, user_id);

-- The management page's main read: everything for one account.
CREATE INDEX IF NOT EXISTS idx_account_team_members_account
  ON public.account_team_members (account_id, role);

-- "What is this person on?" — the query shape the future visibility work needs.
CREATE INDEX IF NOT EXISTS idx_account_team_members_user
  ON public.account_team_members (user_id);

CREATE INDEX IF NOT EXISTS idx_account_team_members_role
  ON public.account_team_members (role);

DROP TRIGGER IF EXISTS account_team_members_touch_updated_at ON public.account_team_members;
CREATE TRIGGER account_team_members_touch_updated_at
  BEFORE UPDATE ON public.account_team_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS on, zero policies => only service_role reaches it. The anon key that
-- ships in the browser gets nothing. Authorisation lives in the server actions.
ALTER TABLE public.account_team_members ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_team_members TO service_role;


-- ---------------------------------------------------------------------------
-- 2. THE RE-RUNNABLE CRM SEED
--
--    Three statements, in order. All three share the same `crm` CTE — the six
--    accounts columns unpivoted into (account_id, role, user_id) — and all three
--    skip any slot that a human has taken over.
--
--    THE MANUAL-EDIT RULE, stated once: a slot is (account_id, role). If ANY row
--    exists for that slot with source = 'manual', the seed leaves the whole slot
--    alone — it will not delete, insert or update anything in it. A human has
--    spoken; the CRM does not get to argue.
--
--    Re-running after a CRM change: the person moves. Statement (a) removes the
--    stale crm_seed row, (b) inserts the new one. Re-running with no CRM change
--    is a no-op apart from touching updated_at on matched rows.
-- ---------------------------------------------------------------------------

-- (a) Drop crm_seed rows the CRM no longer agrees with — but never inside a
--     slot a human has taken over.
WITH crm AS (
  SELECT a.account_id, 'account_manager'::text AS role, a.sales_lead_primary_id AS user_id
    FROM public.accounts a WHERE a.sales_lead_primary_id IS NOT NULL
  UNION ALL
  SELECT a.account_id, 'secondary_manager', a.secondary_manager_id
    FROM public.accounts a WHERE a.secondary_manager_id IS NOT NULL
  UNION ALL
  SELECT a.account_id, 'feedback_report', a.feedback_report_id
    FROM public.accounts a WHERE a.feedback_report_id IS NOT NULL
  UNION ALL
  SELECT a.account_id, 'associate', a.associate_id
    FROM public.accounts a WHERE a.associate_id IS NOT NULL
  -- MEMO = TEASER. See the mapping note in the header.
  UNION ALL
  SELECT a.account_id, 'memo', a.teaser_id
    FROM public.accounts a WHERE a.teaser_id IS NOT NULL
  UNION ALL
  SELECT a.account_id, 'logistics', a.logistics_coordinator_id
    FROM public.accounts a WHERE a.logistics_coordinator_id IS NOT NULL
)
DELETE FROM public.account_team_members m
WHERE m.source = 'crm_seed'
  -- the CRM no longer names this person in this slot
  AND NOT EXISTS (
    SELECT 1 FROM crm c
     WHERE c.account_id = m.account_id AND c.role = m.role AND c.user_id = m.user_id
  )
  -- and no human has taken the slot over
  AND NOT EXISTS (
    SELECT 1 FROM public.account_team_members k
     WHERE k.account_id = m.account_id AND k.role = m.role AND k.source = 'manual'
  );

-- (b) Insert what the CRM names and we do not have — skipping human-owned slots.
WITH crm AS (
  SELECT a.account_id, 'account_manager'::text AS role, a.sales_lead_primary_id AS user_id
    FROM public.accounts a WHERE a.sales_lead_primary_id IS NOT NULL
  UNION ALL
  SELECT a.account_id, 'secondary_manager', a.secondary_manager_id
    FROM public.accounts a WHERE a.secondary_manager_id IS NOT NULL
  UNION ALL
  SELECT a.account_id, 'feedback_report', a.feedback_report_id
    FROM public.accounts a WHERE a.feedback_report_id IS NOT NULL
  UNION ALL
  SELECT a.account_id, 'associate', a.associate_id
    FROM public.accounts a WHERE a.associate_id IS NOT NULL
  UNION ALL
  SELECT a.account_id, 'memo', a.teaser_id
    FROM public.accounts a WHERE a.teaser_id IS NOT NULL
  UNION ALL
  SELECT a.account_id, 'logistics', a.logistics_coordinator_id
    FROM public.accounts a WHERE a.logistics_coordinator_id IS NOT NULL
)
INSERT INTO public.account_team_members
  (account_id, role, user_id, source, created_by, updated_by)
SELECT c.account_id, c.role, c.user_id, 'crm_seed', 'crm_seed', 'crm_seed'
  FROM crm c
  -- the user must really exist (the FK would reject it anyway; this makes a CRM
  -- drift show up as "not seeded" rather than as an aborted script)
 WHERE EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = c.user_id)
   -- never step into a slot a human owns
   AND NOT EXISTS (
     SELECT 1 FROM public.account_team_members k
      WHERE k.account_id = c.account_id AND k.role = c.role AND k.source = 'manual'
   )
ON CONFLICT (account_id, role, user_id) DO UPDATE
   -- already present and still correct: re-affirm it, but do NOT flip a manual
   -- row back to crm_seed (the WHERE below is what protects that).
   SET updated_at = now(),
       updated_by = 'crm_seed'
 WHERE public.account_team_members.source = 'crm_seed';

-- (c) Nothing else. Slots the CRM leaves empty stay empty; slots a human owns
--     are untouched.


-- ---------------------------------------------------------------------------
-- 3. REPORTS — run these after the seed
-- ---------------------------------------------------------------------------

-- The field mapping, with live counts. Confirm the `memo` row in particular.
--   SELECT 'account_manager'   AS role, 'accounts.sales_lead_primary_id'       AS crm_field, count(sales_lead_primary_id)       AS crm_rows FROM public.accounts
--   UNION ALL SELECT 'secondary_manager','accounts.secondary_manager_id',       count(secondary_manager_id)       FROM public.accounts
--   UNION ALL SELECT 'feedback_report',  'accounts.feedback_report_id',         count(feedback_report_id)         FROM public.accounts
--   UNION ALL SELECT 'associate',        'accounts.associate_id',               count(associate_id)               FROM public.accounts
--   UNION ALL SELECT 'memo',             'accounts.teaser_id  (MEMO=TEASER)',   count(teaser_id)                  FROM public.accounts
--   UNION ALL SELECT 'logistics',        'accounts.logistics_coordinator_id',   count(logistics_coordinator_id)   FROM public.accounts
--   ORDER BY 1;
--     -- expected: account_manager 158, associate 136, feedback_report 152,
--     --           logistics 135, memo 148, secondary_manager 72

-- What actually landed, by role and source.
--   SELECT role, source, count(*) FROM public.account_team_members
--    GROUP BY 1,2 ORDER BY 1,2;                          -- 801 crm_seed rows total

-- UNMATCHED PEOPLE — CRM names someone with no public.users row.
-- Expected to return ZERO rows today; kept so future CRM drift is visible
-- instead of silently dropped by the seed's EXISTS guard.
--   WITH crm AS (
--     SELECT account_id, 'account_manager' AS role, sales_lead_primary_id      AS user_id, sales_lead_primary_name      AS crm_name FROM public.accounts WHERE sales_lead_primary_id      IS NOT NULL
--     UNION ALL SELECT account_id,'secondary_manager', secondary_manager_id,     secondary_manager_name     FROM public.accounts WHERE secondary_manager_id     IS NOT NULL
--     UNION ALL SELECT account_id,'feedback_report',   feedback_report_id,       feedback_report_name       FROM public.accounts WHERE feedback_report_id       IS NOT NULL
--     UNION ALL SELECT account_id,'associate',         associate_id,             associate_name             FROM public.accounts WHERE associate_id             IS NOT NULL
--     UNION ALL SELECT account_id,'memo',              teaser_id,                teaser_name                FROM public.accounts WHERE teaser_id                IS NOT NULL
--     UNION ALL SELECT account_id,'logistics',         logistics_coordinator_id, logistics_coordinator_name FROM public.accounts WHERE logistics_coordinator_id IS NOT NULL
--   )
--   SELECT c.role, c.crm_name, count(*) AS accounts
--     FROM crm c LEFT JOIN public.users u ON u.user_id = c.user_id
--    WHERE u.user_id IS NULL
--    GROUP BY 1,2 ORDER BY 1,2;

-- Seeded people who are INACTIVE in public.users — expected 38 rows' worth.
-- These are shown flagged on the management page so they can be reassigned.
--   SELECT m.role, u.display_name, u.email, count(*) AS accounts
--     FROM public.account_team_members m
--     JOIN public.users u ON u.user_id = m.user_id
--    WHERE u.is_active IS NOT TRUE
--    GROUP BY 1,2,3 ORDER BY 1,2;

-- Manual edits, once people start making them (the seed must never touch these).
--   SELECT a.name, m.role, u.display_name, m.updated_by, m.updated_at
--     FROM public.account_team_members m
--     JOIN public.accounts a ON a.account_id = m.account_id
--     JOIN public.users u    ON u.user_id    = m.user_id
--    WHERE m.source = 'manual' ORDER BY a.name, m.role;

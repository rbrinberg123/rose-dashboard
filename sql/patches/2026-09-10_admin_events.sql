-- =============================================================================
-- Patch: Admin -> Events. The second CRM page.
-- Date: 2026-09-10
--
-- Creates everything the super-user-only /events page reads:
--   1. indexes for the default view, the sort and the filters
--   2. v_admin_events_all             -- the list + drawer source
--   3. v_admin_events_filter_options  -- distinct values for the dropdowns
--   4. event_saved_views              -- saved views, same shape as meetings
--
-- SECURITY. v_admin_events_all is UNSCOPED, exactly like v_admin_meetings_all:
-- it returns every client's events to whoever can read it, and the page reads it
-- with the service-role key (RLS bypassed). The gate is the route --
-- lib/access-control.ts ADMIN_ONLY_ROUTES makes /events super-user-only and NOT
-- grantable through the Roles matrix -- plus a server-side re-check in
-- app/events/page.tsx before anything is fetched. Do not reuse this view on a
-- row-scoped page.
--
-- ── FIELD SOURCING NOTES (read these; two are judgement calls) ──────────────
--
--   ACCOUNT MANAGER = sales_lead_primary_*, NOT manager_*.
--   public.events has a manager_id/manager_name lookup, and it is empty: 0 of
--   968 live rows populate it. sales_lead_primary_name fills 966 of 968 and
--   agrees with accounts.sales_lead_primary_name (the field Portfolio already
--   calls the account manager). So the dead lookup is ignored.
--
--   MEMO = TEASER. The page's drawer asks for "Memo Date" and "Memo Not
--   Required". public.events has no memo_* columns; it has teaser_date (78%
--   populated) and teaser_not_required (80%). Rose's CRM calls this artefact a
--   teaser; the page calls it a memo. Mapped on that assumption and labelled as
--   Memo in the UI. If that is wrong, the fix is the two lines marked MEMO
--   below plus the matching labels in lib/events/record.ts.
--
--   EMPTY BUT REAL. targeting_notes and shareholder_report_received_date are 0%
--   populated across all 968 events. They are exposed anyway because they are
--   the columns the drawer asks for -- they will fill in when the CRM does.
--
-- SAFE TO RE-RUN.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Indexes
--    idx_events_client_account_id and idx_events_start_actual already exist
--    (sql/16_events_table.sql); these cover the default view and the AM filter.
-- ---------------------------------------------------------------------------

-- The default "Current & Upcoming" view is state_label = 'Active' AND
-- event_state_label <> 'Complete' -- 144 of 968 rows.
CREATE INDEX IF NOT EXISTS idx_events_state_pair
  ON public.events (state_label, event_state_label);

-- The Event State dropdown on its own.
CREATE INDEX IF NOT EXISTS idx_events_event_state_label
  ON public.events (event_state_label);

-- The Account Manager dropdown.
CREATE INDEX IF NOT EXISTS idx_events_sales_lead_primary
  ON public.events (sales_lead_primary_id);

-- ---------------------------------------------------------------------------
-- 2. v_admin_events_all
--    Flat, display-shaped, and deliberately WITHOUT _raw: the list must never
--    carry the Dynamics blob. public.events is already a full flattened mirror,
--    so unlike meetings nothing here has to be dug out of jsonb.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_admin_events_all AS
SELECT
  e.event_id,

  -- ---- the seven list columns ----
  e.client_account_name,
  e.dates                                       AS event_dates,      -- free text, e.g. "10/2 & 10/3"
  e.event_location,
  e.event_state_label,
  e.targeting_url,
  e.name                                        AS event_title,
  e.user_team_lead,

  -- ---- identity / links ----
  e.client_account_id,
  -- Prefer the account's ticker (same source the Meetings page links on); fall
  -- back to the event's own denormalised copy.
  COALESCE(a.ticker_symbol, e.client_ticker)    AS client_ticker,
  e.marketing_state_label,
  e.state_label,

  -- ---- General section ----
  e.tbc,
  e.sales_lead_primary_id                       AS account_manager_id,
  e.sales_lead_primary_name                     AS account_manager_name,
  e.logistics_coordinator_id,
  e.logistics_coordinator_name,
  e.feedback_team_name,
  e.feedback_report_id,
  e.feedback_report_name,
  e.leads_labels,
  e.team,
  e.event_notes,
  e.event_start_actual                          AS meetings_start,
  e.event_end_actual                            AS meetings_end,

  -- ---- Planning section ----
  e.event_parameters,
  e.of_slots,
  e.urgency_label,
  e.proposed_launch_date                        AS launch_week,
  e.teaser_date                                 AS memo_date,          -- MEMO = teaser (see header)
  e.teaser_not_required                         AS memo_not_required,  -- MEMO = teaser (see header)
  e.last_data_upload,
  e.shareholder_report_received_date,
  e.targeting_not_required,
  e.targeting_date,
  e.profile_link,
  e.targeting_notes,
  e.launch,
  e.outreach_complete,

  -- ---- system ----
  e.created_on,
  e.modified_on
FROM public.events e
LEFT JOIN public.accounts a ON a.account_id = e.client_account_id;

GRANT SELECT ON public.v_admin_events_all TO service_role;

-- ---------------------------------------------------------------------------
-- 3. v_admin_events_filter_options
--    Same shape as the meetings one: (kind, value, label, count), read straight
--    off public.events so the dropdowns never scan the joined view.
--    Account managers are keyed by CANONICAL user id -- two people in this CRM
--    carry duplicate systemuser records, and a raw-id filter would split them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_admin_events_filter_options AS
  SELECT
    'client'::text                                    AS kind,
    e.client_account_id::text                         AS value,
    min(e.client_account_name)                        AS label,
    count(*)::bigint                                  AS event_count
  FROM public.events e
  WHERE e.client_account_id IS NOT NULL
    AND NULLIF(btrim(e.client_account_name), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'event_state'::text                               AS kind,
    btrim(e.event_state_label)                        AS value,
    btrim(e.event_state_label)                        AS label,
    count(*)::bigint                                  AS event_count
  FROM public.events e
  WHERE NULLIF(btrim(e.event_state_label), '') IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'manager'::text                                   AS kind,
    public.canonical_user_id(e.sales_lead_primary_id)::text AS value,
    min(e.sales_lead_primary_name)                    AS label,
    count(*)::bigint                                  AS event_count
  FROM public.events e
  WHERE e.sales_lead_primary_id IS NOT NULL
    AND NULLIF(btrim(e.sales_lead_primary_name), '') IS NOT NULL
  GROUP BY 1, 2;

GRANT SELECT ON public.v_admin_events_filter_options TO service_role;

-- ---------------------------------------------------------------------------
-- 4. event_saved_views
--    Identical shape and identical rules to meeting_saved_views. The APP CODE is
--    shared (one parameterised module enforces both), so only the storage is
--    duplicated -- see dashboard/lib/table-views/saved-views.ts.
--
--    RLS on, zero policies => only service_role reaches it. The anon key that
--    ships in the browser gets nothing. Authorisation for the service-role path
--    lives in the app; the constraints below are the database backstop.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('system', 'personal')),
  owner_user_id uuid REFERENCES public.users(user_id),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  config        jsonb NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_saved_views_owner_matches_scope CHECK (
    (scope = 'system'   AND owner_user_id IS NULL) OR
    (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS event_saved_views_one_personal_default
  ON public.event_saved_views (owner_user_id)
  WHERE scope = 'personal' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS event_saved_views_one_system_default
  ON public.event_saved_views (scope)
  WHERE scope = 'system' AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS event_saved_views_personal_name
  ON public.event_saved_views (owner_user_id, lower(btrim(name)))
  WHERE scope = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS event_saved_views_system_name
  ON public.event_saved_views (lower(btrim(name)))
  WHERE scope = 'system';

CREATE INDEX IF NOT EXISTS idx_event_saved_views_scope_owner
  ON public.event_saved_views (scope, owner_user_id);

DROP TRIGGER IF EXISTS event_saved_views_touch_updated_at ON public.event_saved_views;
CREATE TRIGGER event_saved_views_touch_updated_at
  BEFORE UPDATE ON public.event_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.event_saved_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_saved_views TO service_role;

-- Check it:
--   SELECT count(*) FROM public.v_admin_events_all;                    -- 968
--   SELECT count(*) FROM public.v_admin_events_all
--     WHERE state_label = 'Active' AND event_state_label <> 'Complete'; -- ~144
--   SELECT kind, count(*) FROM public.v_admin_events_filter_options
--     GROUP BY 1 ORDER BY 1;                                           -- client/event_state/manager

-- =============================================================================
-- 01_mirror_tables.sql
-- 
-- Mirror schema: read-only tables overwritten by nightly sync from Dynamics.
-- DO NOT hand-edit these tables.
--
-- Run this entire file once in the Supabase SQL editor.
-- =============================================================================

-- Drop in dependency-safe order if re-running
DROP TABLE IF EXISTS public.meetings CASCADE;
DROP TABLE IF EXISTS public.touchpoints CASCADE;
DROP TABLE IF EXISTS public.client_notes CASCADE;
DROP TABLE IF EXISTS public.contracts CASCADE;
DROP TABLE IF EXISTS public.accounts CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;


-- -----------------------------------------------------------------------------
-- users
-- Built incrementally by the loader from any systemuser GUID encountered.
-- -----------------------------------------------------------------------------
CREATE TABLE public.users (
  user_id          uuid PRIMARY KEY,
  display_name     text NOT NULL,
  -- Office 365 mailbox (Dynamics systemuser.internalemailaddress). Nullable:
  -- system/app accounts and some ex-employees have none. Source of truth for
  -- host->email in Microsoft Graph calendar features (lib/graph/hosts.ts).
  email            text,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  is_active        boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_users_display_name ON public.users (display_name);


-- -----------------------------------------------------------------------------
-- accounts
-- Rose's clients (the issuers).
-- -----------------------------------------------------------------------------
CREATE TABLE public.accounts (
  account_id                  uuid PRIMARY KEY,
  name                        text NOT NULL,
  ticker_symbol               text,
  website_url                 text,
  email                       text,
  city                        text,
  state_province              text,
  country                     text,

  -- Geography & classification (resolved lookups)
  hq_country_id               uuid,
  hq_country_name             text,
  company_master_id           uuid,
  company_master_name         text,

  sector_code                 int,
  sector_label                text,
  industry_option_code        int,
  industry_option_label       text,
  fs_industry                 text,
  fs_sector                   text,
  exchange_code               int,
  exchange_label              text,

  client_status_code          int,
  client_status_label         text,

  market_cap_b                numeric,

  -- Coverage team (resolved user lookups)
  primary_contact_id          uuid,
  primary_contact_name        text,
  sales_lead_primary_id       uuid REFERENCES public.users(user_id),
  sales_lead_primary_name     text,
  associate_id                uuid REFERENCES public.users(user_id),
  associate_name              text,
  targeting_id                uuid REFERENCES public.users(user_id),
  targeting_name              text,
  teaser_id                   uuid REFERENCES public.users(user_id),
  teaser_name                 text,
  logistics_coordinator_id    uuid REFERENCES public.users(user_id),
  logistics_coordinator_name  text,
  feedback_report_id          uuid REFERENCES public.users(user_id),
  feedback_report_name        text,
  secondary_manager_id        uuid REFERENCES public.users(user_id),
  secondary_manager_name      text,
  owner_id                    uuid,
  owner_name                  text,

  -- Current event / project (resolved lookups). No REFERENCES: public.events is
  -- created in a later file (16_events_table.sql), so an FK here would fail a
  -- rebuild, and bcs_project is not mirrored at all.
  current_event_id            uuid,
  current_event_name          text,
  current_project_id          uuid,
  current_project_name        text,

  -- Pre-computed activity rollups (from Dynamics; we pass through)
  last_touchpoint_date        timestamptz,
  next_touchpoint_date        timestamptz,
  last_event_date             timestamptz,
  next_event_date             timestamptz,
  ongoing_event_date          timestamptz,
  last_targeting_date         timestamptz,
  last_teaser_date            timestamptz,
  days_since_last_review      int,

  -- Onboarding / reporting milestones
  last_data_upload            timestamptz,
  onboarding_call             timestamptz,
  original_start_date         timestamptz,
  shareholder_report_received_date timestamptz,
  -- Two separate Dynamics fields, not a duplicate: bcs_teachin and
  -- bcs_teachindate. Both are mapped, so both are declared.
  teach_in                    timestamptz,
  teach_in_date               timestamptz,

  -- Operational flags
  do_not_call                 boolean,
  ir_only                     boolean,
  bda_peers                   boolean,
  calendar                    boolean,
  calendar_confirmed          boolean,
  distro                      boolean,
  meeting_history_received    boolean,
  mgmt_review                 boolean,
  recurring_call_scheduled    boolean,
  report                      boolean,
  rep_short_interest          boolean,
  sh_report                   boolean,

  -- Free text
  dietary_restrictions        text,
  ipreo_ticker                text,
  onboarding_notes            text,
  peers                       text,

  -- Standard
  state_code                  int,
  state_label                 text,
  status_code                 int,
  status_label                text,
  created_on                  timestamptz,
  modified_on                 timestamptz,

  -- Catch-all for fields we didn't model explicitly
  _raw                        jsonb,

  -- Rose-owned, NOT synced from Dynamics. The AI client-summary feature caches
  -- its generated text here. The Dynamics sync upsert only writes the mapped
  -- columns (see lib/sync/mappers.ts mapAccount), so these survive every sync.
  ai_summary                  text,
  ai_summary_generated_at     timestamptz,

  -- Sync metadata
  _synced_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounts_name ON public.accounts (name);
CREATE INDEX idx_accounts_ticker ON public.accounts (ticker_symbol);
CREATE INDEX idx_accounts_status ON public.accounts (state_code, status_code);
CREATE INDEX idx_accounts_modified ON public.accounts (modified_on DESC);


-- -----------------------------------------------------------------------------
-- meetings
-- The operational core. ~12k rows.
-- -----------------------------------------------------------------------------
CREATE TABLE public.meetings (
  meeting_id              uuid PRIMARY KEY,
  meeting_date            timestamptz,

  -- Client side (the issuer Rose works for)
  client_account_id       uuid REFERENCES public.accounts(account_id),
  client_account_name     text,

  -- Investor side (the institution being met with)
  -- Note: we do NOT mirror the bcs_institution table; the name is the data.
  institution_id          uuid,
  institution_name        text,
  investor_text           text,  -- free-text individual investor name

  -- The two cost-driving people
  host_id                 uuid REFERENCES public.users(user_id),
  host_name               text,
  booker_id               uuid REFERENCES public.users(user_id),
  booker_name             text,
  -- Feedback assignee (bcs_feedback). Deliberately NO REFERENCES, unlike host
  -- and booker above: this column was added to the live table out-of-band
  -- without one, and an FK here would reject any meeting whose assignee is not
  -- in the users mirror. Several views still read this person out of _raw
  -- (v_feedback_outstanding, v_admin_meetings_all) because the column was
  -- missing from this file until 2026-09-09.
  feedback_id             uuid,
  feedback_name           text,

  -- Type drives the in-person premium
  meeting_type_code       int,
  meeting_type_label      text,
  is_in_person            boolean NOT NULL DEFAULT false,  -- derived: meeting_type_label = 'Live'

  -- Status
  meeting_status_code     int,
  meeting_status_label    text,

  -- Feedback
  feedback_status_code    int,
  feedback_status_label   text,
  feedback_bda_code       int,
  feedback_bda_label      text,

  -- Operational flags
  group_meeting           boolean,
  client_booked           boolean,
  rescheduled             boolean,

  -- Free text
  general_notes           text,
  feedback_notes          text,
  cancellation_notes      text,

  -- Logistics (bcs_Sent / bcs_Confirm / bcs_FoodOrder / bcs_Driver / bcs_Notes).
  -- sent/confirm/driver are Dynamics Yes/No booleans (verified in _raw).
  -- food_order / logistics_notes are empty in every synced row so far; typed
  -- text (the loss-free superset) until a real value confirms the shape.
  sent                    boolean,
  confirm                 boolean,
  food_order              text,
  driver                  boolean,
  logistics_notes         text,
  -- bcs_HostedinHQ (logical name bcs_hostedinhq): Yes/No boolean, true when the
  -- client is hosted in the HQ / office that day. Authoritative "in the office"
  -- flag for the Week Ahead digest banner + week-grid pins.
  hosted_in_hq            boolean,

  -- Geography (we keep IDs for future use even though we don't mirror these tables)
  city_id                 uuid,
  state_region_id         uuid,
  event_id                uuid,

  -- Workflow flags (low-priority but kept for completeness)
  calendar_code           int,
  calendar_label          text,
  profile_code            int,
  profile_label           text,
  host_notes_code         int,
  host_notes_label        text,

  -- Standard
  owner_id                uuid,
  state_code              int,
  state_label             text,
  status_code             int,
  status_label            text,
  created_on              timestamptz,
  modified_on             timestamptz,

  _raw                    jsonb,
  _synced_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_meetings_date ON public.meetings (meeting_date DESC);
CREATE INDEX idx_meetings_client ON public.meetings (client_account_id, meeting_date DESC);
CREATE INDEX idx_meetings_host ON public.meetings (host_id, meeting_date DESC);
CREATE INDEX idx_meetings_booker ON public.meetings (booker_id, meeting_date DESC);
CREATE INDEX idx_meetings_status ON public.meetings (meeting_status_label);
-- The Meetings page's Feedback filter matches this column exactly. It used to
-- be read out of _raw, which no index could serve; see
-- sql/patches/2026-09-10_meetings_perf.sql.
CREATE INDEX idx_meetings_feedback_name ON public.meetings (feedback_name);
CREATE INDEX idx_meetings_modified ON public.meetings (modified_on DESC);

-- Confirmed-meeting counts per event: v_client_portfolio (Open Slots),
-- v_client_todo and v_admin_events_all all GROUP BY event_id. Partial --
-- a meeting with no event contributes to none of them.
CREATE INDEX IF NOT EXISTS idx_meetings_event_id
  ON public.meetings (event_id)
  WHERE event_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- touchpoints
-- Phone calls relabeled. ~877 rows.
-- -----------------------------------------------------------------------------
CREATE TABLE public.touchpoints (
  touchpoint_id           uuid PRIMARY KEY,
  subject                 text,
  description             text,

  touchpoint_type_code    int,
  touchpoint_type_label   text,
  contact_type_code       int,
  contact_type_label      text,

  client_account_id       uuid REFERENCES public.accounts(account_id),
  client_account_name     text,
  regarding_id            uuid,

  direction_code          boolean,  -- true = outbound

  scheduled_start         timestamptz,
  scheduled_end           timestamptz,
  actual_duration_minutes int,

  owner_id                uuid REFERENCES public.users(user_id),
  owner_name              text,
  created_by_id           uuid REFERENCES public.users(user_id),
  created_by_name         text,

  state_code              int,
  state_label             text,
  status_code             int,
  status_label            text,

  created_on              timestamptz,
  modified_on             timestamptz,

  _raw                    jsonb,
  _synced_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_touchpoints_client ON public.touchpoints (client_account_id, scheduled_start DESC);
CREATE INDEX idx_touchpoints_owner ON public.touchpoints (owner_id, scheduled_start DESC);
CREATE INDEX idx_touchpoints_modified ON public.touchpoints (modified_on DESC);

-- Added 2026-09-15 for the CRM -> Touchpoints admin page: the default sort and the
-- five quick-filter dropdowns. See sql/patches/2026-09-15_admin_touchpoints.sql for
-- the measurements behind each. NOTE idx_touchpoints_client leads with
-- client_account_id and so cannot serve an unfiltered ORDER BY scheduled_start DESC.
CREATE INDEX IF NOT EXISTS idx_touchpoints_scheduled_start   ON public.touchpoints (scheduled_start DESC);
CREATE INDEX IF NOT EXISTS idx_touchpoints_type_label        ON public.touchpoints (touchpoint_type_label);
CREATE INDEX IF NOT EXISTS idx_touchpoints_contact_type_label ON public.touchpoints (contact_type_label);
CREATE INDEX IF NOT EXISTS idx_touchpoints_created_by_id     ON public.touchpoints (created_by_id);
CREATE INDEX IF NOT EXISTS idx_touchpoints_status_label      ON public.touchpoints (status_label);
CREATE INDEX IF NOT EXISTS idx_touchpoints_state_label       ON public.touchpoints (state_label);


-- -----------------------------------------------------------------------------
-- client_notes
-- Periodic notes about client status. ~177 rows.
-- -----------------------------------------------------------------------------
CREATE TABLE public.client_notes (
  note_id                 uuid PRIMARY KEY,
  name                    text,
  note_date               date,

  notes_text              text,
  status_text             text,
  primary_risk_driver     text,

  action_step             text,
  action_owner            text,    -- initials, kept as text
  action_deadline         date,

  client_account_id       uuid REFERENCES public.accounts(account_id),
  client_account_name     text,

  owner_id                uuid REFERENCES public.users(user_id),

  state_code              int,
  state_label             text,
  status_code             int,
  status_label            text,

  created_on              timestamptz,
  modified_on             timestamptz,

  _raw                    jsonb,
  _synced_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_notes_client ON public.client_notes (client_account_id, note_date DESC);
CREATE INDEX idx_client_notes_modified ON public.client_notes (modified_on DESC);

-- Added 2026-09-15 for the CRM -> Notes admin page: the default sort and the five
-- quick-filter dropdowns. See sql/patches/2026-09-15_admin_notes.sql for the
-- measurements. NOTE idx_client_notes_client leads with client_account_id and so
-- cannot serve an unfiltered ORDER BY note_date DESC.
--
-- The three btrim() indexes are EXPRESSION indexes, matching the btrim
-- v_admin_notes_all applies: status_text and primary_risk_driver are typed with a
-- trailing newline about half the time, so the raw columns hold "Stable" and
-- "Stable\n" as different values and a plain index could not serve a filter on
-- the trimmed one.
CREATE INDEX IF NOT EXISTS idx_client_notes_note_date    ON public.client_notes (note_date DESC);
CREATE INDEX IF NOT EXISTS idx_client_notes_owner_id     ON public.client_notes (owner_id);
CREATE INDEX IF NOT EXISTS idx_client_notes_status_text  ON public.client_notes (btrim(status_text));
CREATE INDEX IF NOT EXISTS idx_client_notes_risk_driver  ON public.client_notes (btrim(primary_risk_driver));
CREATE INDEX IF NOT EXISTS idx_client_notes_review_cycle ON public.client_notes (btrim(name));


-- -----------------------------------------------------------------------------
-- contracts
-- Revenue source. ~354 rows.
-- -----------------------------------------------------------------------------
CREATE TABLE public.contracts (
  contract_id                     uuid PRIMARY KEY,
  name                            text,

  client_account_id               uuid REFERENCES public.accounts(account_id),
  client_account_name             text,

  contract_start_date             date,
  contract_termination_date       date,
  contract_renewal_date           date,
  initial_term_end                date,

  initial_term_length_code        int,
  initial_term_length_label       text,

  contract_status_code            int,
  contract_status_label           text,

  quarterly_retainer              numeric,
  quarterly_retainer_base         numeric,
  contract_length_years           numeric,

  auto_renew                      boolean,
  renew                           boolean,
  renewal_check_in_date           date,
  renewal_notice_date             date,

  termination_notice_code         int,
  termination_notice_label        text,
  termination_notice_days_code    int,
  termination_notice_days_label   text,
  reason_for_termination_code     int,
  reason_for_termination_label    text,

  payment_terms_code              int,
  payment_terms_label             text,
  invoice_delivery_code           int,
  invoice_delivery_label          text,

  scope_code                      int,
  scope_label                     text,
  services_agreement_code         int,
  services_agreement_label        text,

  contract_url                    text,
  notes                           text,

  owner_id                        uuid REFERENCES public.users(user_id),

  state_code                      int,
  state_label                     text,
  status_code                     int,
  status_label                    text,

  created_on                      timestamptz,
  modified_on                     timestamptz,

  _raw                            jsonb,
  _synced_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contracts_client ON public.contracts (client_account_id);
CREATE INDEX idx_contracts_renewal ON public.contracts (contract_renewal_date) WHERE state_code = 0;
CREATE INDEX idx_contracts_status ON public.contracts (contract_status_label);
CREATE INDEX idx_contracts_modified ON public.contracts (modified_on DESC);


-- =============================================================================
-- Deletion reconciliation (Phase 6b)
--
-- The incremental sync (07_sync_tables.sql) is upsert-only and filters on
-- `modifiedon gt watermark`, so a HARD delete in Dynamics never propagates —
-- the mirror row is simply never touched again and lingers as an orphan. The
-- reconciliation sweep (lib/sync/reconcile.ts, run nightly by Vercel Cron)
-- pulls the full set of live primary keys per entity from Dynamics, diffs them
-- against the mirror-table keys, and records the missing ones here for a human
-- to review. It NEVER deletes automatically — an admin approves each removal in
-- app/admin/reconciliation.
--
-- Both tables below use CREATE TABLE IF NOT EXISTS, so appending this section
-- and re-running it is safe (unlike the mirror tables above, they are not
-- dropped at the top of this file).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- deletion_candidates — the review queue. One row per mirror record that was
-- present locally but absent from the latest full live-ID pull from Dynamics.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deletion_candidates (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_name         text NOT NULL,          -- e.g. 'meetings'
  table_name          text NOT NULL,          -- mirror table
  pk_column           text NOT NULL,          -- mirror pk column
  pk_value            text NOT NULL,          -- the missing row's pk
  label               text,                   -- human-readable snapshot for the queue
  raw_snapshot        jsonb,                  -- copy of the mirror row at detection (audit)
  status              text NOT NULL DEFAULT 'pending',  -- 'pending' | 'dismissed' | 'deleted'
  first_detected_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_missing_at timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  resolved_by         text,
  UNIQUE (entity_name, pk_value)
);

CREATE INDEX IF NOT EXISTS idx_deletion_candidates_status
  ON public.deletion_candidates (status);

-- -----------------------------------------------------------------------------
-- reconcile_runs — one row per sweep, so the admin page can show the last-swept
-- timestamp and a per-entity summary even for sweeps triggered by cron.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reconcile_runs (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  entities_checked  int,
  newly_flagged     int,
  reappeared        int,
  skipped           int,
  summary           jsonb          -- full per-entity result array
);

CREATE INDEX IF NOT EXISTS idx_reconcile_runs_started
  ON public.reconcile_runs (started_at DESC);

-- -----------------------------------------------------------------------------
-- Grants
--
-- The sweep and the admin review actions both run through PostgREST as the
-- service_role. The review queue needs full access; approving a deletion
-- hard-DELETEs the orphan mirror row, so service_role also needs DELETE on
-- every mirror table (07_sync_tables.sql granted only INSERT/UPDATE).
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deletion_candidates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconcile_runs      TO service_role;

GRANT DELETE ON public.accounts            TO service_role;
GRANT DELETE ON public.users               TO service_role;
GRANT DELETE ON public.meetings            TO service_role;
GRANT DELETE ON public.touchpoints         TO service_role;
GRANT DELETE ON public.client_notes        TO service_role;
GRANT DELETE ON public.contracts           TO service_role;
GRANT DELETE ON public.tasks               TO service_role;
GRANT DELETE ON public.new_vacationrequest TO service_role;
GRANT DELETE ON public.events              TO service_role;

-- Identity columns above draw from implicit sequences.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;


-- -----------------------------------------------------------------------------
-- _synced_at — LAST SYNCED, not first inserted.
--
-- The column is DEFAULT now(), and a DEFAULT fires only on INSERT. No mapper
-- writes _synced_at (lib/sync/mappers.ts), and the sync upserts only the mapped
-- columns, so ON CONFLICT DO UPDATE never touched it. That made _synced_at an
-- INSERT timestamp: any row edited in Dynamics after its first mirror insert
-- showed modified_on > _synced_at forever, even when the sync had re-pulled it
-- correctly every ten minutes since. It made the obvious staleness test
-- (modified_on > _synced_at) useless — it flagged every ever-edited row.
--
-- This trigger stamps the column on INSERT *and* UPDATE, so _synced_at means
-- what its name says and modified_on > _synced_at becomes a real staleness
-- signal. A trigger rather than nine mapper edits: uniform, automatic, and it
-- cannot be forgotten when a tenth entity is added.
--
-- BEFORE INSERT too, not just UPDATE: it overrides the DEFAULT with the same
-- value, so insert behaviour is unchanged and the column has one writer.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_synced_at()
RETURNS trigger AS $$
BEGIN
  NEW._synced_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounts_touch_synced_at ON public.accounts;
CREATE TRIGGER accounts_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

-- public.users is deliberately NOT in this list. It is the one mirror table
-- with no _synced_at column — it tracks freshness with first_seen_at /
-- last_seen_at instead, and mapSystemUser writes last_seen_at directly. The
-- trigger was attached to it anyway when this block was first written, and
-- every users upsert then failed with
--   record "new" has no field "_synced_at"
-- so no new or changed Dynamics user mirrored in from 2026-09-11 until the
-- trigger was dropped on 2026-09-16
-- (sql/patches/2026-09-16_drop_users_synced_at_trigger.sql).
-- Do not re-add it unless users gains a real _synced_at column.

DROP TRIGGER IF EXISTS meetings_touch_synced_at ON public.meetings;
CREATE TRIGGER meetings_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

DROP TRIGGER IF EXISTS touchpoints_touch_synced_at ON public.touchpoints;
CREATE TRIGGER touchpoints_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.touchpoints
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

DROP TRIGGER IF EXISTS client_notes_touch_synced_at ON public.client_notes;
CREATE TRIGGER client_notes_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.client_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

DROP TRIGGER IF EXISTS contracts_touch_synced_at ON public.contracts;
CREATE TRIGGER contracts_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();

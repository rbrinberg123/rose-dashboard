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

  -- Pre-computed activity rollups (from Dynamics; we pass through)
  last_touchpoint_date        timestamptz,
  next_touchpoint_date        timestamptz,
  last_event_date             timestamptz,
  next_event_date             timestamptz,
  ongoing_event_date          timestamptz,
  last_targeting_date         timestamptz,
  last_teaser_date            timestamptz,
  days_since_last_review      int,

  -- Operational flags
  do_not_call                 boolean,
  ir_only                     boolean,

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
CREATE INDEX idx_meetings_modified ON public.meetings (modified_on DESC);


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

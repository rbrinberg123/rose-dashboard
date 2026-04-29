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

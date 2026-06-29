-- 14_tasks_table.sql
-- Mirror table for the standard Dataverse `task` entity (entity set: tasks),
-- which Rose has heavily customized with bcs_* fields. ~3,611 rows.
--
-- Conventions (see 03_data_taxonomy.md):
--   - PK is the Dynamics GUID (activityid) typed uuid, named task_id
--   - Choice fields -> {field}_code (int) + {field}_label (text)
--   - Lookups -> {field}_id (uuid) + {field}_name (text)
--   - NO foreign keys: this is an analytics-phase mirror; referential
--     integrity is deferred to the future CRM-migration phase (see decision
--     log entry "Mirror Dynamics entities without FKs during analytics phase").
--   - regardingobjectid is polymorphic: id + name + type
--   - Full Dynamics row preserved in _raw
--
-- "Mirror everything" per Decisions 09 and 12.

CREATE TABLE IF NOT EXISTS public.tasks (
  -- Primary key (Dataverse activityid)
  task_id                       uuid PRIMARY KEY,

  -- Core activity fields
  subject                       text,
  description                   text,            -- Memo
  category                      text,
  subcategory                   text,
  scheduled_start               timestamptz,
  scheduled_end                 timestamptz,
  scheduled_duration_minutes    integer,
  actual_start                  timestamptz,
  actual_end                    timestamptz,
  actual_duration_minutes       integer,
  percent_complete              integer,
  priority_code                 integer,
  priority_label                text,
  activity_type_code            text,            -- EntityName (e.g. "task")
  is_regular_activity           boolean,
  is_workflow_created           boolean,
  is_billed                     boolean,
  on_hold_time                  integer,
  last_on_hold_time             timestamptz,
  sort_date                     timestamptz,
  overridden_created_on         timestamptz,

  -- regardingobjectid: polymorphic lookup (account, event, contact, ...)
  regarding_id                  uuid,
  regarding_name                text,
  regarding_type                text,            -- regardingobjecttypecode

  -- Rose custom choice fields
  bcs_task_type_code            integer,
  bcs_task_type_label           text,
  bcs_task_subtype_code         integer,
  bcs_task_subtype_label        text,
  bcs_task_priority_code        integer,
  bcs_task_priority_label       text,
  bcs_legacy_task_type_code     integer,
  bcs_legacy_task_type_label    text,
  bcs_outreach_task_status_code integer,
  bcs_outreach_task_status_label text,

  -- Rose custom lookups (no FK)
  bcs_account_id                uuid,
  bcs_account_name              text,
  bcs_event_id                  uuid,
  bcs_event_name                text,
  bcs_project_id                uuid,
  bcs_project_name              text,
  bcs_master_company_id         uuid,
  bcs_master_company_name       text,
  bcs_claimed_by_id             uuid,
  bcs_claimed_by_name           text,
  bcs_current_assignment_id     uuid,
  bcs_current_assignment_name   text,

  -- Rose custom workflow booleans
  bcs_wc                        boolean,
  bcs_drafting                  boolean,
  bcs_draft_complete            boolean,
  bcs_processed                 boolean,
  bcs_review_complete           boolean,
  bcs_feedback_received         boolean,
  bcs_notified                  boolean,
  bcs_fix_last_activity         boolean,
  bcs_invalid_duration_save     boolean,
  bcs_claim_it                  boolean,
  bcs_earnings_release          boolean,
  bcs_corporate_calendar        boolean,
  bcs_marketing_presentation    boolean,
  bcs_meeting_history           boolean,
  bcs_peer_group                boolean,
  bcs_perception_study          boolean,
  bcs_shareholder_register      boolean,
  bcs_analyst_research          boolean,
  bcs_irplan                    boolean,

  -- Rose custom other-typed fields
  bcs_duration                  numeric,         -- Decimal
  bcs_document                  text,
  bcs_onboarding_notes          text,            -- Memo
  bcs_bulk_upload               timestamptz,
  bcs_manual_upload             timestamptz,
  bcs_last_scheduled_process    timestamptz,
  crdfa_feedback_received_date  timestamptz,

  -- Standard Dataverse system fields
  owner_id                      uuid,
  owner_name                    text,
  created_by_id                 uuid,
  created_by_name               text,
  modified_by_id                uuid,
  modified_by_name              text,
  state_code                    integer,
  state_label                   text,
  status_code                   integer,
  status_label                  text,
  created_on                    timestamptz,
  modified_on                   timestamptz,

  -- Catch-all + sync bookkeeping
  _raw                          jsonb,
  _synced_at                    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common access patterns + the incremental watermark
CREATE INDEX IF NOT EXISTS idx_tasks_modified_on        ON public.tasks (modified_on DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_bcs_account        ON public.tasks (bcs_account_id);
CREATE INDEX IF NOT EXISTS idx_tasks_bcs_event          ON public.tasks (bcs_event_id);
CREATE INDEX IF NOT EXISTS idx_tasks_regarding          ON public.tasks (regarding_id);
CREATE INDEX IF NOT EXISTS idx_tasks_task_type          ON public.tasks (bcs_task_type_code);
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_start    ON public.tasks (scheduled_start DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status             ON public.tasks (status_label);

-- Sync writes via service_role (same grant pattern as every mirror table)
GRANT INSERT, UPDATE, SELECT ON public.tasks TO service_role;

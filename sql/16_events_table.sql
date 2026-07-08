-- 16_events_table.sql
-- Phase 6b: mirror table for Dynamics bcs_event -> public.events
--
-- Per Decision 09, this mirrors ALL fields of bcs_event (not a curated subset).
-- Column types confirmed against bcs_event attribute metadata (June 2026).
--
-- Notes:
--  - Lookups to entities we do NOT mirror (bcs_lead, bcs_targeting, bcs_teaser,
--    bcs_feedbackreport) are stored as id + name with NO foreign key, per the
--    existing pattern and the Phase 6b plan. Lookups to users/accounts are also
--    stored WITHOUT FK constraints during the analytics phase.
--  - bcs_leads is a MULTI-SELECT picklist: the raw value is a comma-separated
--    string of option codes; the FormattedValue is a comma-separated label string.
--    Stored as two text columns (leads_codes / leads_labels).

CREATE TABLE public.events (
  -- Primary key (Dataverse bcs_eventid)
  event_id                        uuid PRIMARY KEY,

  -- Identity / naming
  name                            text,         -- bcs_name
  event_auto_num                  text,         -- bcs_eventautonum (autonumber)
  event_unique_id                 text,         -- bcs_eventuniqueid
  client_ticker                   text,         -- bcs_clientticker
  dates                           text,         -- bcs_dates (free text, e.g. "10/2 & 10/3")
  event_location                  text,         -- bcs_eventlocation

  -- Core event dates
  event_start_actual              timestamptz,  -- bcs_eventstartactual
  event_end_actual                timestamptz,  -- bcs_eventendactual
  event_duration_days             integer,      -- bcs_eventdurationdays
  proposed_launch_date            timestamptz,  -- bcs_proposedlaunchdate
  first_save_date                 timestamptz,  -- bcs_firstsavedate
  targeting_date                  timestamptz,  -- bcs_targetingdate
  contact_targeting               timestamptz,  -- bcs_contacttargeting (DateTime)
  teaser_date                     timestamptz,  -- bcs_teaserdate
  last_update_teaser              timestamptz,  -- bcs_lastupdateteaser
  last_update_targeting           timestamptz,  -- bcs_lastupdatetargeting
  last_data_upload                timestamptz,  -- bcs_lastdataupload
  last_event_past                 timestamptz,  -- bcs_lasteventpast
  next_event_upcoming             timestamptz,  -- bcs_nexteventupcoming
  shareholder_report_received_date timestamptz, -- bcs_shareholderreportreceiveddate

  -- Business lookups (id + name, no FK)
  client_account_id               uuid,         -- bcs_clientname (-> accounts)
  client_account_name             text,
  sales_lead_primary_id           uuid,         -- bcs_salesleadprimary (-> users)
  sales_lead_primary_name         text,
  manager_id                      uuid,         -- bcs_manager (-> users)
  manager_name                    text,
  logistics_coordinator_id        uuid,         -- bcs_logisticscoordinator (-> users)
  logistics_coordinator_name      text,
  feedback_team_id                uuid,         -- bcs_feedbackteam
  feedback_team_name              text,
  feedback_report_id              uuid,         -- bcs_feedbackreport
  feedback_report_name            text,
  contact_targeting_by_id         uuid,         -- bcs_contacttargetingby
  contact_targeting_by_name       text,
  lead_id                         uuid,         -- bcs_lead (-> bcs_lead, NOT mirrored)
  lead_name                       text,
  targeting_id                    uuid,         -- bcs_targeting (-> bcs_targeting, NOT mirrored)
  targeting_name                  text,
  teaser_id                       uuid,         -- bcs_teaser (-> NOT mirrored)
  teaser_name                     text,

  -- Coverage initials (free text in Dynamics)
  cag_sales_lead                  text,         -- bcs_cagsaleslead
  cag_coordinator                 text,         -- bcs_cagcoordinator
  cag_targeting                   text,         -- bcs_cagtargeting
  cag_teaser                      text,         -- bcs_cagteaser
  cag_fb_rep                      text,         -- bcs_cagfbrep
  logistic_coordi                 text,         -- bcs_logisticcoordi (text; distinct from the lookup above)
  user_team_lead                  text,         -- bcs_userteamlead

  -- Choice / option-set fields (code + label)
  event_state_code                integer,      -- bcs_eventstate
  event_state_label               text,
  marketing_state_code            integer,      -- bcs_marketingstate
  marketing_state_label           text,
  feedback_report_sent_code       integer,      -- bcs_feedbackreportsent
  feedback_report_sent_label      text,
  event_type_code                 integer,      -- bcs_eventtype
  event_type_label                text,
  feedback_status_code            integer,      -- bcs_feedbackstatus
  feedback_status_label           text,
  feedback_report_status_code     integer,      -- bcs_feedbackreportstatus
  feedback_report_status_label    text,
  feedback_collection_code        integer,      -- bcs_feedbackcollection (Picklist)
  feedback_collection_label       text,
  targeting_status_code           integer,      -- bcs_targetingstatus
  targeting_status_label          text,
  urgency_code                    integer,      -- bcs_urgency
  urgency_label                   text,
  last_teaser_code                integer,      -- bcs_lastteaser (Picklist, NOT a datetime)
  last_teaser_label               text,

  -- Multi-select picklist (comma-separated codes + labels)
  leads_codes                     text,         -- bcs_leads (raw comma-separated option codes)
  leads_labels                    text,         -- resolved labels for bcs_leads

  -- Rollup fields (value + Dataverse companion _date / _state columns)
  confirmed_meetings              integer,      -- bcs_confirmedmeetings
  confirmed_meetings_date         timestamptz,  -- bcs_confirmedmeetings_date
  confirmed_meetings_state        integer,      -- bcs_confirmedmeetings_state
  pending_meetings                integer,      -- bcs_pendingmeetings
  pending_meetings_date           timestamptz,  -- bcs_pendingmeetings_date
  pending_meetings_state          integer,      -- bcs_pendingmeetings_state
  meeting_count_assigned          integer,      -- bcs_meetingcountassigned
  meeting_count_assigned_date     timestamptz,  -- bcs_meetingcountassigned_date
  meeting_count_assigned_state    integer,      -- bcs_meetingcountassigned_state

  -- Slot / capacity counters
  slots_remaining                 integer,      -- bcs_slotsremaining
  of_slots                        integer,      -- bcs_ofslots
  meeting_slots_max               integer,      -- bcs_meetingslotsmax
  spaces_available                integer,      -- bcs_spacesavailable
  age_targeting                   integer,      -- bcs_agetargeting
  age_teaser                      integer,      -- bcs_ageteaser

  -- Booleans / workflow flags
  launch                          boolean,      -- bcs_launch
  paused                          boolean,      -- bcs_paused
  outreach_complete               boolean,      -- bcs_outreachcomplete
  profiles_created                boolean,      -- bcs_profilescreated
  manager_signoff                 boolean,      -- bcs_managersignoff
  schedule_approved               boolean,      -- bcs_scheduleapproved
  collateral_sent                 boolean,      -- bcs_collateralsent
  contact_level_targeting         boolean,      -- bcs_contactleveltargeting
  teaser_task_created             boolean,      -- bcs_teasertaskcreated
  teaser_not_required             boolean,      -- bcs_teasernotrequired
  targeting_not_required          boolean,      -- bcs_targetingnotrequired
  update_required_teaser          boolean,      -- bcs_updaterequiredteaser
  update_required_targeting       boolean,      -- bcs_updaterequiredtargeting
  priority                        boolean,      -- bcs_priority (Boolean, NOT a choice)
  team                            boolean,      -- bcs_team (Boolean)
  tbc                             boolean,      -- bcs_tbc

  -- Free-text notes / urls / params
  event_notes                     text,         -- bcs_eventnotes (memo)
  targeting_notes                 text,         -- bcs_targetingnotes
  scheduling_notes                text,         -- bcs_schedulingnotes (memo)
  notes_or_mandates               text,         -- bcs_notesormandates (memo)
  event_parameters                text,         -- bcs_eventparameters
  targeting_url                   text,         -- bcs_targetingurl
  sharepoint_url                  text,         -- Rose-owned: SharePoint event document link (surfaced on Profiles). NULL until populated.

  -- Standard Dataverse system columns
  owner_id                        uuid,         -- ownerid
  owner_name                      text,
  owning_user_id                  uuid,         -- owninguser
  owning_user_name                text,
  owning_team_id                  uuid,         -- owningteam
  owning_team_name                text,
  owning_business_unit_id         uuid,         -- owningbusinessunit
  owning_business_unit_name       text,
  created_by_id                   uuid,         -- createdby
  created_by_name                 text,
  created_on_behalf_by_id         uuid,         -- createdonbehalfby
  created_on_behalf_by_name       text,
  modified_by_id                  uuid,         -- modifiedby
  modified_by_name                text,
  modified_on_behalf_by_id        uuid,         -- modifiedonbehalfby
  modified_on_behalf_by_name      text,
  state_code                      integer,      -- statecode
  state_label                     text,
  status_code                     integer,      -- statuscode
  status_label                    text,
  created_on                      timestamptz,  -- createdon
  modified_on                     timestamptz,  -- modifiedon (sync watermark)
  overridden_created_on           timestamptz,  -- overriddencreatedon

  -- Dataverse internals (mirrored for completeness per Decision 09)
  import_sequence_number          integer,      -- importsequencenumber
  timezone_rule_version_number    integer,      -- timezoneruleversionnumber
  utc_conversion_timezone_code    integer,      -- utcconversiontimezonecode
  version_number                  bigint,       -- versionnumber

  -- Catch-all + sync bookkeeping
  _raw                            jsonb,
  _synced_at                      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_events_modified_on       ON public.events (modified_on DESC);
CREATE INDEX idx_events_client_account_id ON public.events (client_account_id);
CREATE INDEX idx_events_start_actual      ON public.events (event_start_actual DESC);

-- Grant (run AFTER the CREATE TABLE; this was the line that failed when run alone)
GRANT INSERT, UPDATE ON public.events TO service_role;

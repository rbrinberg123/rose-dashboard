/**
 * Row mappers — one per mirror table. Direct TypeScript port of the mappers
 * in loader/load.py, producing objects whose keys ARE the mirror-table column
 * names (so they can be handed straight to a PostgREST upsert).
 *
 * Keep these in lockstep with loader/load.py: the Python loader remains the
 * manual fallback, and both must write identical shapes.
 */

type Row = Record<string, unknown>

const FMT = "@OData.Community.Display.V1.FormattedValue"
const LOOKUP_TYPE = "@Microsoft.Dynamics.CRM.lookuplogicalname"

/** FormattedValue annotation for a field, or null. */
function fv(row: Row, field: string): string | null {
  return (row[`${field}${FMT}`] as string | undefined) ?? null
}

/** GUID stored in a _xxx_value lookup field. */
function lookupId(row: Row, field: string): string | null {
  return (row[field] as string | undefined) ?? null
}

/** Resolved display name from a _xxx_value lookup field. */
function lookupName(row: Row, field: string): string | null {
  return (row[`${field}${FMT}`] as string | undefined) ?? null
}

/**
 * Dynamics returns ISO 8601 datetimes already; PostgREST accepts them as-is
 * for timestamptz / date columns. We normalize empty/missing to null and
 * otherwise pass the string straight through (the Python loader parsed to a
 * datetime, but the wire format is identical on the way back out).
 */
function parseDt(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  return String(value)
}

function num(value: unknown): number | null {
  return value === null || value === undefined ? null : (value as number)
}

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function bool(value: unknown): boolean | null {
  return value === null || value === undefined ? null : Boolean(value)
}

// -----------------------------------------------------------------------------

export function mapAccount(row: Row): Row {
  return {
    account_id: row["accountid"],
    name: str(row["name"]),
    ticker_symbol: str(row["tickersymbol"]),
    website_url: str(row["websiteurl"]),
    email: str(row["emailaddress1"]),
    city: str(row["address2_city"]),
    state_province: str(row["address2_stateorprovince"]),
    country: str(row["address2_country"]),

    hq_country_id: lookupId(row, "_bcs_hqcountry_value"),
    hq_country_name: lookupName(row, "_bcs_hqcountry_value"),
    company_master_id: lookupId(row, "_bcs_companymasterrecord_value"),
    company_master_name: lookupName(row, "_bcs_companymasterrecord_value"),

    sector_code: num(row["bcs_sector"]),
    sector_label: fv(row, "bcs_sector"),
    industry_option_code: num(row["bcs_industryoption"]),
    industry_option_label: fv(row, "bcs_industryoption"),
    fs_industry: str(row["bcs_fsindustry"]),
    fs_sector: str(row["bcs_fssector"]),
    exchange_code: num(row["bcs_exchange"]),
    exchange_label: fv(row, "bcs_exchange"),

    client_status_code: num(row["bcs_clientstatus"]),
    client_status_label: fv(row, "bcs_clientstatus"),

    market_cap_b: num(row["bcs_marketcapb"]),

    primary_contact_id: lookupId(row, "_primarycontactid_value"),
    primary_contact_name: lookupName(row, "_primarycontactid_value"),
    sales_lead_primary_id: lookupId(row, "_bcs_salesleadprimary_value"),
    sales_lead_primary_name: lookupName(row, "_bcs_salesleadprimary_value"),
    associate_id: lookupId(row, "_bcs_associate_value"),
    associate_name: lookupName(row, "_bcs_associate_value"),
    targeting_id: lookupId(row, "_bcs_targeting_value"),
    targeting_name: lookupName(row, "_bcs_targeting_value"),
    teaser_id: lookupId(row, "_bcs_teaser_value"),
    teaser_name: lookupName(row, "_bcs_teaser_value"),
    logistics_coordinator_id: lookupId(row, "_bcs_logisticscoordinator_value"),
    logistics_coordinator_name: lookupName(row, "_bcs_logisticscoordinator_value"),
    feedback_report_id: lookupId(row, "_bcs_feedbackreport_value"),
    feedback_report_name: lookupName(row, "_bcs_feedbackreport_value"),
    secondary_manager_id: lookupId(row, "_bcs_secondarymanager_value"),
    secondary_manager_name: lookupName(row, "_bcs_secondarymanager_value"),
    owner_id: lookupId(row, "_ownerid_value"),
    owner_name: lookupName(row, "_ownerid_value"),

    last_touchpoint_date: parseDt(row["bcs_lasttouchpoint"]),
    next_touchpoint_date: parseDt(row["bcs_nexttouchpoint"]),
    last_event_date: parseDt(row["bcs_lastevent"]),
    next_event_date: parseDt(row["bcs_nextevent"]),
    ongoing_event_date: parseDt(row["bcs_ongoingevent"]),
    last_targeting_date: parseDt(row["bcs_lasttargetingdate"]),
    last_teaser_date: parseDt(row["bcs_lastteaserdate"]),
    days_since_last_review: num(row["bcs_dayssincelastreview"]),

    do_not_call: bool(row["bcs_donotcall"]),
    ir_only: bool(row["bcs_ironly"]),
    // --- Additional account fields ---
    bda_peers: bool(row["bcs_bdapeers"]),
    calendar: bool(row["bcs_calendar"]),
    calendar_confirmed: bool(row["bcs_calendarconfirmed"]),
    distro: bool(row["bcs_distro"]),
    meeting_history_received: bool(row["bcs_meetinghistoryrecd"]),
    mgmt_review: bool(row["bcs_mgmtreview"]),
    recurring_call_scheduled: bool(row["bcs_recurringcallscheduled"]),
    report: bool(row["bcs_report"]),
    rep_short_interest: bool(row["bcs_repshortinterest"]),
    sh_report: bool(row["bcs_shreport"]),

    current_event_id: lookupId(row, "_bcs_currentevent_value"),
    current_event_name: lookupName(row, "_bcs_currentevent_value"),
    current_project_id: lookupId(row, "_bcs_currentproject_value"),
    current_project_name: lookupName(row, "_bcs_currentproject_value"),

    last_data_upload: parseDt(row["bcs_lastdataupload"]),
    last_sg_touchpoint: parseDt(row["bcs_lastsgtouchpoint"]),
    onboarding_call: parseDt(row["bcs_onboardingcall"]),
    original_start_date: parseDt(row["bcs_originalstartdate"]),
    shareholder_report_received_date: parseDt(row["bcs_shareholderreportreceiveddate"]),
    teach_in: parseDt(row["bcs_teachin"]),
    teach_in_date: parseDt(row["bcs_teachindate"]),

    dietary_restrictions: str(row["bcs_dietaryrestrictions"]),
    ipreo_ticker: str(row["bcs_ipreoticker"]),
    onboarding_notes: str(row["bcs_onboardingnotes"]),
    peers: str(row["bcs_peers"]),

    state_code: num(row["statecode"]),
    state_label: fv(row, "statecode"),
    status_code: num(row["statuscode"]),
    status_label: fv(row, "statuscode"),
    created_on: parseDt(row["createdon"]),
    modified_on: parseDt(row["modifiedon"]),

    _raw: row,
  }
}

export function mapMeeting(row: Row): Row {
  const meetingTypeLabel = fv(row, "bcs_meetingtype")
  const isInPerson = meetingTypeLabel === "Live"

  return {
    meeting_id: row["bcs_meetingid"],
    meeting_date: parseDt(row["bcs_date"]),

    client_account_id: lookupId(row, "_bcs_client_value"),
    client_account_name: lookupName(row, "_bcs_client_value"),

    institution_id: lookupId(row, "_bcs_institution_value"),
    institution_name: lookupName(row, "_bcs_institution_value"),
    investor_text: str(row["bcs_investor"]),

    host_id: lookupId(row, "_bcs_host_value"),
    host_name: lookupName(row, "_bcs_host_value"),
    booker_id: lookupId(row, "_bcs_booker_value"),
    booker_name: lookupName(row, "_bcs_booker_value"),
    feedback_id: lookupId(row, "_bcs_feedback_value"),
    feedback_name: lookupName(row, "_bcs_feedback_value"),

    meeting_type_code: num(row["bcs_meetingtype"]),
    meeting_type_label: meetingTypeLabel,
    is_in_person: isInPerson,

    meeting_status_code: num(row["bcs_meetingstatus"]),
    meeting_status_label: fv(row, "bcs_meetingstatus"),

    feedback_status_code: num(row["bcs_feedbackstatus"]),
    feedback_status_label: fv(row, "bcs_feedbackstatus"),
    feedback_bda_code: num(row["bcs_feedbackbda"]),
    feedback_bda_label: fv(row, "bcs_feedbackbda"),

    group_meeting: bool(row["bcs_groupmeeting"]),
    client_booked: bool(row["bcs_clientbooked"]),
    rescheduled: bool(row["bcs_rescheduledmeeting"]),

    general_notes: str(row["bcs_generalnotes"]),
    feedback_notes: str(row["bcs_feedbacknotes"]),
    cancellation_notes: str(row["bcs_cancellationnotes"]),

    city_id: lookupId(row, "_bcs_city_value"),
    state_region_id: lookupId(row, "_bcs_stateregion_value"),
    event_id: lookupId(row, "_bcs_event_value"),

    calendar_code: num(row["bcs_calendar"]),
    calendar_label: fv(row, "bcs_calendar"),
    profile_code: num(row["bcs_profile"]),
    profile_label: fv(row, "bcs_profile"),
    host_notes_code: num(row["bcs_hostnotes"]),
    host_notes_label: fv(row, "bcs_hostnotes"),

    owner_id: lookupId(row, "_ownerid_value"),
    state_code: num(row["statecode"]),
    state_label: fv(row, "statecode"),
    status_code: num(row["statuscode"]),
    status_label: fv(row, "statuscode"),
    created_on: parseDt(row["createdon"]),
    modified_on: parseDt(row["modifiedon"]),

    _raw: row,
  }
}

export function mapTouchpoint(row: Row): Row {
  return {
    touchpoint_id: row["activityid"],
    subject: str(row["subject"]),
    description: str(row["description"]),

    touchpoint_type_code: num(row["bcs_type"]),
    touchpoint_type_label: fv(row, "bcs_type"),
    contact_type_code: num(row["bcs_contacttype"]),
    contact_type_label: fv(row, "bcs_contacttype"),

    client_account_id: lookupId(row, "_bcs_client_value"),
    client_account_name: lookupName(row, "_bcs_client_value"),
    regarding_id: lookupId(row, "_regardingobjectid_value"),

    direction_code: bool(row["directioncode"]),

    scheduled_start: parseDt(row["scheduledstart"]),
    scheduled_end: parseDt(row["scheduledend"]),
    actual_duration_minutes: num(row["actualdurationminutes"]),

    owner_id: lookupId(row, "_ownerid_value"),
    owner_name: lookupName(row, "_ownerid_value"),
    created_by_id: lookupId(row, "_createdby_value"),
    created_by_name: lookupName(row, "_createdby_value"),

    state_code: num(row["statecode"]),
    state_label: fv(row, "statecode"),
    status_code: num(row["statuscode"]),
    status_label: fv(row, "statuscode"),

    created_on: parseDt(row["createdon"]),
    modified_on: parseDt(row["modifiedon"]),

    _raw: row,
  }
}

export function mapClientNote(row: Row): Row {
  return {
    note_id: row["bcs_clientnoteid"],
    name: str(row["bcs_name"]),
    note_date: parseDt(row["bcs_date"]),

    notes_text: str(row["bcs_notestext"]),
    status_text: str(row["bcs_status"]),
    primary_risk_driver: str(row["bcs_primaryriskdriver"]),

    action_step: str(row["bcs_actionstep"]),
    action_owner: str(row["bcs_actionowner"]),
    action_deadline: parseDt(row["bcs_actiondeadline"]),

    client_account_id: lookupId(row, "_bcs_account_value"),
    client_account_name: lookupName(row, "_bcs_account_value"),

    owner_id: lookupId(row, "_ownerid_value"),

    state_code: num(row["statecode"]),
    state_label: fv(row, "statecode"),
    status_code: num(row["statuscode"]),
    status_label: fv(row, "statuscode"),

    created_on: parseDt(row["createdon"]),
    modified_on: parseDt(row["modifiedon"]),

    _raw: row,
  }
}

export function mapContract(row: Row): Row {
  return {
    contract_id: row["bcs_contractid"],
    name: str(row["bcs_name"]),

    client_account_id: lookupId(row, "_bcs_client_value"),
    client_account_name: lookupName(row, "_bcs_client_value"),

    contract_start_date: parseDt(row["bcs_contractstartdate"]),
    contract_termination_date: parseDt(row["bcs_contractterminationdate"]),
    contract_renewal_date: parseDt(row["bcs_contractrenewaldate"]),
    initial_term_end: parseDt(row["bcs_initialtermend"]),

    initial_term_length_code: num(row["bcs_initialtermlength"]),
    initial_term_length_label: fv(row, "bcs_initialtermlength"),

    contract_status_code: num(row["bcs_contractstatus"]),
    contract_status_label: fv(row, "bcs_contractstatus"),

    quarterly_retainer: num(row["bcs_quarterlyretainer"]),
    quarterly_retainer_base: num(row["bcs_quarterlyretainer_base"]),
    contract_length_years: num(row["bcs_contractlength"]),

    auto_renew: bool(row["bcs_autorenew"]),
    renew: bool(row["bcs_renew"]),
    renewal_check_in_date: parseDt(row["bcs_renewalcheckindate"]),
    renewal_notice_date: parseDt(row["bcs_renewalnoticedate"]),

    termination_notice_code: num(row["bcs_terminationnotice"]),
    termination_notice_label: fv(row, "bcs_terminationnotice"),
    termination_notice_days_code: num(row["bcs_terminationnoticedays"]),
    termination_notice_days_label: fv(row, "bcs_terminationnoticedays"),
    reason_for_termination_code: num(row["bcs_reasonfortermination"]),
    reason_for_termination_label: fv(row, "bcs_reasonfortermination"),

    payment_terms_code: num(row["bcs_paymentterms"]),
    payment_terms_label: fv(row, "bcs_paymentterms"),
    invoice_delivery_code: num(row["bcs_invoicedelivery"]),
    invoice_delivery_label: fv(row, "bcs_invoicedelivery"),

    scope_code: num(row["bcs_scope"]),
    scope_label: fv(row, "bcs_scope"),
    services_agreement_code: num(row["bcs_servicesagreement"]),
    services_agreement_label: fv(row, "bcs_servicesagreement"),

    contract_url: str(row["bcs_contracturl"]),
    notes: str(row["bcs_notes"]),

    owner_id: lookupId(row, "_ownerid_value"),

    state_code: num(row["statecode"]),
    state_label: fv(row, "statecode"),
    status_code: num(row["statuscode"]),
    status_label: fv(row, "statuscode"),

    created_on: parseDt(row["createdon"]),
    modified_on: parseDt(row["modifiedon"]),

    _raw: row,
  }
}

/**
 * Map a systemuser record into the users table. The Python loader built this
 * table indirectly by harvesting every systemuser GUID seen in a lookup; the
 * automated sync pulls the systemuser entity directly, which is cleaner and
 * also captures users who never appear in a lookup.
 *
 * Note: first_seen_at is intentionally omitted from the payload. On INSERT the
 * column falls back to its DEFAULT now(); on the upsert's UPDATE path it is
 * left untouched — so a user's first_seen_at is preserved across runs.
 */
export function mapSystemUser(row: Row, lastSeenAt: string): Row {
  return {
    user_id: row["systemuserid"],
    display_name: str(row["fullname"]) ?? "<Unknown User>",
    last_seen_at: lastSeenAt,
    is_active: row["isdisabled"] === undefined ? true : !row["isdisabled"],
  }
}
export function mapTask(row: Row): Row {
  return {
    // PK (Dataverse activityid)
    task_id: row["activityid"],

    // Core activity fields
    subject: str(row["subject"]),
    description: str(row["description"]),
    category: str(row["category"]),
    subcategory: str(row["subcategory"]),
    scheduled_start: parseDt(row["scheduledstart"]),
    scheduled_end: parseDt(row["scheduledend"]),
    scheduled_duration_minutes: num(row["scheduleddurationminutes"]),
    actual_start: parseDt(row["actualstart"]),
    actual_end: parseDt(row["actualend"]),
    actual_duration_minutes: num(row["actualdurationminutes"]),
    percent_complete: num(row["percentcomplete"]),
    priority_code: num(row["prioritycode"]),
    priority_label: fv(row, "prioritycode"),
    activity_type_code: str(row["activitytypecode"]),
    is_regular_activity: bool(row["isregularactivity"]),
    is_workflow_created: bool(row["isworkflowcreated"]),
    is_billed: bool(row["isbilled"]),
    on_hold_time: num(row["onholdtime"]),
    last_on_hold_time: parseDt(row["lastonholdtime"]),
    sort_date: parseDt(row["sortdate"]),
    overridden_created_on: parseDt(row["overriddencreatedon"]),

    // regardingobjectid: polymorphic (account / event / contact / ...)
    regarding_id: lookupId(row, "_regardingobjectid_value"),
    regarding_name: lookupName(row, "_regardingobjectid_value"),
    regarding_type: str(
      row["_regardingobjectid_value@Microsoft.Dynamics.CRM.lookuplogicalname"],
    ),

    // Rose custom choice fields
    bcs_task_type_code: num(row["bcs_tasktype"]),
    bcs_task_type_label: fv(row, "bcs_tasktype"),
    bcs_task_subtype_code: num(row["bcs_tasksubtype"]),
    bcs_task_subtype_label: fv(row, "bcs_tasksubtype"),
    bcs_task_priority_code: num(row["bcs_taskpriority"]),
    bcs_task_priority_label: fv(row, "bcs_taskpriority"),
    bcs_legacy_task_type_code: num(row["bcs_legacytasktype"]),
    bcs_legacy_task_type_label: fv(row, "bcs_legacytasktype"),
    bcs_outreach_task_status_code: num(row["bcs_outreachtaskstatus"]),
    bcs_outreach_task_status_label: fv(row, "bcs_outreachtaskstatus"),

    // Rose custom lookups (no FK)
    bcs_account_id: lookupId(row, "_bcs_account_value"),
    bcs_account_name: lookupName(row, "_bcs_account_value"),
    bcs_event_id: lookupId(row, "_bcs_event_value"),
    bcs_event_name: lookupName(row, "_bcs_event_value"),
    bcs_project_id: lookupId(row, "_bcs_project_value"),
    bcs_project_name: lookupName(row, "_bcs_project_value"),
    bcs_master_company_id: lookupId(row, "_bcs_mastercompany_value"),
    bcs_master_company_name: lookupName(row, "_bcs_mastercompany_value"),
    bcs_claimed_by_id: lookupId(row, "_bcs_claimedby_value"),
    bcs_claimed_by_name: lookupName(row, "_bcs_claimedby_value"),
    bcs_current_assignment_id: lookupId(row, "_bcs_currentassignment_value"),
    bcs_current_assignment_name: lookupName(row, "_bcs_currentassignment_value"),

    // Rose custom workflow booleans
    bcs_wc: bool(row["bcs_wc"]),
    bcs_drafting: bool(row["bcs_drafting"]),
    bcs_draft_complete: bool(row["bcs_draftcomplete"]),
    bcs_processed: bool(row["bcs_processed"]),
    bcs_review_complete: bool(row["bcs_reviewcomplete"]),
    bcs_feedback_received: bool(row["bcs_feedbackreceived"]),
    bcs_notified: bool(row["bcs_notified"]),
    bcs_fix_last_activity: bool(row["bcs_fixlastactivity"]),
    bcs_invalid_duration_save: bool(row["bcs_invaliddurationsave"]),
    bcs_claim_it: bool(row["bcs_claimit"]),
    bcs_earnings_release: bool(row["bcs_earningsrelease"]),
    bcs_corporate_calendar: bool(row["bcs_corporatecalendar"]),
    bcs_marketing_presentation: bool(row["bcs_marketingpresentation"]),
    bcs_meeting_history: bool(row["bcs_meetinghistory"]),
    bcs_peer_group: bool(row["bcs_peergroup"]),
    bcs_perception_study: bool(row["bcs_perceptionstudy"]),
    bcs_shareholder_register: bool(row["bcs_shareholderregister"]),
    bcs_analyst_research: bool(row["bcs_analystresearch"]),
    bcs_irplan: bool(row["bcs_irplan"]),

    // Rose custom other-typed fields
    bcs_duration: num(row["bcs_duration"]),
    bcs_document: str(row["bcs_document"]),
    bcs_onboarding_notes: str(row["bcs_onboardingnotes"]),
    bcs_bulk_upload: parseDt(row["bcs_bulkupload"]),
    bcs_manual_upload: parseDt(row["bcs_manualupload"]),
    bcs_last_scheduled_process: parseDt(row["bcs_lastscheduledprocess"]),
    crdfa_feedback_received_date: parseDt(row["crdfa_feedbackreceiveddate"]),

    // Standard Dataverse system fields
    owner_id: lookupId(row, "_ownerid_value"),
    owner_name: lookupName(row, "_ownerid_value"),
    created_by_id: lookupId(row, "_createdby_value"),
    created_by_name: lookupName(row, "_createdby_value"),
    modified_by_id: lookupId(row, "_modifiedby_value"),
    modified_by_name: lookupName(row, "_modifiedby_value"),
    state_code: num(row["statecode"]),
    state_label: fv(row, "statecode"),
    status_code: num(row["statuscode"]),
    status_label: fv(row, "statuscode"),
    created_on: parseDt(row["createdon"]),
    modified_on: parseDt(row["modifiedon"]),

    _raw: row,
  }
}

export function mapOOO(row: Row): Row {
  return {
    // PK (Dataverse new_vacationrequestid)
    ooo_id: row["new_vacationrequestid"],

    // Core OOO fields
    name: str(row["new_name"]),
    start_date: parseDt(row["new_startdate"]),
    end_date: parseDt(row["new_enddate"]),
    duration: num(row["new_duration"]),
    pto_type: str(row["new_ptotype"]),
    request_status_code: num(row["new_requeststatus"]),
    request_status_label: fv(row, "new_requeststatus"),
    request_type_code: num(row["new_requesttype"]),
    request_type_label: fv(row, "new_requesttype"),
    description_comments: str(row["new_descriptioncomments"]),
    review_comments: str(row["new_reviewcomments"]),
    reviewed_by: str(row["new_reviewedby"]),
    reviewing_team_id: lookupId(row, "_new_reviewingteam_value"),
    reviewing_team_name: lookupName(row, "_new_reviewingteam_value"),

    // ownerid == "Requested By" (Decision 12)
    requested_by_id: lookupId(row, "_ownerid_value"),
    requested_by_name: lookupName(row, "_ownerid_value"),

    // Standard Dataverse system fields
    created_by_id: lookupId(row, "_createdby_value"),
    created_by_name: lookupName(row, "_createdby_value"),
    modified_by_id: lookupId(row, "_modifiedby_value"),
    modified_by_name: lookupName(row, "_modifiedby_value"),
    state_code: num(row["statecode"]),
    state_label: fv(row, "statecode"),
    status_code: num(row["statuscode"]),
    status_label: fv(row, "statuscode"),
    created_on: parseDt(row["createdon"]),
    modified_on: parseDt(row["modifiedon"]),
    overridden_created_on: parseDt(row["overriddencreatedon"]),

    _raw: row,
  }
}
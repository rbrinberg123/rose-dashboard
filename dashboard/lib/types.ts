/**
 * Row types for the computed views. Keep these aligned with sql/03_views.sql.
 * Any column that can be NULL in the underlying view is typed `| null`.
 *
 * If a view's column list changes, run scripts/smoke.mjs to print the actual
 * shape, then update this file.
 */

// -----------------------------------------------------------------------------
// Read-only rows surfaced by the Exception Report. Each shape is shaped to
// the section it powers, not to a single underlying view — see
// app/exceptions/data.ts for how they're built.
// -----------------------------------------------------------------------------

export type MissingPersonRow = {
  meeting_id: string
  meeting_date: string
  client_account_name: string | null
  institution_name: string | null
  /** "booker", "host", or "both" — derived in data.ts. */
  missing: "booker" | "host" | "both"
}

export type MissingSalaryRow = {
  /** Synthesised key (meeting_id + role) so each missing-salary side gets its own row. */
  key: string
  meeting_id: string
  meeting_date: string
  user_id: string | null
  user_name: string | null
  role: "booker" | "host"
  client_account_name: string | null
  estimated_cost_loss: number
}

export type NoOverheadAllocRow = {
  client_account_id: string
  client_account_name: string | null
  current_quarter_revenue: number
  current_quarter_margin: number
}

export type OverheadOverrunRow = {
  period_year: number
  period_quarter: number
  total_pot: number
  overrides_total: number
  overrun_amount: number
}

export type NullMeetingTypeRow = {
  meeting_id: string
  meeting_date: string
  client_account_name: string | null
  host_name: string | null
  booker_name: string | null
}

// -----------------------------------------------------------------------------
// Rose-owned table rows (admin pages write to these). Keep aligned with
// sql/02_rose_owned_tables.sql.
// -----------------------------------------------------------------------------

export type CostAssumptionsRow = {
  id: number
  work_hours_per_year: number
  booker_hours_per_meeting_base: number
  host_hours_per_meeting_base: number
  in_person_multiplier: number
  default_benefits_multiplier: number
  primary_manager_hours_monthly: number
  secondary_manager_hours_monthly: number
  updated_at: string
}

export type SalaryScheduleRow = {
  id: number
  user_id: string
  effective_from: string
  effective_to: string | null
  annual_salary: number
  annual_bonus: number
  benefits_multiplier: number
  notes: string | null
  created_at: string
  updated_at: string
}

export type ClientDirectCostRow = {
  id: number
  client_account_id: string
  cost_date: string
  amount: number
  category: "T&E" | "Event Fee" | "Sponsorship" | "External Research" | "Other"
  description: string | null
  created_by_user_id: string | null
  created_at: string
}

export const DIRECT_COST_CATEGORIES = [
  "T&E",
  "Event Fee",
  "Sponsorship",
  "External Research",
  "Other",
] as const

export type OverheadPeriodRow = {
  id: number
  period_year: number
  period_quarter: number
  total_overhead_amount: number
  notes: string | null
  created_at: string
  updated_at: string
}

export type OverheadOverrideRow = {
  id: number
  client_account_id: string
  period_year: number
  period_quarter: number
  fixed_amount: number | null
  percent_of_total: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type RevenueOverrideRow = {
  id: number
  client_account_id: string
  period_year: number
  period_quarter: number
  adjustment_amount: number
  reason: string
  created_at: string
}

/** Minimal account record for client-picker dropdowns. */
export type AccountOption = {
  account_id: string
  name: string
  ticker_symbol: string | null
}

/** Minimal user record for the Salary Schedule user-picker dropdown. */
export type UserOption = {
  user_id: string
  display_name: string | null
}

// -----------------------------------------------------------------------------
// View row types
// -----------------------------------------------------------------------------

export type AnalystActivityRow = {
  user_id: string
  display_name: string | null
  period_year: number
  period_quarter: number
  meetings_booked: number
  meetings_hosted: number
  meetings_in_person_hosted: number
  meetings_virtual_hosted: number
  meetings_cancelled_booked: number
  meetings_cancelled_hosted: number
  feedback_collected_hosted: number
  feedback_collection_rate: number | null
  total_labor_cost_attributed: number
}

export type ProductivityPersonMeetingRow = {
  user_id: string
  // Canonical identity (folds duplicate Dynamics ids for the same person via
  // public.canonical_user_id). Group per-person aggregates by THIS, not user_id.
  canonical_user_id: string
  display_name: string | null
  meeting_id: string
  meeting_date: string
  role: "booker" | "host"
  client_account_id: string | null
  is_in_person: boolean
  meeting_status_label: string | null
  feedback_status_label: string | null
  group_meeting: boolean
  attributed_cost: number
}

export type ProductivityAggregateRow = {
  user_id: string
  display_name: string | null
  primary_manager_count: number
  secondary_manager_count: number
  booked: number
  hosted: number
  in_person_hosted: number
  virtual_hosted: number
  feedback: number
  // Confirmed host feedback records whose feedback reached a closed status
  // (feedback_status_label IN 'Closed - All in', 'Closed - No Feedback') —
  // the denominator of feedback_rate. Counted RAW (per institution-level
  // record, not group-deduped), matching the Client / Institution Detail and
  // Statistics views (ltm_feedback_total_closed / assigned).
  feedback_closed: number
  feedback_rate: number | null
  labor_cost: number
}

export type ProductivityPersonManagerStatsRow = {
  user_id: string
  display_name: string | null
  primary_manager_account_count: number
  secondary_manager_account_count: number
}

/** One row per person from v_person_role_ttm — trailing-12-month activity. */
export type PersonRoleTtmRow = {
  user_id: string
  booked_ttm: number
  hosted_ttm: number
  total_ttm: number
}

// Per-person active-client counts in each account role (v_capacity_account_roles).
// "Active" = accounts.state_label = 'Active' (the app-wide active-client
// definition). Feeds the Capacity page's account-management hours.
export type CapacityAccountRolesRow = {
  user_id: string
  display_name: string | null
  am_client_count: number
  secondary_client_count: number
  associate_client_count: number
}

/** Trailing-12-month role classification. null = not enough activity. */
export type PersonRole = "Host" | "Booker" | "Hybrid" | null

// Per-person booked/hosted counts over two windows (v_person_activity_windows).
// Confirmed meetings, firm-wide; keyed by user_id (matches v_person_role_ttm).
export type PersonActivityWindowsRow = {
  user_id: string
  display_name: string
  booked_30d: number
  hosted_30d: number
  booked_1y: number
  hosted_1y: number
}

// Per-person feedback completion over two windows (v_person_feedback_windows).
// Host-attributed, confirmed, firm-wide. assigned = resolved feedback
// assignments (Closed - All in + Closed - No Feedback); collected = Closed - All in.
export type PersonFeedbackWindowsRow = {
  user_id: string
  display_name: string
  assigned_30d: number
  collected_30d: number
  assigned_1y: number
  collected_1y: number
  // Prior 12 months (13th–24th months back) — firm-wide YoY trend on the KPI card.
  assigned_prev_1y: number
  collected_prev_1y: number
}

/** Aggregate row plus its trailing-12-month role (joined by user_id). */
export type ProductivityRoleRow = ProductivityAggregateRow & {
  role: PersonRole
  total_ttm: number
}

export type FeedbackOverallRow = {
  period_year: number
  period_quarter: number
  total_meetings: number
  meetings_with_feedback: number
  feedback_rate: number | null
}

export type FeedbackByClientRow = {
  client_account_id: string
  client_account_name: string | null
  period_year: number
  period_quarter: number
  total_meetings: number
  meetings_with_feedback: number
  feedback_rate: number | null
}

export type FeedbackByAnalystRow = {
  user_id: string
  display_name: string | null
  period_year: number
  period_quarter: number
  total_hosted: number
  hosted_with_feedback: number
  feedback_rate: number | null
}

export type Pipeline30dRow = {
  meeting_id: string
  meeting_date: string
  client_account_id: string | null
  client_account_name: string | null
  institution_name: string | null
  investor_text: string | null
  host_id: string | null
  host_name: string | null
  booker_id: string | null
  booker_name: string | null
  is_in_person: boolean | null
  meeting_type_label: string | null
  group_meeting: boolean | null
  meeting_status_label: string | null
  days_until: number
}

export type ContractRenewalRow = {
  contract_id: string
  client_account_id: string | null
  client_account_name: string | null
  contract_status_label: string | null
  contract_renewal_date: string
  days_to_renewal: number
  renewal_notice_date: string | null
  days_to_notice: number | null
  quarterly_retainer: number | null
  auto_renew: boolean | null
  renew: boolean | null
  contract_termination_date: string | null
  renewal_urgency: "overdue" | "urgent" | "soon" | "future"
}

export type ClientQuarterlyPnlRow = {
  client_account_id: string
  client_account_name: string | null
  period_year: number
  period_quarter: number
  revenue: number
  contract_revenue: number
  revenue_adjustment: number
  meeting_labor_cost: number
  meeting_count: number
  direct_cost: number
  overhead_share: number
  margin: number
  margin_pct: number | null
  has_missing_salary: boolean
  has_no_overhead_alloc: boolean
}

export type ClientPortfolioRow = {
  account_id: string
  name: string
  ticker_symbol: string | null
  sales_lead_primary_name: string | null
  // Other three account-team roles. Not exposed by v_client_portfolio; merged in
  // page-side from the accounts table, keyed by account_id.
  secondary_manager_name: string | null
  associate_name: string | null
  logistics_coordinator_name: string | null
  market_cap_b: number | null
  market_cap_label: string | null
  hq_country_name: string | null
  region_label: string | null
  sector_label: string | null
  quarterly_retainer: number | null
  annualized_retainer: number | null
  meetings_last_365d: number | null
  meetings_last_90d: number | null
  // Forward-looking: confirmed meetings scheduled in the next 3 months
  // (v_client_portfolio.meetings_next_3m). The only forward meeting field — the
  // counterpart to the trailing meetings_last_* counts above.
  meetings_next_3m: number | null
  unique_institutions_last_365d: number | null
  last_meeting_date: string | null
  last_event_date: string | null
  last_note_date: string | null
  // Latest client-note status flag (At Risk / Stable / Lost / New Client /
  // Strong), normalized in v_client_portfolio; null when the client has no note.
  // note_status_date is that note's own date (a different source from
  // last_note_date above, which is the last touchpoint).
  note_status: string | null
  note_status_date: string | null
  account_state: string | null
  // Contract fields. Not exposed by v_client_portfolio; merged in page-side from
  // v_contract_management, keyed by account_id. Mirrors the Contract tab's source.
  // has_active_contract / total_contract_count drive the DaysLeftPill's
  // Terminated-vs-No-contract distinction; null when the client has no row in
  // v_contract_management at all.
  initial_term_end: string | null
  days_to_expiry: number | null
  auto_renew: boolean | null
  contract_status_label: string | null
  has_active_contract: boolean | null
  total_contract_count: number | null
  // SharePoint contract file link. Not on either view; looked up page-side from
  // the contracts table by contract_id, same as the Contract Management page.
  contract_url: string | null
}

export type ClientStatisticsRow = {
  active_account_count: number
  annualized_retainer_revenue: number
  avg_annualized_retainer: number | null
}

export type ClientStatsBucketRow = {
  bucket: string
  count: number
}

export type ProductivityDetailRow = {
  display_name: string
  meetings_scheduled_12m: number
  meetings_hosted_12m: number
  meetings_in_person_12m: number
  feedback_collected_12m: number
  feedback_closed_12m: number
  feedback_collection_rate_12m: number | null
  active_clients_as_sales_lead: number
  sales_lead_book_annualized: number
}

export type ProductivityDetailInstitutionRow = {
  user_id: string
  institution_name: string
  institution_id: string | null
  booked_count: number
  hosted_count: number
}

export type AnalystMonthlyActivityRow = {
  display_name: string
  period_year: number
  period_month: number
  period_label: string
  meetings_scheduled: number
  meetings_hosted: number
  meetings_in_person: number
  meetings_virtual: number
  feedback_collected: number
  feedback_closed: number
  feedback_collection_rate: number | null
}

export type ContractManagementRow = {
  account_id: string
  client_name: string
  total_contract_count: number
  has_active_contract: boolean
  contract_id: string | null
  contract_start_date: string | null
  initial_term_length_label: string | null
  initial_term_end: string | null
  days_to_expiry: number | null
  renewal_notice_date: string | null
  renewal_check_in_date: string | null
  auto_renew: boolean | null
  quarterly_retainer: number | null
  contract_status_label: string | null
  // Not exposed by v_contract_management; joined in from the contracts table.
  contract_url: string | null
}

export type ClientDetailSummaryRow = {
  account_id: string
  client_name: string
  lifetime_meetings: number
  ltm_meetings: number
  prior_12mo_meetings: number
  ltm_meetings_delta: number
  ltm_unique_institutions: number
  ltm_unique_investors: number
  ltm_feedback_collected: number
  ltm_feedback_total_closed: number
  ltm_feedback_rate: number | null
  client_since: string | null
  sales_lead_name: string | null
  annualized_retainer: number
  dollars_per_meeting_ltm: number | null
  latest_term_end: string | null
  days_to_renewal: number | null
}

export type ClientDetailQuarterlyRow = {
  account_id: string
  period_year: number
  period_quarter: number
  period_label: string
  live_count: number
  virtual_count: number
  total: number
}

// Firm-wide confirmed meetings bucketed by calendar month (v_meetings_monthly).
// One row per (year, month); virtual = is_in_person false, live = true.
export type MeetingsMonthlyRow = {
  period_year: number
  period_month: number
  period_label: string // 'YYYY-MM', sortable
  virtual_count: number
  live_count: number
  total: number
}

export type ClientDetailTopInstitutionRow = {
  account_id: string
  rank: number
  institution_id: string | null
  institution_name: string
  lifetime_count: number
  ltm_count: number
  first_met: string | null
  last_met: string | null
}

export type ClientDetailReachDepthRow = {
  account_id: string
  bucket_label: string
  bucket_order: number
  institution_count: number
}

// Complete per-client institution list (v_client_detail_institutions) — every
// institution a client has met, with the per-client lifetime confirmed meeting
// count. `bucket_order` uses the SAME boundaries as v_client_detail_reach_depth
// (1 / 2-3 / 4-5 / 6-10 / 11+), so grouping by it reproduces the reach-depth
// counts exactly. Backs the Reach Depth drawer.
export type ClientDetailInstitutionRow = {
  account_id: string
  institution_id: string | null
  institution_name: string
  lifetime_count: number
  ltm_count: number
  first_met: string | null
  last_met: string | null
  bucket_order: number
}

export type ClientDetailTopHostRow = {
  account_id: string
  host_name: string
  ltm_count: number
  last_met: string | null
}

export type ClientDetailRecentMeetingRow = {
  account_id: string
  meeting_id: string
  meeting_date: string
  institution_id: string | null
  institution_name: string | null
  host_name: string | null
  meeting_type_label: string | null
  is_in_person: boolean | null
  feedback_status_label: string | null
}

export type ClientDetailActiveContractRow = {
  account_id: string
  contract_id: string
  contract_url: string | null
  contract_status_label: string | null
  current_term_start: string | null
  current_term_end: string | null
  /** Effective renewal point = current_term_end (contract_renewal_date is unreliable for active contracts). */
  renewal_date: string | null
  days_to_renewal: number | null
  auto_renew: boolean | null
  auto_renew_length_label: string | null
  notice_label: string | null
  scope_label: string | null
}

export type ClientDetailRecentNoteRow = {
  account_id: string
  note_id: string
  note_date: string | null
  notes_text: string | null
  status_text: string | null
  primary_risk_driver: string | null
  action_step: string | null
  action_owner: string | null
  action_deadline: string | null
  /** action_deadline − current_date; negative when past. */
  days_to_deadline: number | null
}

export type ClientDetailTouchpointRow = {
  account_id: string
  touchpoint_id: string
  scheduled_start: string | null
  subject: string | null
  touchpoint_type_label: string | null
  direction_code: boolean | null
  actual_duration_minutes: number | null
  description: string | null
}

export type InstitutionSummaryRow = {
  institution_id: string | null
  institution_name: string
  lifetime_meetings: number
  ltm_meetings: number
  prior_12mo_meetings: number
  unique_clients_lifetime: number
  unique_people_lifetime: number
  first_met: string | null
  last_met: string | null
  is_active: boolean
  is_cold: boolean
  is_heavy_hitter: boolean
}

export type InstitutionDetailSummaryRow = {
  institution_id: string | null
  institution_name: string
  lifetime_meetings: number
  ltm_meetings: number
  prior_12mo_meetings: number
  ltm_meetings_delta: number
  lifetime_clients: number
  ltm_clients: number
  lifetime_people: number
  ltm_people: number
  ltm_feedback_collected: number
  ltm_feedback_total_closed: number
  ltm_feedback_rate: number | null
  first_met: string | null
  last_met: string | null
  last_met_client_name: string | null
  last_met_host_name: string | null
}

export type InstitutionDetailQuarterlyRow = {
  institution_id: string | null
  period_year: number
  period_quarter: number
  period_label: string
  live_count: number
  virtual_count: number
  total: number
}

export type InstitutionDetailTopClientRow = {
  institution_id: string | null
  rank: number
  client_account_id: string
  client_account_name: string | null
  lifetime_count: number
  ltm_count: number
  last_met: string | null
}

export type InstitutionDetailStyleRow = {
  institution_id: string | null
  dimension_type: "market_cap" | "sector" | "region"
  bucket_label: string
  bucket_order: number
  client_count: number
}

export type InstitutionDetailTopHostRow = {
  institution_id: string | null
  host_name: string
  host_id: string | null
  ltm_count: number
  last_met: string | null
}

export type InstitutionDetailTopBookerRow = {
  institution_id: string | null
  booker_name: string
  booker_id: string | null
  ltm_count: number
  last_met: string | null
}

export type InstitutionDetailRecentMeetingRow = {
  institution_id: string | null
  meeting_id: string
  meeting_date: string
  client_account_id: string | null
  client_account_name: string | null
  investor_text: string | null
  host_name: string | null
  host_id: string | null
  meeting_type_label: string | null
  is_in_person: boolean | null
}

/**
 * One row per qualifying confirmed meeting on the Institution Style page,
 * carrying its client's style buckets. Aggregated client-side into the
 * institution ranking. See v_institution_style_meetings.
 */
export type InstitutionStyleMeetingRow = {
  institution_id: string | null
  institution_name: string
  client_account_id: string
  market_cap_bucket: string
  sector_bucket: string
  region_bucket: string
  is_ltm: boolean
  meeting_id: string
}

/** Minimal active-client record for the Institution Style client picker. */
export type ActiveClientOption = {
  account_id: string
  name: string
}

/**
 * One row per confirmed, hosted meeting for the Scheduler page (v_scheduler_meetings).
 * Times are Eastern wall-clock: start_minutes is minutes from midnight ET,
 * meeting_day / dow are the Eastern calendar day / ISO weekday. Occupied
 * intervals (1h core + 45m in-person travel buffers) are derived on the page,
 * not in SQL.
 */
export type SchedulerMeetingRow = {
  meeting_id: string
  host_id: string
  host_name: string
  meeting_date: string
  start_minutes: number
  meeting_day: string
  dow: number
  is_in_person: boolean
  client_account_name: string | null
  client_ticker: string | null
  institution_name: string | null
}

/**
 * One row per (host, approved time-off entry) for the Host Calendar
 * (v_scheduler_time_off) — approved time off restricted to people who host
 * meetings, keyed by host_id (the Dynamics systemuser GUID =
 * meetings.host_id = new_vacationrequest.requested_by_id). Built on v_time_off
 * so the OOO/Remote bucketing is shared (one source of truth). start_date /
 * end_date are inclusive calendar days ('YYYY-MM-DD'); all entries are full-day.
 */
export type SchedulerTimeOffRow = {
  host_id: string
  person: string
  start_date: string
  end_date: string
  time_off_type: "OOO" | "Remote"
}

/**
 * One row per approved time-off entry for the Logistics → Time Off calendar
 * (v_time_off). start_date / end_date are calendar days ('YYYY-MM-DD'),
 * inclusive of both ends; a single-day entry has start_date === end_date.
 * time_off_type is the derived two-value bucket: 'Remote' for Remote Work,
 * 'OOO' for everything else. request_type_label is the underlying Dynamics
 * Request Type (e.g. 'Vacation', 'Sick Leave') for tooltips/detail. is_host is
 * true when the person hosts meetings (their user id appears as host_id on >=1
 * meeting) — drives the "Hosts only" filter.
 */
export type TimeOffRow = {
  ooo_id: string
  person: string
  start_date: string
  end_date: string
  time_off_type: "OOO" | "Remote"
  request_type_label: string | null
  is_host: boolean
}

/**
 * One row per confirmed, upcoming, host-less meeting for the Scheduler page's
 * "Unassigned meetings" section (v_scheduler_unassigned). Same Eastern-time
 * basis as SchedulerMeetingRow so occupied-interval conflict checks line up.
 */
export type SchedulerUnassignedRow = {
  meeting_id: string
  meeting_date: string
  start_minutes: number
  meeting_day: string
  is_in_person: boolean
  institution_name: string | null
  client_account_id: string | null
  client_account_name: string | null
  client_ticker: string | null
}

/**
 * One row per concluded, confirmed, hosted meeting whose feedback is still
 * incomplete (v_feedback_outstanding). Powers the Feedback "outstanding
 * feedback" tracker. feedback_status_label is NULL for the blank / no-feedback
 * bucket, or 'Awaiting Additional' for the partial bucket. days_since is the
 * whole-day Eastern gap between the meeting date and Eastern today.
 */
export type FeedbackOutstandingRow = {
  meeting_id: string
  meeting_date: string
  host_id: string
  host_name: string
  client_account_id: string | null
  client_account_name: string | null
  institution_name: string | null
  investor_text: string | null
  is_in_person: boolean
  group_meeting: boolean
  feedback_status_label: string | null
  days_since: number
}

/**
 * One row per active-pipeline event that has a "Feedback" task, from
 * v_feedback_manager. Powers the Feedback Manager concept page. "Done" events
 * (the event's "Feedback Report Sent" task Completed) are EXCLUDED by the view,
 * so `state` is always one of the four active states. meeting_start/end and the
 * meeting tally / pct_closed count only the event's Confirmed meetings, and are
 * DERIVED until the real bcs_event date fields are mirrored. report_sent_state_label
 * is null when the event has no "Feedback Report Sent" task.
 */
export type FeedbackManagerState =
  | "Waiting on Feedback"
  | "Reports Not Started"
  | "Reports In Progress"
  | "Reports Pending Review"

export type FeedbackManagerRow = {
  event_id: string
  event_name: string
  client_account_id: string | null
  client_account_name: string | null
  meeting_start: string | null
  meeting_end: string | null
  meeting_count: number
  fb_closed_all_in: number
  fb_closed_no_feedback: number
  fb_awaiting_additional: number
  fb_no_status: number
  pct_closed: number | null
  feedback_received: boolean
  feedback_received_date: string | null
  feedback_task_state_label: string
  claimed: boolean
  claimed_by_name: string | null
  report_sent_state_label: string | null
  state: FeedbackManagerState
}

/**
 * One confirmed meeting inside a Live Outreach card's right panel. Comes from the
 * jsonb array v_live_outreach.confirmed_meetings (built from public.meetings where
 * meeting_status_label = 'Confirmed'). `contact` is meetings.investor_text and may
 * hold several comma-separated names.
 */
export type LiveOutreachMeeting = {
  meeting_id: string
  meeting_date: string
  institution_name: string | null
  contact: string | null
  // Count of OTHER 'Confirmed' meetings (any date) between this event's client
  // and this meeting's institution, excluding this meeting. Added by the page
  // after the view fetch (not a column on v_live_outreach). null = unknown
  // (missing client or institution) → no history flag. Drives the NEW / count
  // flags via app/live-outreach/history-flag.ts.
  prior_meeting_count?: number | null
}

/**
 * One row per event in the 'Live Outreach' state (v_live_outreach). Powers the
 * Logistics → Live Outreach two-panel cards. See sql/03_views.sql for field
 * provenance; notable points: div_yield comes from accounts._raw (a percent),
 * market_cap_b is in $B, urgency is binary ('High' | 'Standard' | null), and
 * event_mode is derived from the event_location free text.
 */
export type LiveOutreachRow = {
  event_id: string
  event_name: string | null
  client_account_id: string | null
  client_account_name: string | null
  ticker: string | null
  industry: string | null
  div_yield: number | null
  market_cap_b: number | null
  sales_lead_name: string | null
  urgency: "High" | "Standard" | null
  slots_remaining: number | null
  of_slots: number | null
  event_dates: string | null
  event_location: string | null
  event_mode: "Virtual" | "Live" | "Hybrid" | null
  confirmed_meeting_count: number
  confirmed_meetings: LiveOutreachMeeting[]
}

// -----------------------------------------------------------------------------
// v_profiles_upcoming — one row per upcoming meeting for the Logistics →
// Profiles dashboard. week_index is 0 (this week) / 1 (next) / 2 (week after);
// profile_label is the pipeline stage. primary/secondary manager come from the
// client account (meetings carry no manager), so both can be null.
// -----------------------------------------------------------------------------
export type ProfileUpcomingRow = {
  meeting_id: string
  meeting_date: string
  meeting_day: string
  week_index: number
  profile_label: string
  profile_code: number | null
  is_in_person: boolean
  client_account_id: string | null
  client_account_name: string | null
  institution_name: string | null
  primary_manager_name: string | null
  secondary_manager_name: string | null
  event_name: string | null
  // Event-level SharePoint document link (v_profiles_upcoming, joined from the
  // event). NULL until populated; the card shows a muted placeholder meanwhile.
  event_sharepoint_url: string | null
}

/**
 * One row per ACTIVE client for the Logistics → Marketing Status page
 * (v_client_marketing_status). Same client set as v_client_portfolio. All dates
 * are `date` columns serialized as 'YYYY-MM-DD' (no time component). See
 * sql/03_views.sql for the full provenance of each column; in brief:
 *
 *   current_event_name  — event whose [start, end] contains today (ET), earliest
 *                         starting if several; null when none is live.
 *   next_event_date     — soonest future event start date.
 *   last_event_date     — end date of the most recently ended past event.
 *   feedback_collection — count of not-closed meeting-level feedbacks (Confirmed,
 *                         hosted, past; feedback_status_label NULL / 'Awaiting
 *                         Additional'). Same scope as v_feedback_outstanding.
 *   reports_in_creation — count of the client's OPEN 'Feedback' tasks with
 *                         bcs_feedback_received = true; reports_in_creation_due is
 *                         the soonest due date (scheduled_end) among them.
 *   reports_in_review   — count of the client's COMPLETED 'Feedback' tasks whose
 *                         event still has an OPEN 'Feedback Report Sent' task.
 *   report_sent_date    — most recent completed 'Feedback Report Sent' close date
 *                         (actual_end); null until a report has been sent.
 */
export type ClientMarketingStatusRow = {
  account_id: string
  name: string
  ticker_symbol: string | null
  /** Account Manager (accounts.sales_lead_primary_name) — drives the AM filter. */
  sales_lead_primary_name: string | null
  current_event_name: string | null
  /** Current event's id — deep-links the Current Event to Planning's By Event view. */
  current_event_id: string | null
  next_event_date: string | null
  last_event_date: string | null
  feedback_collection: number
  reports_in_creation: number
  reports_in_creation_due: string | null
  reports_in_review: number
  report_sent_date: string | null
}

/**
 * One row per ACTIVE client that still has ≥1 incomplete onboarding step, for
 * the Logistics → Onboarding page (v_client_onboarding). Fully-onboarded clients
 * drop off the view. Scoped to clients whose onboarding started on/after the
 * cutoff date baked into the view (see sql/03_views.sql).
 *
 * The nine f_* booleans are each onboarding step's completion state (true =
 * complete → green check; false = missing → muted dash). filled_count is how
 * many of onboarding_field_count (=9) are complete — the UI's "N/9" ring.
 * days_onboarding is whole days since onboarding_start_date (Dynamics Original
 * Start Date); the UI flags 60+ as stalled. The four account-team names feed the
 * shared AccountTeamAvatars cluster; sales_lead_primary_name drives the AM filter.
 */
export type ClientOnboardingRow = {
  account_id: string
  name: string
  ticker_symbol: string | null
  sales_lead_primary_name: string | null
  secondary_manager_name: string | null
  associate_name: string | null
  logistics_coordinator_name: string | null
  onboarding_start_date: string | null
  days_onboarding: number | null
  f_onboarding_call: boolean
  f_teach_in_date: boolean
  f_calendar: boolean
  f_calendar_confirmed: boolean
  f_meeting_history_received: boolean
  f_distro: boolean
  f_bda_peers: boolean
  f_recurring_call_scheduled: boolean
  f_report: boolean
  filled_count: number
  onboarding_field_count: number
}

// One row per Confirmed meeting of an upcoming event, from v_planning_events.
// Powers the Logistics → Planning tracker (master-detail). The four stage
// VALUES come raw; the UI decides each checkmark (see planning-view.tsx).
export type PlanningEventRow = {
  event_id: string
  event_name: string
  meeting_id: string
  meeting_date: string
  meeting_day: string
  institution_name: string | null
  client_account_id: string | null
  client_account_name: string | null
  is_in_person: boolean
  profile_label: string | null
  calendar_label: string | null
  host_id: string | null
  host_name: string | null
  feedback_status_label: string | null
  primary_manager_name: string | null
  secondary_manager_name: string | null
  is_past: boolean
}

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
  feedback_rate: number | null
  labor_cost: number
}

export type ProductivityPersonManagerStatsRow = {
  user_id: string
  display_name: string | null
  primary_manager_account_count: number
  secondary_manager_account_count: number
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
  market_cap_b: number | null
  market_cap_label: string | null
  hq_country_name: string | null
  region_label: string | null
  sector_label: string | null
  quarterly_retainer: number | null
  annualized_retainer: number | null
  meetings_last_365d: number | null
  meetings_last_90d: number | null
  unique_institutions_last_365d: number | null
  last_meeting_date: string | null
  last_event_date: string | null
  last_note_date: string | null
  account_state: string | null
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

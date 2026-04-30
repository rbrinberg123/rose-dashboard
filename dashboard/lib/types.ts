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
  sector_label: string | null
  exchange_label: string | null
  hq_country_name: string | null
  client_status_label: string | null
  market_cap_b: number | null
  account_state: string | null
  sales_lead_primary_name: string | null
  associate_name: string | null
  targeting_name: string | null
  feedback_report_name: string | null
  contract_status_label: string | null
  quarterly_retainer: number | null
  contract_renewal_date: string | null
  contract_termination_date: string | null
  days_to_renewal: number | null
  auto_renew: boolean | null
  renew: boolean | null
  meetings_last_90d: number | null
  meetings_next_30d: number | null
  last_meeting_date: string | null
  last_touchpoint_date: string | null
  next_event_date: string | null
  last_note_date: string | null
  last_note_status: string | null
  last_note_risk: string | null
  current_quarter_revenue: number | null
  current_quarter_margin: number | null
  current_quarter_margin_pct: number | null
}

/**
 * Row types for the computed views. Keep these aligned with sql/03_views.sql.
 * Any column that can be NULL in the underlying view is typed `| null`.
 *
 * If a view's column list changes, run scripts/smoke.mjs to print the actual
 * shape, then update this file.
 */

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

/**
 * Row types for the computed views. Keep these aligned with sql/03_views.sql.
 * Any column that can be NULL in the underlying view is typed `| null`.
 *
 * If a view's column list changes, run scripts/smoke.mjs to print the actual
 * shape, then update this file.
 */

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

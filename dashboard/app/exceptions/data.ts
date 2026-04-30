import { getSupabaseServer } from "@/lib/supabase"
import type {
  MissingPersonRow,
  MissingSalaryRow,
  NoOverheadAllocRow,
  NullMeetingTypeRow,
  OverheadOverrunRow,
} from "@/lib/types"

/**
 * Aggregate query for the Exception Report. One trip to Supabase per section,
 * running in parallel. Each query returns only the rows that actually fail
 * the rule, so the page never has to filter on the client side.
 *
 * Section D is the odd one out: there's no view that pre-computes the
 * "overrides total exceeds pot" check, so we read overhead_periods and
 * overhead_overrides separately and roll up in JS.
 */

export type ExceptionData = {
  generatedAt: string
  currentYear: number
  currentQuarter: number
  errors: string[]

  missingPeople: MissingPersonRow[]
  missingSalaries: MissingSalaryRow[]
  noOverheadAlloc: NoOverheadAllocRow[]
  overheadOverruns: OverheadOverrunRow[]
  nullMeetingTypes: NullMeetingTypeRow[]
}

export async function loadExceptionData(): Promise<ExceptionData> {
  const sb = getSupabaseServer()

  const now = new Date()
  const currentYear = now.getFullYear()
  // Postgres EXTRACT(QUARTER FROM date) returns 1..4; mirror that here.
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1

  const [
    missingPeopleRes,
    missingSalariesRes,
    noOverheadRes,
    periodsRes,
    overridesRes,
    nullMeetingTypesRes,
  ] = await Promise.all([
    sb
      .from("meetings")
      .select("meeting_id, meeting_date, client_account_name, institution_name, booker_id, host_id")
      .or("booker_id.is.null,host_id.is.null"),
    sb
      .from("v_meeting_costs")
      .select(
        "meeting_id, meeting_date, client_account_name, booker_id, booker_name, host_id, host_name, booker_missing_salary, host_missing_salary, meeting_cost",
      )
      .or("booker_missing_salary.eq.true,host_missing_salary.eq.true"),
    sb
      .from("v_client_quarterly_pnl")
      .select("client_account_id, client_account_name, revenue, margin, has_no_overhead_alloc")
      .eq("period_year", currentYear)
      .eq("period_quarter", currentQuarter)
      .eq("has_no_overhead_alloc", true),
    sb.from("overhead_periods").select("period_year, period_quarter, total_overhead_amount"),
    sb
      .from("overhead_overrides")
      .select("period_year, period_quarter, fixed_amount, percent_of_total"),
    sb
      .from("meetings")
      .select("meeting_id, meeting_date, client_account_name, host_name, booker_name, meeting_type_label")
      .is("meeting_type_label", null),
  ])

  const errors: string[] = []
  for (const [label, res] of [
    ["meetings (missing people)", missingPeopleRes],
    ["v_meeting_costs (missing salaries)", missingSalariesRes],
    ["v_client_quarterly_pnl (no overhead alloc)", noOverheadRes],
    ["overhead_periods", periodsRes],
    ["overhead_overrides", overridesRes],
    ["meetings (null type)", nullMeetingTypesRes],
  ] as const) {
    if (res.error) errors.push(`${label}: ${res.error.message}`)
  }

  // Section A — Meetings with missing booker or host.
  const missingPeople: MissingPersonRow[] = (missingPeopleRes.data ?? []).map((m) => ({
    meeting_id: m.meeting_id as string,
    meeting_date: m.meeting_date as string,
    client_account_name: (m.client_account_name as string | null) ?? null,
    institution_name: (m.institution_name as string | null) ?? null,
    missing:
      m.booker_id == null && m.host_id == null
        ? "both"
        : m.booker_id == null
          ? "booker"
          : "host",
  }))

  // Section B — One row per missing-salary side. A meeting that is missing
  // both booker and host salaries produces two rows.
  const missingSalaries: MissingSalaryRow[] = []
  for (const r of missingSalariesRes.data ?? []) {
    if (r.booker_missing_salary) {
      missingSalaries.push({
        key: `${r.meeting_id}-booker`,
        meeting_id: r.meeting_id as string,
        meeting_date: r.meeting_date as string,
        user_id: (r.booker_id as string | null) ?? null,
        user_name: (r.booker_name as string | null) ?? null,
        role: "booker",
        client_account_name: (r.client_account_name as string | null) ?? null,
        estimated_cost_loss: Number(r.meeting_cost ?? 0),
      })
    }
    if (r.host_missing_salary) {
      missingSalaries.push({
        key: `${r.meeting_id}-host`,
        meeting_id: r.meeting_id as string,
        meeting_date: r.meeting_date as string,
        user_id: (r.host_id as string | null) ?? null,
        user_name: (r.host_name as string | null) ?? null,
        role: "host",
        client_account_name: (r.client_account_name as string | null) ?? null,
        estimated_cost_loss: Number(r.meeting_cost ?? 0),
      })
    }
  }

  // Section C — Clients with revenue and no overhead allocation in the
  // current quarter.
  const noOverheadAlloc: NoOverheadAllocRow[] = (noOverheadRes.data ?? []).map((r) => ({
    client_account_id: r.client_account_id as string,
    client_account_name: (r.client_account_name as string | null) ?? null,
    current_quarter_revenue: Number(r.revenue ?? 0),
    current_quarter_margin: Number(r.margin ?? 0),
  }))

  // Section D — Quarters whose resolved override total exceeds the pot.
  // Resolved $ for an override = fixed_amount, OR percent_of_total × pot.
  // Percent overrides need the period's total to convert, so we compute
  // per-quarter once.
  const periodByYQ = new Map<string, number>()
  for (const p of periodsRes.data ?? []) {
    periodByYQ.set(
      `${p.period_year}-${p.period_quarter}`,
      Number(p.total_overhead_amount ?? 0),
    )
  }

  const overrideTotalsByYQ = new Map<string, number>()
  for (const o of overridesRes.data ?? []) {
    const key = `${o.period_year}-${o.period_quarter}`
    const pot = periodByYQ.get(key) ?? 0
    const resolved =
      o.fixed_amount != null
        ? Number(o.fixed_amount)
        : o.percent_of_total != null
          ? Number(o.percent_of_total) * pot
          : 0
    overrideTotalsByYQ.set(key, (overrideTotalsByYQ.get(key) ?? 0) + resolved)
  }

  const overheadOverruns: OverheadOverrunRow[] = []
  for (const [key, overrideTotal] of overrideTotalsByYQ) {
    const pot = periodByYQ.get(key) ?? 0
    if (overrideTotal > pot) {
      const [y, q] = key.split("-").map(Number)
      overheadOverruns.push({
        period_year: y,
        period_quarter: q,
        total_pot: pot,
        overrides_total: overrideTotal,
        overrun_amount: overrideTotal - pot,
      })
    }
  }
  overheadOverruns.sort((a, b) => {
    if (a.period_year !== b.period_year) return b.period_year - a.period_year
    return b.period_quarter - a.period_quarter
  })

  // Section E — Meetings whose meeting_type_label is NULL.
  const nullMeetingTypes: NullMeetingTypeRow[] = (nullMeetingTypesRes.data ?? []).map((m) => ({
    meeting_id: m.meeting_id as string,
    meeting_date: m.meeting_date as string,
    client_account_name: (m.client_account_name as string | null) ?? null,
    host_name: (m.host_name as string | null) ?? null,
    booker_name: (m.booker_name as string | null) ?? null,
  }))

  return {
    generatedAt: now.toISOString(),
    currentYear,
    currentQuarter,
    errors,
    missingPeople,
    missingSalaries,
    noOverheadAlloc,
    overheadOverruns,
    nullMeetingTypes,
  }
}

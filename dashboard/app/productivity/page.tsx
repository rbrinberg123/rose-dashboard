import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type {
  CostAssumptionsRow,
  PersonRole,
  PersonRoleTtmRow,
  ProductivityAggregateRow,
  ProductivityPersonManagerStatsRow,
  ProductivityPersonMeetingRow,
  ProductivityRoleRow,
} from "@/lib/types"
import { ProductivityView } from "./productivity-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Productivity" }

const YMD = /^\d{4}-\d{2}-\d{2}$/

// User ID for Alyse Saliba — used for the dev-only debug print so we can
// verify the manager-cost formula against the worked example in the spec.
const ALYSE_USER_ID = "21dece0e-62a6-ed11-aad1-0022482a4e0c"

function isValidYmd(s: string): boolean {
  if (!YMD.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && s === d.toISOString().slice(0, 10)
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function defaultRange(): { from: string; to: string } {
  const today = new Date()
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - 365)
  return { from: ymdUtc(start), to: ymdUtc(today) }
}

/** Inclusive day count between two YYYY-MM-DD strings (UTC). */
function inclusiveDays(from: string, to: string): number {
  const f = new Date(`${from}T00:00:00Z`).getTime()
  const t = new Date(`${to}T00:00:00Z`).getTime()
  return Math.round((t - f) / 86_400_000) + 1
}

// Trailing-12-month role from v_person_role_ttm. One symmetric ratio:
// fewer than 25 total actions → unclassified; otherwise Host/Booker when that
// side is >= 70% of total actions, else Hybrid.
const ROLE_MIN_TOTAL = 25
const ROLE_THRESHOLD = 0.7
function deriveRole(bookedTtm: number, hostedTtm: number): PersonRole {
  const total = bookedTtm + hostedTtm
  if (total < ROLE_MIN_TOTAL) return null
  const hostedShare = hostedTtm / total
  if (hostedShare >= ROLE_THRESHOLD) return "Host"
  if (hostedShare <= 1 - ROLE_THRESHOLD) return "Booker"
  return "Hybrid"
}

type SalaryActiveRow = {
  user_id: string
  annual_salary: number | string
  annual_bonus: number | string
  benefits_multiplier: number | string
}

function aggregate(rows: ProductivityPersonMeetingRow[]): ProductivityAggregateRow[] {
  type HostFlags = { in_person: boolean; feedback: boolean }
  type Acc = {
    user_id: string
    display_name: string | null
    booked: number
    laborCost: number
    hostKeyed: Map<string, HostFlags>
    /** (client_account_id, meeting_date) keys for group-meeting host rows
     *  whose attributed_cost has already been counted for this user. A group
     *  meeting with N attendees emits N host rows each carrying the full host
     *  cost; we want that cost in once, not N times. */
    groupHostCostSeen: Set<string>
  }

  const byUser = new Map<string, Acc>()

  for (const r of rows) {
    let acc = byUser.get(r.user_id)
    if (!acc) {
      acc = {
        user_id: r.user_id,
        display_name: r.display_name,
        booked: 0,
        laborCost: 0,
        hostKeyed: new Map(),
        groupHostCostSeen: new Set(),
      }
      byUser.set(r.user_id, acc)
    }
    if (acc.display_name == null && r.display_name != null) {
      acc.display_name = r.display_name
    }

    // Labor-cost accumulation.
    // - booker rows: always add (no dedup, group or not).
    // - host rows on non-group meetings: always add.
    // - host rows on group meetings: add once per (client_account_id,
    //   meeting_date); drop subsequent attendee duplicates. Applies regardless
    //   of meeting status so cancelled group meetings dedup the same way.
    if (r.role === "host" && r.group_meeting) {
      const costKey = `${r.client_account_id ?? "NULL"}|${r.meeting_date}`
      if (!acc.groupHostCostSeen.has(costKey)) {
        acc.groupHostCostSeen.add(costKey)
        acc.laborCost += Number(r.attributed_cost ?? 0)
      }
    } else {
      acc.laborCost += Number(r.attributed_cost ?? 0)
    }

    if (r.role === "booker") {
      acc.booked += 1
      continue
    }

    if (r.meeting_status_label !== "Confirmed") continue

    const key = r.group_meeting
      ? `g|${r.client_account_id ?? "NULL"}|${r.meeting_date}`
      : `m|${r.meeting_id}`
    const existing = acc.hostKeyed.get(key)
    const isFeedback = r.feedback_status_label === "Closed - All in"
    if (existing) {
      // Collapse: keep first row's in_person, OR feedback (any closed counts).
      if (isFeedback) existing.feedback = true
    } else {
      acc.hostKeyed.set(key, { in_person: r.is_in_person, feedback: isFeedback })
    }
  }

  const out: ProductivityAggregateRow[] = []
  for (const acc of byUser.values()) {
    let inPerson = 0
    let virtual = 0
    let feedback = 0
    for (const v of acc.hostKeyed.values()) {
      if (v.in_person) inPerson += 1
      else virtual += 1
      if (v.feedback) feedback += 1
    }
    const hosted = acc.hostKeyed.size
    out.push({
      user_id: acc.user_id,
      display_name: acc.display_name,
      primary_manager_count: 0,
      secondary_manager_count: 0,
      booked: acc.booked,
      hosted,
      in_person_hosted: inPerson,
      virtual_hosted: virtual,
      feedback,
      feedback_rate: hosted > 0 ? feedback / hosted : null,
      labor_cost: acc.laborCost,
    })
  }
  return out
}

export default async function ProductivityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const sp = await searchParams
  const def = defaultRange()
  const rawFrom = typeof sp.from === "string" ? sp.from : ""
  const rawTo = typeof sp.to === "string" ? sp.to : ""
  let from = isValidYmd(rawFrom) ? rawFrom : def.from
  let to = isValidYmd(rawTo) ? rawTo : def.to
  if (from > to) {
    // Reorder rather than discard so a shared link with swapped dates still works.
    const tmp = from
    from = to
    to = tmp
  }

  const sb = getSupabaseServer()
  // Supabase / PostgREST caps a single response at db-max-rows (1,000 by
  // default on Supabase Cloud). v_productivity_person_meeting returns up to
  // ~2 rows per meeting, so a year's range easily exceeds the cap. Paginate
  // to make sure we get every row regardless of the project's setting.
  const PAGE_SIZE = 1000
  const personMeetingRows: ProductivityPersonMeetingRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("v_productivity_person_meeting")
      .select("*")
      .gte("meeting_date", from)
      .lte("meeting_date", to)
      .order("meeting_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      return (
        <PageShell title="Productivity" description="Activity by person over a date range">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="font-medium text-destructive">
              Could not load v_productivity_person_meeting
            </div>
            <div className="mt-1 text-muted-foreground">{error.message}</div>
          </div>
        </PageShell>
      )
    }

    const page = (data ?? []) as ProductivityPersonMeetingRow[]
    personMeetingRows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  const [costRes, statsRes, salaryRes, roleRes] = await Promise.all([
    sb.from("cost_assumptions").select("*").eq("id", 1).maybeSingle(),
    sb.from("v_productivity_person_manager_stats").select("*"),
    sb
      .from("salary_schedule")
      .select("user_id, annual_salary, annual_bonus, benefits_multiplier")
      .lte("effective_from", to)
      .or(`effective_to.is.null,effective_to.gte.${to}`),
    sb.from("v_person_role_ttm").select("*"),
  ])

  const cost = (costRes.data ?? null) as CostAssumptionsRow | null
  const stats = (statsRes.data ?? []) as ProductivityPersonManagerStatsRow[]
  const activeSalary = (salaryRes.data ?? []) as SalaryActiveRow[]
  const roleRows = (roleRes.data ?? []) as PersonRoleTtmRow[]
  // Role is trailing-12-month based (v_person_role_ttm), joined by user_id —
  // independent of the page's selected date range.
  const roleByUser = new Map<string, PersonRoleTtmRow>()
  for (const r of roleRows) roleByUser.set(r.user_id, r)

  const workHoursPerYear = Number(cost?.work_hours_per_year ?? 0)
  const primaryHoursMonthly = Number(cost?.primary_manager_hours_monthly ?? 0)
  const secondaryHoursMonthly = Number(cost?.secondary_manager_hours_monthly ?? 0)
  const monthsInRange = inclusiveDays(from, to) / 30.4

  // Loaded hourly rate for each user whose currently-active salary record
  // (the one whose period contains `to`) we just pulled. Users without a row
  // here get manager cost = 0, matching how missing-salary is treated in
  // v_meeting_costs / v_productivity_person_meeting.
  const hourlyByUser = new Map<string, number>()
  if (workHoursPerYear > 0) {
    for (const r of activeSalary) {
      const salary = Number(r.annual_salary)
      const bonus = Number(r.annual_bonus)
      const benefits = Number(r.benefits_multiplier)
      const loaded = (salary + bonus) * benefits
      hourlyByUser.set(r.user_id, loaded / workHoursPerYear)
    }
  }

  type ManagerInfo = {
    display_name: string | null
    primary_count: number
    secondary_count: number
    manager_cost: number
  }
  const managerByUser = new Map<string, ManagerInfo>()
  for (const s of stats) {
    const hourly = hourlyByUser.get(s.user_id) ?? 0
    const primaryCost =
      Number(s.primary_manager_account_count) * primaryHoursMonthly * monthsInRange * hourly
    const secondaryCost =
      Number(s.secondary_manager_account_count) * secondaryHoursMonthly * monthsInRange * hourly
    managerByUser.set(s.user_id, {
      display_name: s.display_name,
      primary_count: Number(s.primary_manager_account_count),
      secondary_count: Number(s.secondary_manager_account_count),
      manager_cost: primaryCost + secondaryCost,
    })
  }

  const rows = aggregate(personMeetingRows)
  const seen = new Set(rows.map((r) => r.user_id))
  for (const r of rows) {
    const info = managerByUser.get(r.user_id)
    if (!info) continue
    r.primary_manager_count = info.primary_count
    r.secondary_manager_count = info.secondary_count
    r.labor_cost += info.manager_cost
    if (r.display_name == null && info.display_name != null) {
      r.display_name = info.display_name
    }
  }
  // Surface manager-only users (no meeting activity in range, but real
  // manager cost) so their cost isn't hidden.
  for (const [user_id, info] of managerByUser.entries()) {
    if (seen.has(user_id)) continue
    if (info.manager_cost === 0 && info.primary_count === 0 && info.secondary_count === 0) continue
    rows.push({
      user_id,
      display_name: info.display_name,
      primary_manager_count: info.primary_count,
      secondary_manager_count: info.secondary_count,
      booked: 0,
      hosted: 0,
      in_person_hosted: 0,
      virtual_hosted: 0,
      feedback: 0,
      feedback_rate: null,
      labor_cost: info.manager_cost,
    })
  }

  // Temporary diagnostic — shows up in the dev-server terminal. Lets us
  // confirm pagination is doing its job and that the data shape matches
  // what aggregate() expects. Remove once the page is verified working.
  if (process.env.NODE_ENV !== "production") {
    let bookerRows = 0
    let hostRows = 0
    let hostConfirmed = 0
    for (const r of personMeetingRows) {
      if (r.role === "booker") bookerRows += 1
      else if (r.role === "host") {
        hostRows += 1
        if (r.meeting_status_label === "Confirmed") hostConfirmed += 1
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `[productivity] ${from}..${to} total=${personMeetingRows.length} booker=${bookerRows} host=${hostRows} host_confirmed=${hostConfirmed} sample=${JSON.stringify(personMeetingRows[0] ?? null)}`,
    )

    // Worked-example check for Alyse Saliba — intermediate values for the
    // manager-cost formula. Remove once verified.
    const alyseInfo = managerByUser.get(ALYSE_USER_ID)
    const alyseHourly = hourlyByUser.get(ALYSE_USER_ID)
    const alyseRow = rows.find((r) => r.user_id === ALYSE_USER_ID)
    // eslint-disable-next-line no-console
    console.log(
      `[productivity:alyse] months_in_range=${monthsInRange.toFixed(4)} loaded_hourly_rate=${alyseHourly?.toFixed(2) ?? "n/a"} primary_count=${alyseInfo?.primary_count ?? 0} secondary_count=${alyseInfo?.secondary_count ?? 0} primary_cost=${(((alyseInfo?.primary_count ?? 0) * primaryHoursMonthly * monthsInRange * (alyseHourly ?? 0)).toFixed(2))} secondary_cost=${(((alyseInfo?.secondary_count ?? 0) * secondaryHoursMonthly * monthsInRange * (alyseHourly ?? 0)).toFixed(2))} manager_cost_total=${alyseInfo?.manager_cost.toFixed(2) ?? "0"} labor_cost_with_manager=${alyseRow?.labor_cost.toFixed(2) ?? "n/a"}`,
    )
  }

  // Attach trailing-12-month role to each row, joined by user_id.
  const rowsWithRole: ProductivityRoleRow[] = rows.map((r) => {
    const ttm = roleByUser.get(r.user_id)
    const bookedTtm = ttm?.booked_ttm ?? 0
    const hostedTtm = ttm?.hosted_ttm ?? 0
    return {
      ...r,
      role: deriveRole(bookedTtm, hostedTtm),
      total_ttm: ttm?.total_ttm ?? bookedTtm + hostedTtm,
    }
  })

  return (
    <PageShell title="Productivity" description="Activity by person over a date range">
      <ProductivityView from={from} to={to} rows={rowsWithRole} />
    </PageShell>
  )
}

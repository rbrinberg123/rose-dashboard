import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type {
  CostAssumptionsRow,
  PersonRoleTtmRow,
  ProductivityAggregateRow,
  ProductivityPersonManagerStatsRow,
  ProductivityPersonMeetingRow,
  ProductivityRoleRow,
} from "@/lib/types"
import { deriveRole } from "@/lib/person-role"
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
  // Trailing 12 *calendar* months ending today — matches the canonical booked
  // LTM window (interval '12 months', not 365 days) used by the SQL views, so
  // the default-range booked figure lines up with the other pages.
  //
  // The basis is the Eastern-time calendar date, matching the SQL views'
  // (now() AT TIME ZONE 'America/New_York')::date - interval '12 months'. Using
  // UTC here made the lower bound land a day late in the evening (ET) — once UTC
  // has rolled to the next day while ET hasn't — which dropped a meeting sitting
  // exactly on the 12-month boundary from the Summary while Detail / Statistics
  // (ET-based) still counted it. Anchoring to the ET date keeps "today minus 12
  // months" identical across all surfaces.
  const etYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()) // "YYYY-MM-DD" in Eastern time
  const today = new Date(`${etYmd}T00:00:00Z`)
  const start = new Date(today)
  start.setUTCMonth(start.getUTCMonth() - 12)
  return { from: ymdUtc(start), to: ymdUtc(today) }
}

/** Inclusive day count between two YYYY-MM-DD strings (UTC). */
function inclusiveDays(from: string, to: string): number {
  const f = new Date(`${from}T00:00:00Z`).getTime()
  const t = new Date(`${to}T00:00:00Z`).getTime()
  return Math.round((t - f) / 86_400_000) + 1
}

type SalaryActiveRow = {
  user_id: string
  annual_salary: number | string
  annual_bonus: number | string
  benefits_multiplier: number | string
}

function aggregate(rows: ProductivityPersonMeetingRow[]): ProductivityAggregateRow[] {
  // hostKeyed tracks deduped *events* (group meetings collapse to one) and is
  // used ONLY for hosted / in-person / virtual counts. Feedback is counted
  // separately, raw, below — see feedbackRaw / feedbackClosedRaw.
  type HostFlags = { in_person: boolean }
  type Acc = {
    user_id: string
    display_name: string | null
    booked: number
    laborCost: number
    // Raw feedback counts — NOT group-deduped. Feedback is owed per institution
    // in attendance, so a 5-institution group meeting is 5 feedback items. Same
    // collected ÷ closed definition as the detail / Statistics views; closed =
    // 'Closed - All in' + 'Closed - No Feedback'.
    feedbackRaw: number
    feedbackClosedRaw: number
    hostKeyed: Map<string, HostFlags>
    /** (client_account_id, meeting_date) keys for group-meeting host rows
     *  whose attributed_cost has already been counted for this user. A group
     *  meeting with N attendees emits N host rows each carrying the full host
     *  cost; we want that cost in once, not N times. */
    groupHostCostSeen: Set<string>
  }

  const byUser = new Map<string, Acc>()

  for (const r of rows) {
    // Group by canonical identity so a person split across duplicate Dynamics
    // ids collapses to one row. canonical_user_id is resolved in the SQL view
    // (one source of truth); fall back to user_id if the column is absent
    // (e.g. before the view migration is applied).
    const cuid = r.canonical_user_id ?? r.user_id
    let acc = byUser.get(cuid)
    if (!acc) {
      acc = {
        user_id: cuid,
        display_name: r.display_name,
        booked: 0,
        laborCost: 0,
        feedbackRaw: 0,
        feedbackClosedRaw: 0,
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
      // Booked counts Confirmed meetings only — a Cancelled meeting wasn't
      // really booked. NB the labor-cost accumulation above runs regardless of
      // status (cost accrues even on cancelled meetings), so we gate the count
      // here, not the view. Keep the `continue`: booker rows must not fall into
      // the host-dedup logic below.
      if (r.meeting_status_label === "Confirmed") acc.booked += 1
      continue
    }

    if (r.meeting_status_label !== "Confirmed") continue

    // Feedback — counted RAW (per institution-level record, no group dedup).
    // collected = 'Closed - All in'; closed = the resolved closed-feedback set
    // ('Closed - All in' + 'Closed - No Feedback'). Same collected ÷ closed
    // definition as the Client / Institution Detail and Statistics views;
    // 'Awaiting Additional' and null/blank are excluded. Counting raw (not
    // event-deduped) matches those views so all surfaces reconcile.
    if (r.feedback_status_label === "Closed - All in") acc.feedbackRaw += 1
    if (
      r.feedback_status_label === "Closed - All in" ||
      r.feedback_status_label === "Closed - No Feedback"
    ) {
      acc.feedbackClosedRaw += 1
    }

    // hosted / in-person / virtual — counted by deduped EVENT (a group meeting
    // is one hosted event). Deliberately a different unit than feedback above.
    const key = r.group_meeting
      ? `g|${r.client_account_id ?? "NULL"}|${r.meeting_date}`
      : `m|${r.meeting_id}`
    if (!acc.hostKeyed.has(key)) {
      acc.hostKeyed.set(key, { in_person: r.is_in_person })
    }
  }

  const out: ProductivityAggregateRow[] = []
  for (const acc of byUser.values()) {
    let inPerson = 0
    let virtual = 0
    for (const v of acc.hostKeyed.values()) {
      if (v.in_person) inPerson += 1
      else virtual += 1
    }
    const hosted = acc.hostKeyed.size
    const feedback = acc.feedbackRaw
    const feedbackClosed = acc.feedbackClosedRaw
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
      feedback_closed: feedbackClosed,
      // collected ÷ closed (raw, not event-deduped) — matches Client /
      // Institution Detail and Statistics. Null when there are no
      // closed-feedback records (denominator 0).
      feedback_rate: feedbackClosed > 0 ? feedback / feedbackClosed : null,
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
      // Stable TOTAL order for pagination. v_productivity_person_meeting is
      // booker_attribution UNION ALL host_attribution, so each meeting emits two
      // rows sharing the same meeting_id — meeting_id alone is NOT unique, and
      // ordering by it leaves ties whose order can differ between the separate
      // range() queries, silently dropping/duplicating rows at page boundaries.
      // (meeting_id, role) IS unique in this view, so adding role as a tiebreaker
      // guarantees no row falls between or repeats across pages.
      .order("meeting_id", { ascending: true })
      .order("role", { ascending: true })
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
      feedback_closed: 0,
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
    <PageShell title="Productivity" description="Activity by person over a date range" hideHeader canvas>
      <ProductivityView from={from} to={to} rows={rowsWithRole} />
    </PageShell>
  )
}

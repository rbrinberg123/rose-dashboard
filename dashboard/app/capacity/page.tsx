import type { Metadata } from "next"
import { subMonths } from "date-fns"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { deriveRole } from "@/lib/person-role"
import type {
  CapacityAccountRolesRow,
  PersonRoleTtmRow,
  ProductivityPersonMeetingRow,
} from "@/lib/types"
import { CapacityView, type CapacityPerson, type CapacityPeriod } from "./capacity-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Capacity" }

// ---- Model constants (mirror the on-page Assumptions panel) ----------------
const HOURS_PER_DAY = 8
const RATE_BOOK_VIRTUAL = 1.0
const RATE_BOOK_LIVE = 1.5
const RATE_HOST_VIRTUAL = 1.5
const RATE_HOST_LIVE = 3.0
const RATE_FEEDBACK = 1.0
const RATE_ACCOUNT_PER_CLIENT_MONTH = 3.0
const DAYS_PER_MONTH = 30.4 // matches the Productivity manager-cost proration

const PERIODS: CapacityPeriod[] = ["1m", "3m", "1y"]

// How many months back each trailing window covers.
const PERIOD_MONTHS: Record<CapacityPeriod, number> = { "1m": 1, "3m": 3, "1y": 12 }

function isPeriod(s: string): s is CapacityPeriod {
  return (PERIODS as string[]).includes(s)
}

/** Local YYYY-MM-DD (the user's calendar day, not UTC). */
function ymdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Trailing window for the selected period: the last N months ending today
 * (1 Month = today−1mo→today, 3 Months = today−3mo→today, 1 Year =
 * today−12mo→today). Not calendar/to-date periods.
 */
function periodRange(period: CapacityPeriod, today: Date): { from: string; to: string } {
  const start = subMonths(today, PERIOD_MONTHS[period])
  return { from: ymdLocal(start), to: ymdLocal(today) }
}

/** Weekdays (Mon–Fri) in an inclusive YYYY-MM-DD range. */
function weekdaysInRange(from: string, to: string): number {
  let d = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  let n = 0
  while (d <= end) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) n += 1
    d = new Date(d.getTime() + 86_400_000)
  }
  return n
}

/** Inclusive calendar-day count between two YYYY-MM-DD strings. */
function inclusiveDays(from: string, to: string): number {
  const f = new Date(`${from}T00:00:00Z`).getTime()
  const t = new Date(`${to}T00:00:00Z`).getTime()
  return Math.round((t - f) / 86_400_000) + 1
}

// Per-person modeled-hours accumulator from the meeting rows. Replicates the
// Productivity page's confirmed-only + group-meeting dedup so a group meeting
// counts as one hosted meeting (and one feedback) for the host.
type MeetingAgg = {
  display_name: string | null
  booked_virtual: number
  booked_live: number
  hostKeyed: Map<string, { in_person: boolean; feedback: boolean }>
}

function aggregateMeetings(
  rows: ProductivityPersonMeetingRow[],
): Map<string, MeetingAgg> {
  const byUser = new Map<string, MeetingAgg>()
  for (const r of rows) {
    // Confirmed meetings only — applies to booking, hosting, and feedback
    // (matches the Assumptions panel's "Confirmed meetings only").
    if (r.meeting_status_label !== "Confirmed") continue

    let acc = byUser.get(r.user_id)
    if (!acc) {
      acc = {
        display_name: r.display_name,
        booked_virtual: 0,
        booked_live: 0,
        hostKeyed: new Map(),
      }
      byUser.set(r.user_id, acc)
    }
    if (acc.display_name == null && r.display_name != null) {
      acc.display_name = r.display_name
    }

    if (r.role === "booker") {
      if (r.is_in_person) acc.booked_live += 1
      else acc.booked_virtual += 1
      continue
    }

    if (r.role === "host") {
      const key = r.group_meeting
        ? `g|${r.client_account_id ?? "NULL"}|${r.meeting_date}`
        : `m|${r.meeting_id}`
      const isFeedback = r.feedback_status_label === "Closed - All in"
      const existing = acc.hostKeyed.get(key)
      if (existing) {
        if (isFeedback) existing.feedback = true
      } else {
        acc.hostKeyed.set(key, { in_person: r.is_in_person, feedback: isFeedback })
      }
    }
  }
  return byUser
}

export default async function CapacityPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const sp = await searchParams
  const period: CapacityPeriod =
    typeof sp.period === "string" && isPeriod(sp.period) ? sp.period : "1m"

  const { from, to } = periodRange(period, new Date())
  const weekdays = weekdaysInRange(from, to)
  const availableHours = weekdays * HOURS_PER_DAY
  const monthsInRange = inclusiveDays(from, to) / DAYS_PER_MONTH

  const sb = getSupabaseServer()

  // Paginate the meeting view (≤1,000-row PostgREST cap; a long range can
  // exceed it). Same pattern as the Productivity page.
  const PAGE_SIZE = 1000
  const meetingRows: ProductivityPersonMeetingRow[] = []
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
        <PageShell
          title="Capacity"
          description="Per-person utilization across modeled activities"
        >
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
    meetingRows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  const [rolesRes, ttmRes] = await Promise.all([
    sb.from("v_capacity_account_roles").select("*"),
    sb.from("v_person_role_ttm").select("*"),
  ])

  const accountRoles = (rolesRes.data ?? []) as CapacityAccountRolesRow[]
  const ttmByUser = new Map<string, PersonRoleTtmRow>()
  for (const r of (ttmRes.data ?? []) as PersonRoleTtmRow[]) {
    ttmByUser.set(r.user_id, r)
  }

  const meetingAgg = aggregateMeetings(meetingRows)

  // Union of everyone with modeled activity in range OR an active account role.
  type Build = {
    user_id: string
    display_name: string | null
    booking_hours: number
    hosting_hours: number
    feedback_hours: number
    account_hours: number
  }
  const build = new Map<string, Build>()

  function ensure(user_id: string, display_name: string | null): Build {
    let b = build.get(user_id)
    if (!b) {
      b = {
        user_id,
        display_name,
        booking_hours: 0,
        hosting_hours: 0,
        feedback_hours: 0,
        account_hours: 0,
      }
      build.set(user_id, b)
    }
    if (b.display_name == null && display_name != null) b.display_name = display_name
    return b
  }

  for (const [user_id, agg] of meetingAgg) {
    let hostVirtual = 0
    let hostLive = 0
    let feedback = 0
    for (const v of agg.hostKeyed.values()) {
      if (v.in_person) hostLive += 1
      else hostVirtual += 1
      if (v.feedback) feedback += 1
    }
    const b = ensure(user_id, agg.display_name)
    b.booking_hours =
      agg.booked_virtual * RATE_BOOK_VIRTUAL + agg.booked_live * RATE_BOOK_LIVE
    b.hosting_hours = hostVirtual * RATE_HOST_VIRTUAL + hostLive * RATE_HOST_LIVE
    b.feedback_hours = feedback * RATE_FEEDBACK
  }

  for (const r of accountRoles) {
    const clients =
      r.am_client_count + r.secondary_client_count + r.associate_client_count
    if (clients === 0) continue
    const b = ensure(r.user_id, r.display_name)
    b.account_hours = clients * RATE_ACCOUNT_PER_CLIENT_MONTH * monthsInRange
  }

  const people: CapacityPerson[] = []
  for (const b of build.values()) {
    const accounted =
      b.booking_hours + b.hosting_hours + b.feedback_hours + b.account_hours
    if (accounted <= 0) continue // skip people with no modeled activity in range
    const ttm = ttmByUser.get(b.user_id)
    people.push({
      user_id: b.user_id,
      display_name: b.display_name ?? "Unknown",
      role: deriveRole(ttm?.booked_ttm ?? 0, ttm?.hosted_ttm ?? 0),
      booking_hours: b.booking_hours,
      hosting_hours: b.hosting_hours,
      feedback_hours: b.feedback_hours,
      account_hours: b.account_hours,
      accounted_hours: accounted,
    })
  }

  return (
    <PageShell
      title="Capacity"
      description="Per-person utilization across modeled activities"
      hideHeader
      canvas
    >
      <CapacityView
        period={period}
        from={from}
        to={to}
        availableHours={availableHours}
        weekdays={weekdays}
        people={people}
      />
    </PageShell>
  )
}

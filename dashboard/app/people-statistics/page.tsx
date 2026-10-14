import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { deriveRole } from "@/lib/person-role"
import type {
  MeetingsMonthlyRow,
  PersonActivityWindowsRow,
  PersonFeedbackWindowsRow,
  PersonRoleTtmRow,
} from "@/lib/types"
import { PeopleStatisticsView, type PersonActivity } from "./people-statistics-view"
import {
  EXCLUDED_ROLLUP_ID,
  excludedRollupLabel,
  loadProductivityExclusions,
  splitHidden,
} from "@/lib/productivity-exclusions"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Statistics" }

export default async function PeopleStatisticsPage() {
  const sb = getSupabaseServer()

  // Firm-wide monthly meetings (Charts A & B), plus the per-person activity +
  // role views (Chart C). Role/grouping always comes from v_person_role_ttm —
  // the activity view only supplies the bar counts for the two windows.
  const [monthlyRes, roleRes, activityRes, feedbackRes] = await Promise.all([
    sb
      .from("v_meetings_monthly")
      .select("*")
      .order("period_year", { ascending: true })
      .order("period_month", { ascending: true }),
    sb.from("v_person_role_ttm").select("*"),
    sb.from("v_person_activity_windows").select("*"),
    sb.from("v_person_feedback_windows").select("*"),
  ])

  if (monthlyRes.error) {
    return (
      <PageShell title="Statistics" description="Firm-wide meeting analytics">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">
            Could not load v_meetings_monthly
          </div>
          <div className="mt-1 text-muted-foreground">{monthlyRes.error.message}</div>
        </div>
      </PageShell>
    )
  }

  const monthly = (monthlyRes.data ?? []) as MeetingsMonthlyRow[]

  // Join activity ↔ role by user_id; derive the stable TTM role from the role
  // view. If either view is missing (e.g. not yet created in Supabase), Chart C
  // simply shows an empty state while Charts A & B still render.
  const roleByUser = new Map<string, PersonRoleTtmRow>()
  for (const r of (roleRes.data ?? []) as PersonRoleTtmRow[]) {
    roleByUser.set(r.user_id, r)
  }

  const people: PersonActivity[] = (
    (activityRes.data ?? []) as PersonActivityWindowsRow[]
  ).map((a) => {
    const ttm = roleByUser.get(a.user_id)
    return {
      user_id: a.user_id,
      display_name: a.display_name,
      role: deriveRole(ttm?.booked_ttm ?? a.booked_1y, ttm?.hosted_ttm ?? a.hosted_1y),
      booked_30d: a.booked_30d,
      hosted_30d: a.hosted_30d,
      booked_1y: a.booked_1y,
      hosted_1y: a.hosted_1y,
    }
  })

  const feedback = (feedbackRes.data ?? []) as PersonFeedbackWindowsRow[]

  // Exclusions — server-side split (lib/productivity-exclusions.ts). Hidden
  // people leave both per-person charts; each chart gets ONE "Former /
  // Excluded" entry carrying their summed numbers, so the KPI cards (which sum
  // these arrays) are unchanged. Charts A & B read v_meetings_monthly and are
  // untouched.
  const exclusions = await loadProductivityExclusions()
  const activity = splitHidden(people, (p) => p.user_id, exclusions)
  const fb = splitHidden(feedback, (p) => p.user_id, exclusions)

  const shownPeople = [...activity.shown]
  if (activity.hidden.length > 0) {
    const byRole = { Booker: 0, Host: 0, Hybrid: 0 }
    const sum = { booked_30d: 0, hosted_30d: 0, booked_1y: 0, hosted_1y: 0 }
    for (const p of activity.hidden) {
      if (p.role) byRole[p.role] += 1
      sum.booked_30d += p.booked_30d
      sum.hosted_30d += p.hosted_30d
      sum.booked_1y += p.booked_1y
      sum.hosted_1y += p.hosted_1y
    }
    shownPeople.push({
      user_id: EXCLUDED_ROLLUP_ID,
      display_name: excludedRollupLabel(activity.hidden.length),
      role: null,
      ...sum,
      excluded: { members: activity.hidden.length, byRole },
    })
  }

  const shownFeedback = [...fb.shown]
  if (fb.hidden.length > 0) {
    const sum = {
      assigned_30d: 0,
      collected_30d: 0,
      assigned_1y: 0,
      collected_1y: 0,
      assigned_prev_1y: 0,
      collected_prev_1y: 0,
    }
    for (const p of fb.hidden) {
      sum.assigned_30d += p.assigned_30d
      sum.collected_30d += p.collected_30d
      sum.assigned_1y += p.assigned_1y
      sum.collected_1y += p.collected_1y
      sum.assigned_prev_1y += p.assigned_prev_1y
      sum.collected_prev_1y += p.collected_prev_1y
    }
    shownFeedback.push({
      user_id: EXCLUDED_ROLLUP_ID,
      display_name: excludedRollupLabel(fb.hidden.length),
      ...sum,
    })
  }

  return (
    <PageShell title="Statistics" description="Firm-wide meeting analytics" hideHeader canvas>
      <PeopleStatisticsView monthly={monthly} people={shownPeople} feedback={shownFeedback} />
    </PageShell>
  )
}

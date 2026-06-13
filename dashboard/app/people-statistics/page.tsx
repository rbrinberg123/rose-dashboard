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

  return (
    <PageShell title="Statistics" description="Firm-wide meeting analytics" hideHeader canvas>
      <PeopleStatisticsView monthly={monthly} people={people} feedback={feedback} />
    </PageShell>
  )
}

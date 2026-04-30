import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { CostAssumptionsRow, SalaryScheduleRow, UserOption } from "@/lib/types"
import { SalaryScheduleTable } from "./salary-schedule-table"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Salary Schedule" }

export default async function SalarySchedulePage() {
  const sb = getSupabaseServer()

  const [salaryRes, usersRes, costRes] = await Promise.all([
    sb
      .from("salary_schedule")
      .select("*")
      .order("user_id", { ascending: true })
      .order("effective_from", { ascending: false }),
    sb
      .from("users")
      .select("user_id, display_name")
      .order("display_name", { ascending: true }),
    sb.from("cost_assumptions").select("*").eq("id", 1).maybeSingle(),
  ])

  const firstError = salaryRes.error ?? usersRes.error ?? costRes.error
  if (firstError) {
    return (
      <PageShell title="Salary Schedule" description="Compensation history per staff member">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load salary schedule</div>
          <div className="mt-1 text-muted-foreground">{firstError.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (salaryRes.data ?? []) as SalaryScheduleRow[]
  const users = (usersRes.data ?? []) as UserOption[]
  const costDefaults = (costRes.data ?? null) as CostAssumptionsRow | null

  return (
    <PageShell
      title="Salary Schedule"
      description="Compensation history per staff member"
    >
      <SalaryScheduleTable rows={rows} users={users} costDefaults={costDefaults} />
    </PageShell>
  )
}

import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type {
  AnalystMonthlyActivityRow,
  ProductivityDetailInstitutionRow,
  ProductivityDetailRow,
  UserOption,
} from "@/lib/types"
import { ProductivityDetailView } from "./productivity-detail-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Productivity Detail" }

export default async function ProductivityDetailPage() {
  const sb = getSupabaseServer()

  const [summaryRes, monthlyRes, institutionsRes, usersRes] = await Promise.all([
    sb
      .from("v_productivity_detail_summary")
      .select("*")
      .order("display_name", { ascending: true }),
    sb
      .from("v_analyst_monthly_activity")
      .select("*")
      .order("display_name")
      .order("period_year")
      .order("period_month"),
    sb
      .from("v_productivity_detail_institutions")
      .select("*"),
    sb
      .from("users")
      .select("user_id, display_name"),
  ])

  const error =
    summaryRes.error ?? monthlyRes.error ?? institutionsRes.error ?? usersRes.error
  if (error) {
    return (
      <PageShell title="Productivity Detail">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load Productivity Detail view</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (summaryRes.data ?? []) as ProductivityDetailRow[]
  const monthlyRows = (monthlyRes.data ?? []) as AnalystMonthlyActivityRow[]
  const institutionRows = (institutionsRes.data ?? []) as ProductivityDetailInstitutionRow[]
  const userOptions = (usersRes.data ?? []) as UserOption[]

  return (
    <PageShell title="Productivity Detail" hideHeader canvas>
      <ProductivityDetailView
        rows={rows}
        monthlyRows={monthlyRows}
        institutionRows={institutionRows}
        userOptions={userOptions}
      />
    </PageShell>
  )
}

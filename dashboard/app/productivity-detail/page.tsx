import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type {
  AnalystMonthlyActivityRow,
  ProductivityDetailRow,
} from "@/lib/types"
import { ProductivityDetailView } from "./productivity-detail-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Productivity Detail" }

export default async function ProductivityDetailPage() {
  const sb = getSupabaseServer()

  const [summaryRes, monthlyRes] = await Promise.all([
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
  ])

  const error = summaryRes.error ?? monthlyRes.error
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

  return (
    <PageShell title="Productivity Detail">
      <ProductivityDetailView rows={rows} monthlyRows={monthlyRows} />
    </PageShell>
  )
}

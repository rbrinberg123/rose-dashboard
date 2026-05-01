import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { AnalystActivityRow } from "@/lib/types"
import { ProductivityView } from "./productivity-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Productivity" }

export default async function ProductivityPage() {
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("v_analyst_activity")
    .select("*")
    .order("period_year", { ascending: false })
    .order("period_quarter", { ascending: false })
    .order("display_name", { ascending: true })

  if (error) {
    return (
      <PageShell title="Productivity" description="Productivity by user, by quarter">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_analyst_activity</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (data ?? []) as AnalystActivityRow[]

  return (
    <PageShell
      title="Productivity"
      description="Productivity by user, by quarter"
    >
      <ProductivityView rows={rows} />
    </PageShell>
  )
}

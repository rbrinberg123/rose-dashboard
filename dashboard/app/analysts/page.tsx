import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { AnalystActivityRow } from "@/lib/types"
import { AnalystView } from "./analyst-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Analyst Activity" }

export default async function AnalystActivityPage() {
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("v_analyst_activity")
    .select("*")
    .order("period_year", { ascending: false })
    .order("period_quarter", { ascending: false })
    .order("display_name", { ascending: true })

  if (error) {
    return (
      <PageShell title="Analyst Activity" description="Productivity by user, by quarter">
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
      title="Analyst Activity"
      description="Productivity by user, by quarter"
    >
      <AnalystView rows={rows} />
    </PageShell>
  )
}

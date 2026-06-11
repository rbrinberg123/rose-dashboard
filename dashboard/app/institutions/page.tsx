import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { InstitutionSummaryRow } from "@/lib/types"
import { InstitutionsSummaryView } from "./institutions-summary-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Institution Summary" }

export default async function InstitutionsPage() {
  const sb = getSupabaseServer()

  const res = await sb
    .from("v_institution_summary")
    .select("*")
    .order("lifetime_meetings", { ascending: false })
    .range(0, 9999)

  if (res.error) {
    return (
      <PageShell title="Institution Summary">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load Institution Summary view</div>
          <div className="mt-1 text-muted-foreground">{res.error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (res.data ?? []) as InstitutionSummaryRow[]

  return (
    <PageShell title="Institution Summary" hideHeader>
      <InstitutionsSummaryView rows={rows} />
    </PageShell>
  )
}

import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { CostAssumptionsRow } from "@/lib/types"
import { CostAssumptionsForm } from "./cost-assumptions-form"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Cost Assumptions" }

export default async function CostAssumptionsPage() {
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("cost_assumptions")
    .select("*")
    .eq("id", 1)
    .maybeSingle()

  if (error || !data) {
    return (
      <PageShell title="Cost Assumptions" description="Per-meeting hours and multipliers used by the cost model">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">
            {error ? "Could not load cost_assumptions" : "Cost assumptions row missing"}
          </div>
          <div className="mt-1 text-muted-foreground">
            {error?.message ?? "Expected exactly one row with id=1. Re-run sql/04_seed_data.sql."}
          </div>
        </div>
      </PageShell>
    )
  }

  const row = data as CostAssumptionsRow

  return (
    <PageShell
      title="Cost Assumptions"
      description="Per-meeting hours and multipliers used by the cost model"
    >
      <CostAssumptionsForm row={row} />
    </PageShell>
  )
}

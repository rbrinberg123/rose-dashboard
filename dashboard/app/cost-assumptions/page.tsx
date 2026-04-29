import { PageShell, PlaceholderBody } from "@/components/page-shell"

export default function CostAssumptionsPage() {
  return (
    <PageShell
      title="Cost Assumptions"
      description="Per-meeting hours and multipliers used by the cost model"
    >
      <PlaceholderBody what="Single-row settings form (cost_assumptions)" />
    </PageShell>
  )
}

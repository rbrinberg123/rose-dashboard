import { PageShell, PlaceholderBody } from "@/components/page-shell"

export default function DirectCostsPage() {
  return (
    <PageShell
      title="Direct Costs"
      description="T&E, event fees, and ad-hoc client charges"
    >
      <PlaceholderBody what="Append-only entry log (client_direct_costs)" />
    </PageShell>
  )
}

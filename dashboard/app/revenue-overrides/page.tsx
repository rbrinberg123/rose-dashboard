import { PageShell, PlaceholderBody } from "@/components/page-shell"

export default function RevenueOverridesPage() {
  return (
    <PageShell
      title="Revenue Overrides"
      description="Manual adjustments to contract-derived revenue"
    >
      <PlaceholderBody what="Append-only revenue corrections (revenue_overrides)" />
    </PageShell>
  )
}

import { PageShell, PlaceholderBody } from "@/components/page-shell"

export default function QuarterlyOverheadPage() {
  return (
    <PageShell
      title="Quarterly Overhead"
      description="Total overhead pot allocated each quarter"
    >
      <PlaceholderBody what="One row per (year, quarter) (overhead_periods)" />
    </PageShell>
  )
}

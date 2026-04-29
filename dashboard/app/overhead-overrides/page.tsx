import { PageShell, PlaceholderBody } from "@/components/page-shell"

export default function OverheadOverridesPage() {
  return (
    <PageShell
      title="Overhead Overrides"
      description="Direct overhead allocation for advisory clients"
    >
      <PlaceholderBody what="Fixed-or-percent override CRUD (overhead_overrides)" />
    </PageShell>
  )
}

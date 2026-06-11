import { KpiStripSkeleton } from "@/components/loading-skeletons"
import { PageShell } from "@/components/page-shell"

export default function Loading() {
  return (
    <PageShell title="Institution Style/Set Finder">
      <KpiStripSkeleton count={4} />
    </PageShell>
  )
}

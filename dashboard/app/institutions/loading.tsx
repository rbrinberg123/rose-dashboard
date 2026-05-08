import { KpiStripSkeleton } from "@/components/loading-skeletons"
import { PageShell } from "@/components/page-shell"

export default function Loading() {
  return (
    <PageShell title="Institution Summary">
      <KpiStripSkeleton count={4} />
    </PageShell>
  )
}

import { KpiStripSkeleton } from "@/components/loading-skeletons"
import { PageShell } from "@/components/page-shell"

export default function Loading() {
  return (
    <PageShell title="Productivity Detail">
      <KpiStripSkeleton count={6} />
    </PageShell>
  )
}

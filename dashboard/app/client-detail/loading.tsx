import { KpiStripSkeleton } from "@/components/loading-skeletons"
import { PageShell } from "@/components/page-shell"

export default function Loading() {
  return (
    <PageShell title="Client Detail">
      <KpiStripSkeleton count={6} />
    </PageShell>
  )
}

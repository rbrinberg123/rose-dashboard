import { KpiStripSkeleton } from "@/components/loading-skeletons"
import { PageShell } from "@/components/page-shell"

export default function Loading() {
  return (
    <PageShell title="Client Statistics" description="Top-line numbers across the client book">
      <KpiStripSkeleton count={3} />
    </PageShell>
  )
}

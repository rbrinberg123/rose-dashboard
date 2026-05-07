import { KpiStripSkeleton } from "@/components/loading-skeletons"
import { PageShell } from "@/components/page-shell"

export default function Loading() {
  return (
    <PageShell title="Contract Management" description="All active clients · sorted by soonest contract expiry">
      <KpiStripSkeleton count={5} />
    </PageShell>
  )
}

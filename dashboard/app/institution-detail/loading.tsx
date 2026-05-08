import { KpiStripSkeleton } from "@/components/loading-skeletons"
import { PageShell } from "@/components/page-shell"

export default function Loading() {
  return (
    <PageShell title="Institution Detail">
      <KpiStripSkeleton count={5} />
    </PageShell>
  )
}

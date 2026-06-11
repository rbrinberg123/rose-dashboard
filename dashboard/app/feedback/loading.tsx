import { PageShell } from "@/components/page-shell"
import { Skeleton } from "@/components/ui/skeleton"
import { KpiStripSkeleton, TableSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <PageShell title="Feedback">
      <KpiStripSkeleton count={5} />
      <div className="mb-4 flex gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="mt-4">
        <TableSkeleton columns={6} rows={6} />
      </div>
    </PageShell>
  )
}

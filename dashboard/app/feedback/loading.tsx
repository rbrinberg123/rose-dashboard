import { PageShell } from "@/components/page-shell"
import { Skeleton } from "@/components/ui/skeleton"
import { KpiStripSkeleton, TableSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <PageShell
      title="Feedback Discipline"
      description="Are we collecting feedback on the meetings we host?"
    >
      <div className="mb-4 flex gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-28" />
      </div>
      <KpiStripSkeleton count={3} />
      <Skeleton className="h-64 w-full rounded-lg" />
      <div className="mt-4">
        <TableSkeleton columns={6} rows={6} />
      </div>
    </PageShell>
  )
}

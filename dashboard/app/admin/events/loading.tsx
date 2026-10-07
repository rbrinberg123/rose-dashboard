import { PageShell } from "@/components/page-shell"
import { FilterBarSkeleton, TableSkeleton } from "@/components/loading-skeletons"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageShell title="Events Planner" hideHeader canvas>
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-[14px]" />
        <FilterBarSkeleton />
        <TableSkeleton rows={6} columns={8} />
      </div>
    </PageShell>
  )
}

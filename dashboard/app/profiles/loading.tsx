import { PageShell } from "@/components/page-shell"
import { Skeleton } from "@/components/ui/skeleton"
import { KpiStripSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <PageShell title="Profiles">
      <KpiStripSkeleton count={5} />
      <div className="mb-4 flex gap-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </PageShell>
  )
}

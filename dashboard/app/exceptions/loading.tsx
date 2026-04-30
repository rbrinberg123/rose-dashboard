import { PageShell } from "@/components/page-shell"
import { Skeleton } from "@/components/ui/skeleton"
import { KpiStripSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <PageShell
      title="Exception Report"
      description="Data quality issues affecting cost calculations and margin accuracy."
    >
      <KpiStripSkeleton count={5} />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </PageShell>
  )
}

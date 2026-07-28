import { PageShell } from "@/components/page-shell"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageShell title="Docs" hideHeader canvas>
      <div className="space-y-6">
        <Skeleton className="h-20 w-full rounded-[14px]" />
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Skeleton className="h-64 w-full rounded-[14px]" />
          <Skeleton className="h-[480px] w-full rounded-[14px]" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-[13px]" />
          ))}
        </div>
      </div>
    </PageShell>
  )
}

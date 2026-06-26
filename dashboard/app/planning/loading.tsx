import { PageShell } from "@/components/page-shell"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageShell title="Planning">
      <Skeleton className="mb-4 h-20 w-full" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    </PageShell>
  )
}

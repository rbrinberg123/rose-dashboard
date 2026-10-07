import { PageShell } from "@/components/page-shell"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageShell title="FB Coming Soon" hideHeader canvas>
      <Skeleton className="mb-4 h-12 w-full" />
      <Skeleton className="mb-4 h-20 w-full" />
      <Skeleton className="h-64 w-full" />
    </PageShell>
  )
}

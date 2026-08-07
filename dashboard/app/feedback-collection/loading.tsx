import { PageShell } from "@/components/page-shell"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageShell title="Feedback Collection">
      <Skeleton className="mb-4 h-20 w-full" />
      <Skeleton className="h-96 w-full" />
    </PageShell>
  )
}

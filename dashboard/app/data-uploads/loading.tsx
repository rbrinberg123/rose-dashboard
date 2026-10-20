import { PageShell } from "@/components/page-shell"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageShell title="Data Uploads" canvas>
      <Skeleton className="mb-4 h-10 w-full" />
      <Skeleton className="h-64 w-full" />
    </PageShell>
  )
}

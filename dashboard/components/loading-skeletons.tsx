import { Skeleton } from "@/components/ui/skeleton"
import { PageShell } from "@/components/page-shell"

/**
 * Shared loading skeletons. Each one mimics the rough shape of the final
 * content so the layout doesn't jump when real data arrives. Used by the
 * per-route loading.tsx files.
 */

export function KpiStripSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
      style={count > 4 ? { gridTemplateColumns: `repeat(${Math.min(count, 6)}, minmax(0, 1fr))` } : undefined}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-32" />
          <Skeleton className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
  )
}

export function FilterBarSkeleton() {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-8 w-44" />
      <Skeleton className="h-8 w-44" />
      <Skeleton className="ml-auto h-3 w-24" />
    </div>
  )
}

export function TableSkeleton({
  rows = 8,
  columns = 6,
}: {
  rows?: number
  columns?: number
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-20" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="px-3 py-3">
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {Array.from({ length: columns }).map((_, c) => (
                <Skeleton key={c} className="h-4 w-full max-w-32" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TablePageSkeleton({
  title,
  description,
  kpis = 4,
  columns = 6,
  rows = 8,
  withFilters = true,
}: {
  title: string
  description?: string
  kpis?: number
  columns?: number
  rows?: number
  withFilters?: boolean
}) {
  return (
    <PageShell title={title} description={description}>
      {kpis > 0 ? <KpiStripSkeleton count={kpis} /> : null}
      {withFilters ? <FilterBarSkeleton /> : null}
      <TableSkeleton rows={rows} columns={columns} />
    </PageShell>
  )
}

export function FormPageSkeleton({
  title,
  description,
  fields = 6,
}: {
  title: string
  description?: string
  fields?: number
}) {
  return (
    <PageShell title={title} description={description}>
      <div className="max-w-2xl space-y-4 rounded-lg border border-border bg-card p-6">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
        <Skeleton className="h-9 w-28" />
      </div>
    </PageShell>
  )
}

import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Database Health"
      description="Mirror-table row counts, sync watermarks, and recent errors"
      kpis={0}
      columns={5}
      rows={9}
      withFilters={false}
    />
  )
}

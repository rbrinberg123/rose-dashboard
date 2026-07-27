import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Deletion Reconciliation"
      description="Records deleted in Dynamics, awaiting review (sweep runs 5 AM UTC)"
      kpis={0}
      columns={3}
      rows={6}
    />
  )
}

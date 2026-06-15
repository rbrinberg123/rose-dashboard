import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Capacity"
      description="Per-person utilization across modeled activities"
      kpis={0}
      columns={6}
      rows={10}
    />
  )
}

import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Pipeline (Next 30 Days)"
      description="Upcoming meetings by client and event"
      kpis={4}
      columns={9}
      rows={10}
    />
  )
}

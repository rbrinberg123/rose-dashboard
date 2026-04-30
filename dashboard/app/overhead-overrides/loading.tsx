import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Overhead Overrides"
      description="Direct overhead allocation for advisory clients"
      kpis={0}
      columns={6}
      rows={10}
    />
  )
}

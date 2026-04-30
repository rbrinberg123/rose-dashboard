import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Revenue Overrides"
      description="Manual adjustments to contract-derived revenue"
      kpis={0}
      columns={6}
      rows={10}
    />
  )
}

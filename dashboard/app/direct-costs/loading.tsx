import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Direct Costs"
      description="T&E, event fees, and ad-hoc client charges"
      kpis={0}
      columns={6}
      rows={10}
    />
  )
}

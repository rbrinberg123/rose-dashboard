import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Contract Renewals"
      description="Renewal calendar and ARR exposure"
      kpis={4}
      columns={7}
      rows={10}
    />
  )
}

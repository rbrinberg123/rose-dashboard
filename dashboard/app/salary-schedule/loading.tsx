import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Salary Schedule"
      description="Compensation history per staff member"
      kpis={0}
      columns={6}
      rows={10}
    />
  )
}

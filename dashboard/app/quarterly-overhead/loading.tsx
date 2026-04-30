import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Quarterly Overhead"
      description="Total overhead pot allocated each quarter"
      kpis={0}
      columns={5}
      rows={8}
    />
  )
}

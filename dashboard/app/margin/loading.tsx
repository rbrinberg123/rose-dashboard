import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Margin by Client"
      description="Revenue minus labor, direct costs, and overhead"
      kpis={4}
      columns={8}
      rows={10}
    />
  )
}

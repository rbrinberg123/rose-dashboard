import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Productivity"
      description="Activity by person over a date range"
      kpis={0}
      columns={8}
      rows={10}
    />
  )
}

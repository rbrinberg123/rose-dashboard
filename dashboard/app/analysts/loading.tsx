import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Analyst Activity"
      description="Productivity by user, by quarter"
      kpis={4}
      columns={9}
      rows={10}
    />
  )
}

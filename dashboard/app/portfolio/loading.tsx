import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Client Portfolio"
      description="One row per client — health at a glance"
      kpis={4}
      columns={9}
      rows={10}
    />
  )
}

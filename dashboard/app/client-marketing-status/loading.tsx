import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Client Marketing Status"
      description="One row per active client — event timeline + feedback-report lifecycle"
      kpis={0}
      columns={9}
      rows={12}
    />
  )
}

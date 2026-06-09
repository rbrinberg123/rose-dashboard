import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Sync Status"
      description="Nightly Dynamics → Supabase sync (runs 7 AM UTC)"
      kpis={0}
      columns={5}
      rows={6}
    />
  )
}

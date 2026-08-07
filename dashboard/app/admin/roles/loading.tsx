import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Roles"
      description="Intended page access per role (staging only — no effect on access yet)"
      kpis={0}
      columns={5}
      rows={12}
    />
  )
}

import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Users & Roles"
      description="Staging only — assignments here do not affect real access yet."
      kpis={0}
      columns={2}
      rows={8}
      withFilters={false}
    />
  )
}

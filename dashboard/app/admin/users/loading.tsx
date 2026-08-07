import { TablePageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <TablePageSkeleton
      title="Users"
      description="Live — roles and data scopes set here control real access."
      kpis={0}
      columns={2}
      rows={8}
      withFilters={false}
    />
  )
}

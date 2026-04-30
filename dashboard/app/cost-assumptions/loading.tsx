import { FormPageSkeleton } from "@/components/loading-skeletons"

export default function Loading() {
  return (
    <FormPageSkeleton
      title="Cost Assumptions"
      description="Per-meeting hours and multipliers used by the cost model"
      fields={6}
    />
  )
}

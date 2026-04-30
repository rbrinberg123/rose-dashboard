"use client"

import { ErrorState } from "@/components/error-state"

export default function CostAssumptionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Cost Assumptions"
      description="Per-meeting hours and multipliers used by the cost model"
      error={error}
      reset={reset}
    />
  )
}

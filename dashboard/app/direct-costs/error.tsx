"use client"

import { ErrorState } from "@/components/error-state"

export default function DirectCostsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Direct Costs"
      description="T&E, event fees, and ad-hoc client charges"
      error={error}
      reset={reset}
    />
  )
}

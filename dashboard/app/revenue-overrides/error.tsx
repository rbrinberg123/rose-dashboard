"use client"

import { ErrorState } from "@/components/error-state"

export default function RevenueOverridesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Revenue Overrides"
      description="Manual adjustments to contract-derived revenue"
      error={error}
      reset={reset}
    />
  )
}

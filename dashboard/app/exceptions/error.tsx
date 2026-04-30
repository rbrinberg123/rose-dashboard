"use client"

import { ErrorState } from "@/components/error-state"

export default function ExceptionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Exception Report"
      description="Data quality issues affecting cost calculations and margin accuracy."
      error={error}
      reset={reset}
    />
  )
}

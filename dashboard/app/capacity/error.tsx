"use client"

import { ErrorState } from "@/components/error-state"

export default function CapacityError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Capacity"
      description="Per-person utilization across modeled activities"
      error={error}
      reset={reset}
    />
  )
}

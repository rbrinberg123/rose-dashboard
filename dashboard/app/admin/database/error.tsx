"use client"

import { ErrorState } from "@/components/error-state"

export default function DatabaseHealthError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Database Health"
      description="Mirror-table row counts, sync watermarks, and recent errors"
      error={error}
      reset={reset}
    />
  )
}

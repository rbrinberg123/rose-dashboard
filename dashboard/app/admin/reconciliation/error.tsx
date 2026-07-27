"use client"

import { ErrorState } from "@/components/error-state"

export default function ReconciliationError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Deletion Reconciliation"
      description="Records deleted in Dynamics, awaiting review"
      error={error}
      reset={reset}
    />
  )
}

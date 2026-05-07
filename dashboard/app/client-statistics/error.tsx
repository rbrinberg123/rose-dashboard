"use client"

import { ErrorState } from "@/components/error-state"

export default function ClientStatisticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Client Statistics"
      description="Top-line numbers across the client book"
      error={error}
      reset={reset}
    />
  )
}

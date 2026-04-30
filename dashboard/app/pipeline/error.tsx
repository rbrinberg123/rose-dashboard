"use client"

import { ErrorState } from "@/components/error-state"

export default function PipelineError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Pipeline (Next 30 Days)"
      description="Upcoming meetings by client and event"
      error={error}
      reset={reset}
    />
  )
}

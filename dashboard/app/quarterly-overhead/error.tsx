"use client"

import { ErrorState } from "@/components/error-state"

export default function QuarterlyOverheadError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Quarterly Overhead"
      description="Total overhead pot allocated each quarter"
      error={error}
      reset={reset}
    />
  )
}

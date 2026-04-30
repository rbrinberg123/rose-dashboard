"use client"

import { ErrorState } from "@/components/error-state"

export default function AnalystsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Analyst Activity"
      description="Productivity by user, by quarter"
      error={error}
      reset={reset}
    />
  )
}

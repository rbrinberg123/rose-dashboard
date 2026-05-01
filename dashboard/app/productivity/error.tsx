"use client"

import { ErrorState } from "@/components/error-state"

export default function ProductivityError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Productivity"
      description="Productivity by user, by quarter"
      error={error}
      reset={reset}
    />
  )
}

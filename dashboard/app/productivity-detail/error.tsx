"use client"

import { ErrorState } from "@/components/error-state"

export default function ProductivityDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Productivity Detail"
      error={error}
      reset={reset}
    />
  )
}

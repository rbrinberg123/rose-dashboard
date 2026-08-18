"use client"

import { ErrorState } from "@/components/error-state"

export default function ClientToDoError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="To-Do List"
      description="One row per active client — what needs doing"
      error={error}
      reset={reset}
    />
  )
}

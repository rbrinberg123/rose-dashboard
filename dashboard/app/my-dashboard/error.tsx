"use client"

import { ErrorState } from "@/components/error-state"

export default function MyDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="My Dashboard"
      description="Your to-dos, tasks and clients in one place"
      error={error}
      reset={reset}
    />
  )
}

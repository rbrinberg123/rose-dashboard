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
      title="Outreach Status"
      description="One row per active client — what needs doing"
      error={error}
      reset={reset}
    />
  )
}

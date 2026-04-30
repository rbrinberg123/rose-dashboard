"use client"

import { ErrorState } from "@/components/error-state"

export default function MarginError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Margin by Client"
      description="Revenue minus labor, direct costs, and overhead"
      error={error}
      reset={reset}
    />
  )
}

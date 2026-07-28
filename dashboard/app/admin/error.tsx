"use client"

import { ErrorState } from "@/components/error-state"

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Admin"
      description="System health hub"
      error={error}
      reset={reset}
    />
  )
}

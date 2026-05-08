"use client"

import { ErrorState } from "@/components/error-state"

export default function ClientDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Client Detail"
      error={error}
      reset={reset}
    />
  )
}

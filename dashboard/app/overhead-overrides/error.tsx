"use client"

import { ErrorState } from "@/components/error-state"

export default function OverheadOverridesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Overhead Overrides"
      description="Direct overhead allocation for advisory clients"
      error={error}
      reset={reset}
    />
  )
}

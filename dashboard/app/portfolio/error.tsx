"use client"

import { ErrorState } from "@/components/error-state"

export default function PortfolioError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Client Portfolio"
      description="One row per client — health at a glance"
      error={error}
      reset={reset}
    />
  )
}

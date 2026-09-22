"use client"

import { ErrorState } from "@/components/error-state"

export default function ClientAlertsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Alerts"
      description="Your critical to-dos across feedback, profiles and hosting"
      error={error}
      reset={reset}
    />
  )
}

"use client"

import { ErrorState } from "@/components/error-state"

export default function RenewalsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Contract Renewals"
      description="Renewal calendar and ARR exposure"
      error={error}
      reset={reset}
    />
  )
}

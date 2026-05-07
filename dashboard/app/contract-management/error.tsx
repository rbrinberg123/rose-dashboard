"use client"

import { ErrorState } from "@/components/error-state"

export default function ContractManagementError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Contract Management"
      description="All active clients · sorted by soonest contract expiry"
      error={error}
      reset={reset}
    />
  )
}

"use client"

import { ErrorState } from "@/components/error-state"

export default function InstitutionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Institution Summary"
      error={error}
      reset={reset}
    />
  )
}

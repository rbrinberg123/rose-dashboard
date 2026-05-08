"use client"

import { ErrorState } from "@/components/error-state"

export default function InstitutionDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Institution Detail"
      error={error}
      reset={reset}
    />
  )
}

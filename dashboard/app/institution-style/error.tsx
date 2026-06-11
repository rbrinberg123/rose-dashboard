"use client"

import { ErrorState } from "@/components/error-state"

export default function InstitutionStyleError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Institution Style/Set Finder"
      error={error}
      reset={reset}
    />
  )
}

"use client"

import { ErrorState } from "@/components/error-state"

export default function RolesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Roles"
      description="Intended page access per role (staging only)"
      error={error}
      reset={reset}
    />
  )
}

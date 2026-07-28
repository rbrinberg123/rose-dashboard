"use client"

import { ErrorState } from "@/components/error-state"

export default function DocsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Docs"
      description="Dashboard documentation"
      error={error}
      reset={reset}
    />
  )
}

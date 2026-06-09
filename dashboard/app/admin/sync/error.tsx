"use client"

import { ErrorState } from "@/components/error-state"

export default function SyncStatusError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Sync Status"
      description="Nightly Dynamics → Supabase sync"
      error={error}
      reset={reset}
    />
  )
}

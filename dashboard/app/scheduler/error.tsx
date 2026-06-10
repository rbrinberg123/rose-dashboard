"use client"

import { ErrorState } from "@/components/error-state"

export default function SchedulerError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState title="Scheduler" error={error} reset={reset} />
}

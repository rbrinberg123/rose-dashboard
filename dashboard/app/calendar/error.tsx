"use client"

import { ErrorState } from "@/components/error-state"

export default function CalendarError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState title="Calendar" error={error} reset={reset} />
}

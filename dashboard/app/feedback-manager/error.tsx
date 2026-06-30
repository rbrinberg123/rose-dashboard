"use client"

import { ErrorState } from "@/components/error-state"

export default function FeedbackManagerError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState title="Feedback Manager" error={error} reset={reset} />
}

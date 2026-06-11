"use client"

import { ErrorState } from "@/components/error-state"

export default function FeedbackError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState title="Feedback" error={error} reset={reset} />
}

"use client"

import { ErrorState } from "@/components/error-state"

export default function FeedbackCollectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState title="Feedback Collection" error={error} reset={reset} />
}

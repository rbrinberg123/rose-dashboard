"use client"

import { ErrorState } from "@/components/error-state"

export default function PlanningError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState title="Planning Lab" error={error} reset={reset} />
}

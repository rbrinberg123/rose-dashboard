"use client"

import { ErrorState } from "@/components/error-state"

export default function ClientMarketingStatusError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState title="Client Marketing Status" error={error} reset={reset} />
}

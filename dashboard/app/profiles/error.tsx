"use client"

import { ErrorState } from "@/components/error-state"

export default function ProfilesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState title="Profiles" error={error} reset={reset} />
}

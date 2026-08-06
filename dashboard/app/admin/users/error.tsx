"use client"

import { ErrorState } from "@/components/error-state"

export default function UsersRolesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Users & Roles"
      description="Staging only — assignments here do not affect real access yet."
      error={error}
      reset={reset}
    />
  )
}

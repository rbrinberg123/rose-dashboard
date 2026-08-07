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
      title="Users"
      description="Live — roles and data scopes set here control real access."
      error={error}
      reset={reset}
    />
  )
}

"use client"

import { ErrorState } from "@/components/error-state"

export default function SalaryScheduleError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      title="Salary Schedule"
      description="Compensation history per staff member"
      error={error}
      reset={reset}
    />
  )
}

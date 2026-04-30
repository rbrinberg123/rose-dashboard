import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDateTime } from "@/lib/format"

/**
 * Top-of-page strip showing the rolled-up issue count and the breakdown
 * across the five sections. Generated-at is rendered server-side from the
 * page request time — the spec calls for the actual sync timestamp once
 * the production sync exists; until then this stands in.
 */
export function ExceptionSummaryStrip({
  generatedAt,
  counts,
}: {
  generatedAt: string
  counts: {
    missingPeople: number
    missingSalaries: number
    noOverheadAlloc: number
    overheadOverruns: number
    nullMeetingTypes: number
  }
}) {
  const total =
    counts.missingPeople +
    counts.missingSalaries +
    counts.noOverheadAlloc +
    counts.overheadOverruns +
    counts.nullMeetingTypes

  const breakdown = [
    { label: "Missing people", value: counts.missingPeople },
    { label: "Missing salaries", value: counts.missingSalaries },
    { label: "No overhead alloc", value: counts.noOverheadAlloc },
    { label: "Overhead overruns", value: counts.overheadOverruns },
    { label: "Null meeting types", value: counts.nullMeetingTypes },
  ]

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardDescription>Total issues</CardDescription>
        <CardTitle className="text-3xl tabular-nums">
          {total.toLocaleString()}{" "}
          <span className="text-base font-normal text-muted-foreground">
            across 5 categories
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5">
          {breakdown.map((b) => (
            <div key={b.label} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{b.label}</span>
              <span className="tabular-nums font-medium">{b.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Page generated {formatDateTime(generatedAt)}. (Will switch to actual sync timestamp once the
          production sync is wired in.)
        </p>
      </CardContent>
    </Card>
  )
}

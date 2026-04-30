import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { loadExceptionData } from "./data"
import { ExceptionSummaryStrip } from "./summary-strip"
import { MissingPeopleSection } from "./missing-people-section"
import { MissingSalariesSection } from "./missing-salaries-section"
import { NoOverheadAllocSection } from "./no-overhead-alloc-section"
import { OverheadOverrunSection } from "./overhead-overrun-section"
import { NullMeetingTypeSection } from "./null-meeting-type-section"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Exception Report" }

export default async function ExceptionsPage() {
  const data = await loadExceptionData()

  return (
    <PageShell
      title="Exception Report"
      description="Data quality issues affecting cost calculations and margin accuracy."
    >
      {data.errors.length > 0 ? (
        <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">
            Could not load some exception sources — partial data shown
          </div>
          <ul className="mt-2 list-disc pl-5 text-muted-foreground">
            {data.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ExceptionSummaryStrip
        generatedAt={data.generatedAt}
        counts={{
          missingPeople: data.missingPeople.length,
          missingSalaries: data.missingSalaries.length,
          noOverheadAlloc: data.noOverheadAlloc.length,
          overheadOverruns: data.overheadOverruns.length,
          nullMeetingTypes: data.nullMeetingTypes.length,
        }}
      />

      <div className="space-y-3">
        <MissingPeopleSection rows={data.missingPeople} />
        <MissingSalariesSection rows={data.missingSalaries} />
        <NoOverheadAllocSection
          rows={data.noOverheadAlloc}
          year={data.currentYear}
          quarter={data.currentQuarter}
        />
        <OverheadOverrunSection rows={data.overheadOverruns} />
        <NullMeetingTypeSection rows={data.nullMeetingTypes} />
      </div>
    </PageShell>
  )
}

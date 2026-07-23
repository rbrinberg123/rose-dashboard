import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { MarketingCalendarRow } from "@/lib/types"
import { CalendarView } from "./calendar-view"

// Always fetch fresh — the view is time-windowed (its trailing cutoff moves each
// day) and the underlying events change as the marketing pipeline advances.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Calendar" }

// PostgREST caps a single response at 1,000 rows; page through in chunks the
// same way the other list pages do so the calendar never silently truncates.
const PAGE_SIZE = 1000

export default async function CalendarPage() {
  const sb = getSupabaseServer()

  const rows: MarketingCalendarRow[] = []
  let error: string | null = null
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error: err } = await sb
      .from("v_marketing_calendar")
      .select("*")
      .range(offset, offset + PAGE_SIZE - 1)

    if (err) {
      error = err.message
      break
    }
    const page = (data ?? []) as MarketingCalendarRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  if (error) {
    return (
      <PageShell title="Calendar">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">
            Could not load v_marketing_calendar
          </div>
          <div className="mt-1 text-muted-foreground">{error}</div>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell title="Calendar" hideHeader canvas>
      <CalendarView rows={rows} />
    </PageShell>
  )
}

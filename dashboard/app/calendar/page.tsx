import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity } from "@/lib/effective-identity"
import { resolveClientScope } from "@/lib/access/data-scope"
import { NoClientsAssigned } from "@/components/scoped-empty"
import type { MarketingCalendarRow } from "@/lib/types"
import { CalendarView } from "./calendar-view"

// Always fetch fresh — the view is time-windowed (its trailing cutoff moves each
// day) and the underlying events change as the marketing pipeline advances.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "NDRS Calendar" }

// PostgREST caps a single response at 1,000 rows; page through in chunks the
// same way the other list pages do so the calendar never silently truncates.
const PAGE_SIZE = 1000

export default async function CalendarPage() {
  const sb = getSupabaseServer()

  // Level-2 client scoping (Account Management). On this view the client key is
  // `client_account_id`. null = all; Set = only those; empty = none.
  const scope = await resolveClientScope(await getEffectiveIdentity())
  if (scope && scope.size === 0) {
    return (
      <PageShell title="NDRS Calendar" hideHeader canvas>
        <NoClientsAssigned />
      </PageShell>
    )
  }
  const scopedIds = scope ? [...scope] : null

  const rows: MarketingCalendarRow[] = []
  let error: string | null = null
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = sb.from("v_marketing_calendar").select("*")
    if (scopedIds) query = query.in("client_account_id", scopedIds)
    const { data, error: err } = await query.range(offset, offset + PAGE_SIZE - 1)

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
      <PageShell title="NDRS Calendar">
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
    <PageShell title="NDRS Calendar" hideHeader canvas>
      <CalendarView rows={rows} />
    </PageShell>
  )
}

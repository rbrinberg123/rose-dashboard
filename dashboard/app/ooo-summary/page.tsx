import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { computeOooSummary, type OooRequest } from "@/lib/ooo-summary/compute"
import { OooSummaryView } from "./ooo-summary-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "OOO Summary" }

/**
 * Logistics → OOO Summary (parked page, reachable from Admin → Hidden Pages).
 *
 * The per-person / per-year / per-category tally of time taken. Sibling to the
 * Time Off page, which answers "who is out this week?" — this one answers "how
 * much has each person taken this year, and of what kind?".
 *
 * Reads the `new_vacationrequest` mirror DIRECTLY rather than `v_time_off`,
 * because the tally needs two columns the view does not expose:
 * `description_comments` (the only half-day signal) and `requested_by_id` (the
 * grouping key). The rules live in lib/ooo-summary/compute.ts and are documented
 * in content/docs/11-ooo-summary.md.
 *
 * Access is gated by proxy.ts via canAccessRoute — super users always pass, and
 * every other role is denied until the Roles matrix grants /ooo-summary.
 */
export default async function OooSummaryPage() {
  const sb = getSupabaseServer()

  // ~450 rows, comfortably under the PostgREST 1,000-row cap — one fetch is enough.
  const { data, error } = await sb
    .from("new_vacationrequest")
    .select(
      "ooo_id, requested_by_id, requested_by_name, start_date, end_date, request_type_label, description_comments",
    )

  if (error) {
    return (
      <PageShell title="OOO Summary">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load new_vacationrequest</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
        </div>
      </PageShell>
    )
  }

  // PLUS approved DASHBOARD requests (CRM → Time Off), counted from their exact
  // day rows so AM / PM halves are honoured (see `days` on OooRequest). Pending
  // and Denied never count. Fails soft: before
  // sql/patches/2026-09-24_time_off_requests.sql runs, the table is missing and
  // the summary is simply the Dynamics tally, as before.
  const dash = await sb
    .from("time_off_requests")
    .select(
      "id, requested_by_id, requested_by_name, start_date, end_date, request_type, description, time_off_days(off_date, portion)",
    )
    .eq("status", "Approved")
  const dashboardRequests: OooRequest[] = dash.error
    ? []
    : (
        (dash.data ?? []) as {
          id: string
          requested_by_id: string
          requested_by_name: string | null
          start_date: string
          end_date: string
          request_type: string
          description: string | null
          time_off_days: { off_date: string; portion: string }[] | null
        }[]
      ).map((r) => ({
        ooo_id: r.id,
        requested_by_id: r.requested_by_id,
        requested_by_name: r.requested_by_name,
        start_date: r.start_date,
        end_date: r.end_date,
        request_type_label: r.request_type,
        description_comments: r.description,
        days: (r.time_off_days ?? []).map((d) => ({ date: d.off_date, portion: d.portion })),
      }))

  const summary = computeOooSummary([...((data ?? []) as OooRequest[]), ...dashboardRequests])

  return (
    <PageShell title="OOO Summary" hideHeader canvas>
      <OooSummaryView summary={summary} />
    </PageShell>
  )
}

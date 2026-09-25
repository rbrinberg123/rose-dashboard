import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { dynamicsTotalDays, type TimeOffListRow } from "@/lib/time-off-requests/model"
import { TimeOffRequestsView } from "./time-off-requests-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Time Off" }

const PATCH = "sql/patches/2026-09-24_time_off_requests.sql"

/** More than the whole history (~480 rows today) — a guard, not paging. */
const ROW_CAP = 5000

/**
 * CRM → Time Off (route /time-off-requests; the Logistics calendar keeps
 * /time-off). Every time-off request: the Dynamics history (new_vacationrequest,
 * read-only) UNION the requests created in the dashboard, which run
 * Pending → Approved / Denied. Reads v_admin_time_off_all.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 *   1. proxy.ts: /time-off-requests is in ADMIN_ONLY_ROUTES — super-user-only,
 *      never delegable through the Roles matrix.
 *   2. The EFFECTIVE-role check below, before any data is read.
 *   3. Every server action in ./actions.ts re-checks on its own; writes also
 *      refuse "View as".
 *
 * ~480 rows, so the whole list is fetched once and the filters run in the
 * browser — the same trade the Audit Log makes for its keyword box.
 */
export default async function TimeOffRequestsPage() {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") redirect("/no-access")

  const { data, error } = await getSupabaseServer()
    .from("v_admin_time_off_all")
    .select("*")
    .order("start_date", { ascending: false })
    .order("requested_by_name", { ascending: true })
    .range(0, ROW_CAP - 1)

  if (error) {
    return (
      <PageShell title="Time Off">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_admin_time_off_all</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
          <div className="mt-2 text-muted-foreground">
            If the view does not exist yet, run <code>{PATCH}</code> in Supabase.
          </div>
        </div>
      </PageShell>
    )
  }

  // Dynamics rows carry no usable day count; use the OOO Summary's arithmetic.
  const rows = ((data ?? []) as TimeOffListRow[]).map((r) =>
    r.source === "Dynamics"
      ? { ...r, total_days: dynamicsTotalDays(r.start_date, r.end_date, r.description) }
      : { ...r, total_days: r.total_days == null ? null : Number(r.total_days) },
  )

  return (
    <PageShell title="Time Off" hideHeader canvas>
      <TimeOffRequestsView rows={rows} truncated={rows.length >= ROW_CAP} />
    </PageShell>
  )
}

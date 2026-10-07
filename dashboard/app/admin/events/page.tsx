import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import type { ItineraryListRow } from "@/lib/events-planner/types"
import { ItinerariesView } from "./itineraries-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Events Planner" }

const PATCH = "sql/patches/2026-10-02d_events_planner.sql"

/**
 * Admin → Events Planner (/admin/events). Every itinerary, newest event first.
 * Not CRM → Events (/events), which is the raw CRM event table.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * Reads ep_* with the service-role client (RLS bypassed). Three gates, the same
 * as the other super-user admin pages:
 *   1. proxy.ts: /admin/events is in ADMIN_ONLY_ROUTES;
 *   2. the page gate below, before any data read;
 *   3. every server action in ./actions.ts re-checks on its own.
 */
export default async function EventsPlannerPage() {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") redirect("/no-access")

  const [{ data, error }, identity] = await Promise.all([
    getSupabaseServer()
      .from("v_ep_itineraries_list")
      .select("*")
      .order("start_date", { ascending: false })
      .limit(2000),
    getEffectiveIdentity(),
  ])

  if (error) {
    return (
      <PageShell title="Events Planner">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load itineraries</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
          <div className="mt-2 text-muted-foreground">
            If the tables do not exist yet, run <code>{PATCH}</code> in Supabase.
          </div>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell title="Events Planner" hideHeader canvas>
      <ItinerariesView
        rows={(data ?? []) as ItineraryListRow[]}
        myUserId={identity.userId}
        readOnly={identity.impersonated}
      />
    </PageShell>
  )
}

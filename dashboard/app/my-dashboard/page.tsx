import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { canAccessRoute } from "@/lib/access-control"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { getAllowedRoutes } from "@/lib/page-access"
import { loadMyDashboardCriticalCount } from "./critical-count"
import { loadMyDashboard } from "./load"
import { MyDashboardView } from "./my-dashboard-view"

// Every count, bucket and date here is recomputed on read.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "My Dashboard" }

/**
 * My Dashboard — the personal home page. READ-ONLY.
 *
 * ── GATING ─────────────────────────────────────────────────────────────────
 *   ROUTE — OPEN TO EVERY SIGNED-IN USER WITH A ROLE (2026-10-08):
 *           /my-dashboard is in ALWAYS_ALLOWED_ROUTES (lib/access-control.ts).
 *           A role-less account is sent to /no-access below. To make it
 *           super-user only again, move it to ADMIN_ONLY_ROUTES.
 *   ROWS  — loadMyDashboard() scopes every feed to the viewer and their own
 *           account teams; nobody sees anyone else's dashboard. The app reads
 *           with the service-role key, so the loader IS the gate. See
 *           content/docs/26-my-dashboard.md.
 */
export default async function MyDashboardPage() {
  const role = await getEffectiveRole()
  // No role yet = not onboarded: same place every other page sends them.
  if (!role) redirect("/no-access")
  const allowed = await getAllowedRoutes(role)
  if (!canAccessRoute(role, "/my-dashboard", allowed)) redirect(allowed[0] ?? "/no-access")

  // The "Needs you now" headline is the SAME function as the nav badge (and
  // memoised with it per request), so the two can never disagree.
  const identity = await getEffectiveIdentity()
  const [data, criticalCount] = await Promise.all([
    loadMyDashboard(),
    loadMyDashboardCriticalCount(identity.email).catch(() => 0),
  ])
  return (
    <PageShell title="My Dashboard" hideHeader canvas>
      <MyDashboardView data={data} criticalCount={criticalCount} />
    </PageShell>
  )
}

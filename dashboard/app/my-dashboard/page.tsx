import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { canAccessRoute } from "@/lib/access-control"
import { getEffectiveRole } from "@/lib/effective-identity"
import { getAllowedRoutes } from "@/lib/page-access"
import { loadMyDashboard } from "./load"
import { MyDashboardView } from "./my-dashboard-view"

// Every count, bucket and date here is recomputed on read.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "My Dashboard" }

/**
 * My Dashboard — the personal home page. READ-ONLY.
 *
 * ── GATING ─────────────────────────────────────────────────────────────────
 *   ROUTE — SUPER-USER ONLY for now: /my-dashboard is in ADMIN_ONLY_ROUTES
 *           (lib/access-control.ts) — the one flag, the same gate as FB Coming
 *           Soon. proxy.ts blocks everyone else; the re-check below is defence
 *           in depth. Moving it back to ALWAYS_ALLOWED_ROUTES opens it to every
 *           signed-in user (safe because of the next point).
 *   ROWS  — loadMyDashboard() scopes every feed to the viewer and their own
 *           account teams; nobody sees anyone else's dashboard. The app reads
 *           with the service-role key, so the loader IS the gate. See
 *           content/docs/26-my-dashboard.md.
 */
export default async function MyDashboardPage() {
  const role = await getEffectiveRole()
  const allowed = await getAllowedRoutes(role)
  if (!canAccessRoute(role, "/my-dashboard", allowed)) redirect(allowed[0] ?? "/no-access")

  const data = await loadMyDashboard()
  return (
    <PageShell title="My Dashboard" hideHeader canvas>
      <MyDashboardView data={data} />
    </PageShell>
  )
}

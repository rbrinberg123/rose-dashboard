import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { canAccessRoute } from "@/lib/access-control"
import { getEffectiveRole } from "@/lib/effective-identity"
import { getAllowedRoutes } from "@/lib/page-access"
import { loadAlerts } from "./load"
import { AlertsView } from "./alerts-view"

// Every age, count and severity on this page is recomputed on read, and the
// underlying feedback work moves while the page is open.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Alerts" }

/** This page's own route — the key its role grants are stored against. */
const ROUTE = "/clients/alerts"

/**
 * Clients → Alerts. A READ-ONLY critical-to-dos worklist. No writes, no actions,
 * no filters: five sections, each one a question of "what is late and whose is
 * it". See content/docs/21-alerts.md.
 *
 * ── GATING ─────────────────────────────────────────────────────────────────
 * TWO server-side gates, both required:
 *   1. ROUTE — proxy.ts blocks the request before this file runs unless the
 *      viewer's role has a `role_page_access` row for /clients/alerts. The
 *      re-check below is defence in depth: a matcher change or a direct RSC
 *      fetch that slipped past the proxy still lands on a denied redirect
 *      rather than rendering data.
 *   2. ROWS — loadAlerts() is the real gate on WHAT is returned. The app reads
 *      with the service-role key, so RLS does not apply and the loader's two
 *      scopes (viewer, and six-role account team) are the only thing standing
 *      between a viewer and every other client's alerts.
 */
export default async function ClientAlertsPage() {
  const role = await getEffectiveRole()
  const allowedRoutes = await getAllowedRoutes(role)
  if (!canAccessRoute(role, ROUTE, allowedRoutes)) {
    redirect(allowedRoutes[0] ?? "/no-access")
  }

  const data = await loadAlerts()

  return (
    <PageShell title="Alerts" hideHeader canvas>
      <AlertsView data={data} />
    </PageShell>
  )
}

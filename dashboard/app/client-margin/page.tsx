import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { canAccessRoute, isStrictSuperUser } from "@/lib/access-control"
import { getEffectiveAllowedRoutes, getEffectiveRole } from "@/lib/effective-identity"
import { getSupabaseServer } from "@/lib/supabase"
import { isWindowKey } from "@/lib/client-margin/hours"
import { loadClientMarginHours } from "@/lib/client-margin/load"
import { ClientMarginView } from "./client-margin-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Client Margin" }

const ROUTE = "/client-margin"

/**
 * Client Margin — PHASE 1: known client hours per active client (no cost or
 * margin yet). Hidden page (HIDDEN_PAGE_REGISTRY), reached from Admin → Hidden
 * Pages. STRICT super user only — admins are refused (canAccessRoute refuses
 * hidden routes to admin; the isStrictSuperUser check below is belt-and-braces).
 * Read-only. See content/docs/30-client-margin.md.
 */
export default async function ClientMarginPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>
}) {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  const allowedRoutes = await getEffectiveAllowedRoutes()
  if (!isStrictSuperUser(role) || !canAccessRoute(role, ROUTE, allowedRoutes)) {
    redirect("/no-access")
  }

  const sp = await searchParams
  const windowKey = isWindowKey(sp.window) ? sp.window : "12m"

  let data
  try {
    data = await loadClientMarginHours(getSupabaseServer(), windowKey)
  } catch (e) {
    return (
      <PageShell title="Client Margin">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load client hours: {e instanceof Error ? e.message : String(e)}
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell title="Client Margin" hideHeader canvas>
      <ClientMarginView data={data} />
    </PageShell>
  )
}

import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { isFrameworkConfigured } from "@/lib/client-health-prompt"
import { HEALTH_TABLE } from "@/lib/client-health"
import { HealthView, type HealthRow } from "./health-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Client Health" }

const PATCH = "sql/patches/2026-10-01_client_health.sql"

/**
 * Clients → Client Health. One row per ACTIVE client (v_client_detail_summary,
 * the app's active definition): Client | Note | Rating, A→Z. The AI rating and
 * note come from public.client_health_assessments (written weekly by
 * /api/client-health/refresh); a super-user override wins when present.
 *
 * Gates:
 *   1. proxy.ts: /client-health is in ADMIN_ONLY_ROUTES (super-user only, not
 *      grantable through the Roles matrix).
 *   2. The effective-role check below, before any read.
 *   3. ./actions.ts and /api/client-health/refresh re-check on every call.
 */
export default async function ClientHealthPage() {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") redirect("/no-access")

  const sb = getSupabaseServer()
  const [clientsRes, healthRes] = await Promise.all([
    sb.from("v_client_detail_summary").select("account_id, client_name").order("client_name", { ascending: true }),
    sb
      .from(HEALTH_TABLE)
      .select(
        "account_id, ai_rating, ai_note, ai_model, ai_generated_at, run_id, ai_error, ai_error_at, override_rating, override_note, overridden_by, overridden_at",
      ),
  ])

  if (clientsRes.error) {
    return (
      <PageShell title="Client Health">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load active clients: {clientsRes.error.message}
        </div>
      </PageShell>
    )
  }

  const health = new Map(
    ((healthRes.data ?? []) as Record<string, unknown>[]).map((h) => [h.account_id as string, h]),
  )

  // Names for "overridden by".
  const overriderIds = [
    ...new Set([...health.values()].map((h) => h.overridden_by as string | null).filter((v): v is string => !!v)),
  ]
  const names = new Map<string, string>()
  if (overriderIds.length > 0) {
    const { data } = await sb.from("users").select("user_id, display_name, email").in("user_id", overriderIds)
    for (const u of (data ?? []) as { user_id: string; display_name: string | null; email: string | null }[]) {
      names.set(u.user_id, u.display_name?.trim() || u.email || "(unknown)")
    }
  }

  const rows: HealthRow[] = ((clientsRes.data ?? []) as { account_id: string; client_name: string }[]).map((c) => {
    const h = health.get(c.account_id)
    const str = (k: string) => ((h?.[k] as string | null | undefined) ?? null)
    return {
      account_id: c.account_id,
      client_name: c.client_name,
      ai_rating: str("ai_rating"),
      ai_note: str("ai_note"),
      ai_generated_at: str("ai_generated_at"),
      ai_error: str("ai_error"),
      ai_error_at: str("ai_error_at"),
      override_rating: str("override_rating"),
      override_note: str("override_note"),
      overridden_at: str("overridden_at"),
      overridden_by_name: str("overridden_by") ? (names.get(str("overridden_by")!) ?? null) : null,
    }
  })

  const lastUpdated =
    [...health.values()]
      .map((h) => h.ai_generated_at as string | null)
      .filter((v): v is string => !!v)
      .sort()
      .at(-1) ?? null

  return (
    <PageShell title="Client Health" hideHeader canvas>
      <HealthView
        rows={rows}
        lastUpdated={lastUpdated}
        frameworkReady={isFrameworkConfigured()}
        tableError={healthRes.error?.message ?? null}
        patchPath={PATCH}
      />
    </PageShell>
  )
}

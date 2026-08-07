import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity } from "@/lib/effective-identity"
import { resolveClientScope } from "@/lib/access/data-scope"
import { NoClientsAssigned } from "@/components/scoped-empty"
import type { ClientOnboardingRow } from "@/lib/types"
import { OnboardingTable } from "./onboarding-table"

// Always fetch fresh — the view recomputes days_onboarding on every read and the
// onboarding fields change as the team completes steps in Dynamics.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Onboarding" }

export default async function OnboardingPage() {
  const sb = getSupabaseServer()

  // Level-2 client scoping (Account Management). null = all; Set = only those; empty = none.
  const scope = await resolveClientScope(await getEffectiveIdentity())
  if (scope && scope.size === 0) {
    return (
      <PageShell title="Onboarding" description="Clients on your account team">
        <NoClientsAssigned />
      </PageShell>
    )
  }

  // Default order = most-stalled first (longest days at top), matching the
  // page's default sort so the initial render needs no client-side reshuffle.
  let onboardingQuery = sb
    .from("v_client_onboarding")
    .select("*")
    .order("days_onboarding", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true })
  if (scope) onboardingQuery = onboardingQuery.in("account_id", [...scope])
  const { data, error } = await onboardingQuery

  if (error) {
    return (
      <PageShell
        title="Onboarding"
        description="Active clients still onboarding — one row per client with an incomplete step"
      >
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">
            Could not load v_client_onboarding
          </div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (data ?? []) as ClientOnboardingRow[]

  return (
    <PageShell
      title="Onboarding"
      description={`${rows.length.toLocaleString()} clients still onboarding`}
      hideHeader
      canvas
    >
      <OnboardingTable rows={rows} />
    </PageShell>
  )
}

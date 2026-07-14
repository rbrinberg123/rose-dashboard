import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { ClientOnboardingRow } from "@/lib/types"
import { OnboardingTable } from "./onboarding-table"

// Always fetch fresh — the view recomputes days_onboarding on every read and the
// onboarding fields change as the team completes steps in Dynamics.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Onboarding" }

export default async function OnboardingPage() {
  const sb = getSupabaseServer()
  // Default order = most-stalled first (longest days at top), matching the
  // page's default sort so the initial render needs no client-side reshuffle.
  const { data, error } = await sb
    .from("v_client_onboarding")
    .select("*")
    .order("days_onboarding", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true })

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

import type { Metadata } from "next"
import Link from "next/link"
import { PageShell } from "@/components/page-shell"
import { buttonVariants } from "@/components/ui/button"
import { getSupabaseServer } from "@/lib/supabase"
import {
  ReconciliationView,
  type PendingCandidate,
  type DismissedCandidate,
  type LastSweep,
} from "./reconciliation-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Deletion Reconciliation" }

export default async function ReconciliationPage() {
  const sb = getSupabaseServer()

  const [pendingRes, dismissedRes, lastRunRes] = await Promise.all([
    sb
      .from("deletion_candidates")
      .select("id, entity_name, label, pk_value, first_detected_at, last_seen_missing_at")
      .eq("status", "pending")
      .order("entity_name", { ascending: true })
      .order("first_detected_at", { ascending: true }),
    sb
      .from("deletion_candidates")
      .select("id, entity_name, label, pk_value, resolved_at, resolved_by")
      .eq("status", "dismissed")
      .order("resolved_at", { ascending: false })
      .limit(200),
    sb
      .from("reconcile_runs")
      .select("started_at, finished_at, entities_checked, newly_flagged, reappeared, skipped")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const firstError = pendingRes.error ?? dismissedRes.error
  if (firstError) {
    return (
      <PageShell title="Deletion Reconciliation" description="Records deleted in Dynamics, awaiting review">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load the review queue</div>
          <div className="mt-1 text-muted-foreground">{firstError.message}</div>
        </div>
      </PageShell>
    )
  }

  const pending = (pendingRes.data ?? []) as PendingCandidate[]
  const dismissed = (dismissedRes.data ?? []) as DismissedCandidate[]
  const lastSweep = (lastRunRes.data ?? null) as LastSweep

  return (
    <PageShell
      title="Deletion Reconciliation"
      description="Records deleted in Dynamics, awaiting review (sweep runs 5 AM UTC)"
      actions={
        <Link href="/admin/sync" className={buttonVariants({ variant: "outline", size: "sm" })}>
          ← Sync Status
        </Link>
      }
    >
      <ReconciliationView pending={pending} dismissed={dismissed} lastSweep={lastSweep} />
    </PageShell>
  )
}

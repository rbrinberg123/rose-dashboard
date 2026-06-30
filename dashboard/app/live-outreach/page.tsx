import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { LiveOutreachRow } from "@/lib/types"
import { LiveOutreachView } from "./live-outreach-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Live Outreach" }

export default async function LiveOutreachPage() {
  const sb = getSupabaseServer()

  // Only ~21 events are in the Live Outreach state — comfortably under the
  // PostgREST 1,000-row cap, so a single fetch is enough. The view is already
  // ordered (ticker, then event name).
  const { data, error } = await sb.from("v_live_outreach").select("*")

  if (error) {
    return (
      <PageShell title="Live Outreach">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_live_outreach</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
        </div>
      </PageShell>
    )
  }

  const rows = (data ?? []) as LiveOutreachRow[]

  return (
    <PageShell title="Live Outreach" hideHeader canvas>
      <LiveOutreachView rows={rows} />
    </PageShell>
  )
}

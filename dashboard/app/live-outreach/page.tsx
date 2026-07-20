import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { LiveOutreachView } from "./live-outreach-view"
import { loadLiveOutreachRows } from "./load"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Live Outreach" }

export default async function LiveOutreachPage() {
  const { rows, error } = await loadLiveOutreachRows()

  // Prefill the "Send Test Email" box with the signed-in user's address.
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userEmail = user?.email ?? undefined

  if (error) {
    return (
      <PageShell title="Live Outreach">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_live_outreach</div>
          <div className="mt-1 text-muted-foreground">{error}</div>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell title="Live Outreach" hideHeader canvas>
      <LiveOutreachView rows={rows} userEmail={userEmail} />
    </PageShell>
  )
}

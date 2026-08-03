import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { getUserRole } from "@/lib/user-role"
import type { TimeOffRow } from "@/lib/types"
import { TimeOffView } from "./time-off-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Time Off" }

export default async function TimeOffPage() {
  const sb = getSupabaseServer()

  // Signed-in user + role — drives the super-user-only digest send controls
  // (prefill the test box with their address; only super users see the buttons).
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userEmail = user?.email ?? undefined
  const isSuperUser = (await getUserRole(userEmail)) === "super_user"

  // ~400 approved time-off rows — comfortably under the PostgREST 1,000-row cap,
  // so a single fetch is enough (no pagination like the Scheduler needs).
  const { data, error } = await sb
    .from("v_time_off")
    .select("*")
    .order("start_date", { ascending: true })
    .order("person", { ascending: true })

  if (error) {
    return (
      <PageShell title="Time Off">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_time_off</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
        </div>
      </PageShell>
    )
  }

  const entries = (data ?? []) as TimeOffRow[]

  return (
    <PageShell title="Time Off" hideHeader canvas>
      <TimeOffView entries={entries} userEmail={userEmail} isSuperUser={isSuperUser} />
    </PageShell>
  )
}

import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { LiveOutreachRow } from "@/lib/types"
import { LiveOutreachView } from "./live-outreach-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Live Outreach" }

// PostgREST caps a single response at 1,000 rows; the meeting-history read can
// exceed that across all the Live Outreach clients, so we page through it.
const MEETINGS_PAGE_SIZE = 1000

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

  // ---- client<->institution meeting history --------------------------------
  // Each confirmed meeting gets a NEW / count flag based on how many OTHER
  // 'Confirmed' meetings (any date) this client has had with that institution.
  // Computed here (no view change) with one paginated read of public.meetings,
  // matched on client_account_id + institution_name (the app treats the
  // institution NAME as the key — see the meetings mirror table). Fails soft:
  // any read error leaves history unavailable so we show NO flags rather than
  // wrong ones.
  const clientIds = Array.from(
    new Set(
      rows.map((r) => r.client_account_id).filter((v): v is string => Boolean(v)),
    ),
  )

  const confirmedByPair = new Map<string, number>()
  const countedMeetingIds = new Set<string>()
  let historyAvailable = clientIds.length > 0

  if (clientIds.length > 0) {
    for (let from = 0; ; from += MEETINGS_PAGE_SIZE) {
      const { data: mrows, error: merr } = await sb
        .from("meetings")
        .select("client_account_id, institution_name, meeting_id")
        .in("client_account_id", clientIds)
        .eq("meeting_status_label", "Confirmed")
        .range(from, from + MEETINGS_PAGE_SIZE - 1)

      if (merr) {
        historyAvailable = false
        break
      }
      const batch = mrows ?? []
      for (const m of batch) {
        if (!m.client_account_id || !m.institution_name) continue
        const key = `${m.client_account_id}|${m.institution_name}`
        confirmedByPair.set(key, (confirmedByPair.get(key) ?? 0) + 1)
        countedMeetingIds.add(m.meeting_id as string)
      }
      if (batch.length < MEETINGS_PAGE_SIZE) break
    }
  }

  const enriched: LiveOutreachRow[] = rows.map((r) => ({
    ...r,
    confirmed_meetings: (r.confirmed_meetings ?? []).map((m) => {
      let prior: number | null = null
      if (historyAvailable && r.client_account_id && m.institution_name) {
        const key = `${r.client_account_id}|${m.institution_name}`
        const total = confirmedByPair.get(key) ?? 0
        // Subtract the current meeting itself when it is in the counted set.
        prior = Math.max(0, total - (countedMeetingIds.has(m.meeting_id) ? 1 : 0))
      }
      return { ...m, prior_meeting_count: prior }
    }),
  }))

  return (
    <PageShell title="Live Outreach" hideHeader canvas>
      <LiveOutreachView rows={enriched} />
    </PageShell>
  )
}

import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type {
  ClientDetailInstitutionRow,
  ClientDetailQuarterlyRow,
  ClientDetailReachDepthRow,
  ClientDetailRecentMeetingRow,
  ClientDetailRecentNoteRow,
  ClientDetailSummaryRow,
  ClientDetailTopHostRow,
  ClientDetailTopInstitutionRow,
  ClientDetailTouchpointRow,
  MarketingCalendarRow,
} from "@/lib/types"
import { getEffectiveIdentity } from "@/lib/effective-identity"
import { resolveClientScope } from "@/lib/access/data-scope"
import { NoClientsAssigned, ClientNotInScope } from "@/components/scoped-empty"
import { loadConfirmedMeetingsByEvent } from "@/lib/event-meetings"
import { ClientDetailView } from "./client-detail-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Client Detail" }

export default async function ClientDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ account_id?: string }>
}) {
  const sb = getSupabaseServer()
  const { account_id: requestedId } = await searchParams

  // Level-2 client scoping (Account Management). null = all; Set = only those; empty = none.
  const scope = await resolveClientScope(await getEffectiveIdentity())
  if (scope && scope.size === 0) {
    return (
      <PageShell title="Client Detail">
        <NoClientsAssigned />
      </PageShell>
    )
  }
  // Block a direct URL to a client outside the user's scope — a scoped user must
  // not be able to reach an unassigned client by guessing/pasting its id.
  if (scope && requestedId && !scope.has(requestedId)) {
    return (
      <PageShell title="Client Detail">
        <ClientNotInScope />
      </PageShell>
    )
  }

  let summaryQuery = sb
    .from("v_client_detail_summary")
    .select("*")
    .order("client_name", { ascending: true })
  if (scope) summaryQuery = summaryQuery.in("account_id", [...scope])
  const summaryRes = await summaryQuery

  if (summaryRes.error) {
    return (
      <PageShell title="Client Detail">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load Client Detail summary view</div>
          <div className="mt-1 text-muted-foreground">{summaryRes.error.message}</div>
        </div>
      </PageShell>
    )
  }

  const summaryRows = (summaryRes.data ?? []) as ClientDetailSummaryRow[]

  if (summaryRows.length === 0) {
    return (
      <PageShell title="Client Detail">
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No active clients on record yet.
        </div>
      </PageShell>
    )
  }

  const matched = requestedId
    ? summaryRows.find((r) => r.account_id === requestedId)
    : undefined
  const selected = matched ?? summaryRows[0]

  const [
    quarterlyRes,
    topInstRes,
    institutionsRes,
    reachDepthRes,
    topHostsRes,
    recentRes,
    recentNoteRes,
    touchpointsRes,
    accountRes,
    marketingRes,
  ] = await Promise.all([
      sb
        .from("v_client_detail_quarterly")
        .select("*")
        .eq("account_id", selected.account_id)
        .order("period_year", { ascending: true })
        .order("period_quarter", { ascending: true }),
      sb
        .from("v_client_detail_top_institutions")
        .select("*")
        .eq("account_id", selected.account_id)
        .order("rank", { ascending: true }),
      // Complete institution list (all buckets) for this client — backs the
      // Reach Depth drawer. Small payload (≤ a few hundred rows even for the
      // widest-reach client), so we load it up front rather than per-drawer.
      sb
        .from("v_client_detail_institutions")
        .select("*")
        .eq("account_id", selected.account_id)
        .order("bucket_order", { ascending: true })
        .order("last_met", { ascending: false, nullsFirst: false })
        .order("institution_name", { ascending: true }),
      sb
        .from("v_client_detail_reach_depth")
        .select("*")
        .eq("account_id", selected.account_id)
        .order("bucket_order", { ascending: true }),
      sb
        .from("v_client_detail_top_hosts")
        .select("*")
        .eq("account_id", selected.account_id)
        .order("ltm_count", { ascending: false })
        .order("last_met", { ascending: false }),
      sb
        .from("v_client_detail_recent_meetings")
        .select("*")
        .eq("account_id", selected.account_id)
        .order("meeting_date", { ascending: false }),
      sb
        .from("v_client_detail_recent_note")
        .select("*")
        .eq("account_id", selected.account_id)
        .maybeSingle(),
      sb
        // Base table (not v_client_detail_touchpoints) so we also get the full
        // `description`, which the view omits. The view is just this same
        // projection filtered to client_account_id IS NOT NULL, so filtering on
        // client_account_id below yields the identical row set.
        .from("touchpoints")
        .select(
          "account_id:client_account_id, touchpoint_id, scheduled_start, subject, touchpoint_type_label, direction_code, actual_duration_minutes, description",
        )
        .eq("client_account_id", selected.account_id)
        .order("scheduled_start", { ascending: false, nullsFirst: false }),
      sb
        .from("accounts")
        .select(
          "ticker_symbol, sales_lead_primary_name, secondary_manager_name, associate_name, logistics_coordinator_name, ai_summary, ai_summary_generated_at",
        )
        .eq("account_id", selected.account_id)
        .maybeSingle(),
      // Marketing/NDRS events for this client — same view the NDRS Calendar page
      // uses (per-event, carries the pipeline stage, spans a trailing window of
      // recent-past + upcoming). Kept OUT of `firstError` below so a missing/not-
      // yet-migrated view degrades the events block to empty rather than blanking
      // the whole page.
      sb
        .from("v_marketing_calendar")
        .select("*")
        .eq("client_account_id", selected.account_id),
    ])

  const firstError =
    quarterlyRes.error ??
    topInstRes.error ??
    institutionsRes.error ??
    reachDepthRes.error ??
    topHostsRes.error ??
    recentRes.error ??
    recentNoteRes.error ??
    touchpointsRes.error
  if (firstError) {
    return (
      <PageShell title="Client Detail">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load Client Detail views</div>
          <div className="mt-1 text-muted-foreground">{firstError.message}</div>
        </div>
      </PageShell>
    )
  }

  const marketingEvents = (marketingRes.data ?? []) as MarketingCalendarRow[]

  // Confirmed meetings per marketing event — same meetings→event link
  // (meetings.event_id, from Dynamics _bcs_event_value) and status field
  // (meeting_status_label = 'Confirmed') the app uses for Planning /
  // Live Outreach. Scoped implicitly: we only ask for THIS client's event ids,
  // which were already scope-checked above. We keep both a count (for the chip)
  // and the raw meeting dates per event (bcs_date; a meeting is a single point
  // in time, so it is both the start and end) — the view buckets Current/Previous
  // off these dates. Fail-soft: any error just leaves the maps empty.
  // Full confirmed-meeting rows per event, for the click-through drawer. Fields
  // mirror Planning / Live Outreach: institution_name + investor_text (bcs_investor).
  const confirmedMeetingsByEvent = await loadConfirmedMeetingsByEvent(
    marketingEvents.map((e) => e.event_id),
  )
  // The chip count and the bucketing dates are both derived from that same set,
  // so there is only ever one read behind all three.
  const confirmedByEvent: Record<string, number> = {}
  const meetingDatesByEvent: Record<string, string[]> = {}
  for (const [id, meetings] of Object.entries(confirmedMeetingsByEvent)) {
    confirmedByEvent[id] = meetings.length
    const dates = meetings
      .map((m) => m.meeting_date)
      .filter((d): d is string => Boolean(d))
    if (dates.length > 0) meetingDatesByEvent[id] = dates
  }

  return (
    <PageShell title="Client Detail" hideHeader canvas>
      <ClientDetailView
        allClients={summaryRows}
        selected={selected}
        clientTicker={(accountRes.data?.ticker_symbol ?? null) as string | null}
        aiSummary={(accountRes.data?.ai_summary ?? null) as string | null}
        aiSummaryGeneratedAt={
          (accountRes.data?.ai_summary_generated_at ?? null) as string | null
        }
        accountTeam={{
          sales_lead_primary_name:
            (accountRes.data?.sales_lead_primary_name ?? null) as string | null,
          secondary_manager_name:
            (accountRes.data?.secondary_manager_name ?? null) as string | null,
          associate_name: (accountRes.data?.associate_name ?? null) as string | null,
          logistics_coordinator_name:
            (accountRes.data?.logistics_coordinator_name ?? null) as string | null,
        }}
        quarterly={(quarterlyRes.data ?? []) as ClientDetailQuarterlyRow[]}
        topInstitutions={(topInstRes.data ?? []) as ClientDetailTopInstitutionRow[]}
        institutions={(institutionsRes.data ?? []) as ClientDetailInstitutionRow[]}
        reachDepth={(reachDepthRes.data ?? []) as ClientDetailReachDepthRow[]}
        topHosts={(topHostsRes.data ?? []) as ClientDetailTopHostRow[]}
        recentMeetings={(recentRes.data ?? []) as ClientDetailRecentMeetingRow[]}
        recentNote={(recentNoteRes.data ?? null) as ClientDetailRecentNoteRow | null}
        touchpoints={(touchpointsRes.data ?? []) as ClientDetailTouchpointRow[]}
        marketingEvents={marketingEvents}
        confirmedByEvent={confirmedByEvent}
        meetingDatesByEvent={meetingDatesByEvent}
        confirmedMeetingsByEvent={confirmedMeetingsByEvent}
      />
    </PageShell>
  )
}

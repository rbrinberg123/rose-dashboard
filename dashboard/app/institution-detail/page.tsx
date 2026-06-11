import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type {
  InstitutionDetailQuarterlyRow,
  InstitutionDetailRecentMeetingRow,
  InstitutionDetailStyleRow,
  InstitutionDetailSummaryRow,
  InstitutionDetailTopBookerRow,
  InstitutionDetailTopClientRow,
  InstitutionDetailTopHostRow,
  InstitutionSummaryRow,
} from "@/lib/types"
import { InstitutionDetailView } from "./institution-detail-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Institution Detail" }

export default async function InstitutionDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ institution_id?: string }>
}) {
  const sb = getSupabaseServer()
  const { institution_id: requestedId } = await searchParams

  // 1. Fetch the navigator dropdown data + the per-institution summary in
  //    a single round trip.
  const [navRes, detailRes] = await Promise.all([
    sb
      .from("v_institution_summary")
      .select("*")
      .order("lifetime_meetings", { ascending: false })
      .range(0, 9999),
    sb
      .from("v_institution_detail_summary")
      .select("*")
      .order("lifetime_meetings", { ascending: false })
      .range(0, 9999),
  ])

  const firstError = navRes.error ?? detailRes.error
  if (firstError) {
    return (
      <PageShell title="Institution Detail">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load Institution Detail summary view</div>
          <div className="mt-1 text-muted-foreground">{firstError.message}</div>
        </div>
      </PageShell>
    )
  }

  const navRows = (navRes.data ?? []) as InstitutionSummaryRow[]
  const detailRows = (detailRes.data ?? []) as InstitutionDetailSummaryRow[]

  if (detailRows.length === 0) {
    return (
      <PageShell title="Institution Detail">
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No institutions with confirmed meetings on record yet.
        </div>
      </PageShell>
    )
  }

  // 2. Pick the selected institution: either from ?institution_id, or default
  //    to the top-by-lifetime row.
  const matched = requestedId
    ? detailRows.find((r) => r.institution_id === requestedId)
    : undefined
  const selected = matched ?? detailRows[0]

  // 3. Top 50 institutions for the navigator dropdown. Skip rows whose
  //    institution_id is null — they cannot be deeplinked to.
  const navTop = navRows
    .filter((r): r is InstitutionSummaryRow & { institution_id: string } =>
      r.institution_id !== null,
    )
    .slice(0, 50)

  // 4. Fetch the five drill-down views in parallel for the selected institution.
  if (!selected.institution_id) {
    // Cannot fetch detail panels keyed by id when id is null. Show what we have.
    return (
      <PageShell title="Institution Detail">
        <InstitutionDetailView
          selected={selected}
          navTop={navTop}
          quarterly={[]}
          topClients={[]}
          style={[]}
          topHosts={[]}
          topBookers={[]}
          recentMeetings={[]}
        />
      </PageShell>
    )
  }

  const [quarterlyRes, topClientsRes, styleRes, topHostsRes, topBookersRes, recentRes] =
    await Promise.all([
      sb
        .from("v_institution_detail_quarterly")
        .select("*")
        .eq("institution_id", selected.institution_id)
        .order("period_year", { ascending: true })
        .order("period_quarter", { ascending: true }),
      sb
        .from("v_institution_detail_top_clients")
        .select("*")
        .eq("institution_id", selected.institution_id)
        .order("rank", { ascending: true }),
      sb
        .from("v_institution_detail_style")
        .select("*")
        .eq("institution_id", selected.institution_id)
        .order("dimension_type", { ascending: true })
        .order("bucket_order", { ascending: true }),
      sb
        .from("v_institution_detail_top_hosts")
        .select("*")
        .eq("institution_id", selected.institution_id)
        .order("ltm_count", { ascending: false })
        .order("last_met", { ascending: false }),
      sb
        .from("v_institution_detail_top_bookers")
        .select("*")
        .eq("institution_id", selected.institution_id)
        .order("ltm_count", { ascending: false })
        .order("last_met", { ascending: false }),
      sb
        .from("v_institution_detail_recent_meetings")
        .select("*")
        .eq("institution_id", selected.institution_id)
        .order("meeting_date", { ascending: false }),
    ])

  const drillError =
    quarterlyRes.error ??
    topClientsRes.error ??
    styleRes.error ??
    topHostsRes.error ??
    topBookersRes.error ??
    recentRes.error
  if (drillError) {
    return (
      <PageShell title="Institution Detail">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load Institution Detail drill-down views</div>
          <div className="mt-1 text-muted-foreground">{drillError.message}</div>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell title="Institution Detail">
      <InstitutionDetailView
        selected={selected}
        navTop={navTop}
        quarterly={(quarterlyRes.data ?? []) as InstitutionDetailQuarterlyRow[]}
        topClients={(topClientsRes.data ?? []) as InstitutionDetailTopClientRow[]}
        style={(styleRes.data ?? []) as InstitutionDetailStyleRow[]}
        topHosts={(topHostsRes.data ?? []) as InstitutionDetailTopHostRow[]}
        topBookers={
          (topBookersRes.data ?? []) as InstitutionDetailTopBookerRow[]
        }
        recentMeetings={
          (recentRes.data ?? []) as InstitutionDetailRecentMeetingRow[]
        }
      />
    </PageShell>
  )
}

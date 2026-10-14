import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type {
  AnalystMonthlyActivityRow,
  ProductivityDetailInstitutionRow,
  ProductivityDetailRow,
  UserOption,
} from "@/lib/types"
import { ProductivityDetailView } from "./productivity-detail-view"
import { loadProductivityExclusions } from "@/lib/productivity-exclusions"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Productivity Detail" }

export default async function ProductivityDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ display_name?: string }>
}) {
  const sp = await searchParams
  const requested = typeof sp.display_name === "string" ? sp.display_name : null
  const sb = getSupabaseServer()

  const [summaryRes, monthlyRes, institutionsRes, usersRes] = await Promise.all([
    sb
      .from("v_productivity_detail_summary")
      .select("*")
      .order("display_name", { ascending: true }),
    sb
      .from("v_analyst_monthly_activity")
      .select("*")
      .order("display_name")
      .order("period_year")
      .order("period_month"),
    sb
      .from("v_productivity_detail_institutions")
      .select("*"),
    sb
      .from("users")
      .select("user_id, display_name"),
  ])

  const error =
    summaryRes.error ?? monthlyRes.error ?? institutionsRes.error ?? usersRes.error
  if (error) {
    return (
      <PageShell title="Productivity Detail">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load Productivity Detail view</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
        </div>
      </PageShell>
    )
  }

  const allRows = (summaryRes.data ?? []) as ProductivityDetailRow[]
  const allMonthly = (monthlyRes.data ?? []) as AnalystMonthlyActivityRow[]
  const allInstitutions = (institutionsRes.data ?? []) as ProductivityDetailInstitutionRow[]
  const userOptions = (usersRes.data ?? []) as UserOption[]

  // Exclusions (lib/productivity-exclusions.ts). These views are keyed by
  // DISPLAY NAME, so map name → ids via the users list (+ aliases inside
  // isHidden): a name is hidden when ANY of its ids is hidden. Hidden people
  // leave the picker and the default selection, and their data is not sent —
  // EXCEPT the one person a direct ?display_name= link asks for, who still
  // loads (with a note). This is a display preference, not access control.
  const exclusions = await loadProductivityExclusions()
  const hiddenNames = new Set<string>()
  const nameById = new Map<string, string>()
  for (const u of userOptions) {
    if (!u.display_name) continue
    nameById.set(u.user_id, u.display_name)
    if (exclusions.isHidden(u.user_id)) hiddenNames.add(u.display_name)
  }
  const keepName = (name: string | null | undefined) =>
    !name || !hiddenNames.has(name) || name === requested
  const rows = allRows.filter((r) => keepName(r.display_name))
  const monthlyRows = allMonthly.filter((r) => keepName(r.display_name))
  const institutionRows = allInstitutions.filter((r) => keepName(nameById.get(r.user_id)))
  const excludedName =
    requested && hiddenNames.has(requested) && rows.some((r) => r.display_name === requested)
      ? requested
      : null

  return (
    <PageShell title="Productivity Detail" hideHeader canvas>
      <ProductivityDetailView
        rows={rows}
        monthlyRows={monthlyRows}
        institutionRows={institutionRows}
        userOptions={userOptions}
        excludedName={excludedName}
      />
    </PageShell>
  )
}

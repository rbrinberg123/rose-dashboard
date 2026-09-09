import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import type { AdminMeetingRow } from "@/lib/types"
import { MeetingsView } from "./meetings-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Meetings" }

/**
 * Admin → Hidden Pages → Meetings. Every meeting in the CRM, unfiltered:
 * all statuses, all dates past and future, active and deactivated alike.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * This page is the one place in the app that reads meetings WITHOUT
 * `resolveMeetingScope`. `v_admin_meetings_all` is unscoped by design, and the
 * read goes through the service-role client, which bypasses RLS — so a
 * successful load hands the caller every client's meetings. Three independent
 * gates stand in front of it, and the data fetch happens after all of them:
 *
 *   1. proxy.ts runs `canAccessRoute` before this file renders, and
 *      /meetings is in ADMIN_ONLY_ROUTES — super-user-only, and NOT openable
 *      through the Admin → Roles matrix.
 *   2. The check below re-verifies the role in the page itself, so the page is
 *      still safe if it is ever reached by a path that skips the proxy.
 *   3. The Supabase query is only constructed *after* that check returns.
 *
 * The role is the EFFECTIVE one, so a super-user using "View as" previews the
 * denial exactly as the impersonated person would experience it, instead of
 * quietly keeping their own access.
 *
 * If you add a data read to this file, put it BELOW the guard.
 */
export default async function MeetingsPage() {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") redirect("/no-access")

  const sb = getSupabaseServer()

  // ~10k+ rows. PostgREST caps a single response at db-max-rows (1,000 on
  // Supabase Cloud), so page through it. meeting_date is not unique and is
  // nullable, so meeting_id is the stable tiebreaker that keeps the total order
  // deterministic — without it, pagination can drop or repeat rows at a page
  // boundary. Nulls last so undated meetings sort to the end rather than the top.
  const PAGE_SIZE = 1000
  const rows: AdminMeetingRow[] = []
  let loadError: string | null = null

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("v_admin_meetings_all")
      .select("*")
      .order("meeting_date", { ascending: false, nullsFirst: false })
      .order("meeting_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      loadError = error.message
      break
    }
    const page = (data ?? []) as AdminMeetingRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  if (loadError) {
    return (
      <PageShell title="Meetings">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_admin_meetings_all</div>
          <div className="mt-1 text-muted-foreground">{loadError}</div>
          <div className="mt-2 text-muted-foreground">
            If the view does not exist yet, run{" "}
            <code>sql/patches/2026-09-09_admin_meetings_all.sql</code> in Supabase.
          </div>
        </div>
      </PageShell>
    )
  }

  // Dynamics deep-link base for the per-row "open in CRM" icon. Same env var the
  // Admin hub reads, with the same default; the column is dropped entirely when
  // neither resolves, rather than linking somewhere invented.
  const crmBase =
    process.env.NEXT_PUBLIC_DYNAMICS_URL?.replace(/\/$/, "") ||
    "https://clientcrm.crm.dynamics.com"

  return (
    <PageShell title="Meetings" hideHeader canvas>
      <MeetingsView rows={rows} crmBase={crmBase} />
    </PageShell>
  )
}

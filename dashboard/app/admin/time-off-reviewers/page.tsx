import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { buildIdentityIndex } from "@/lib/access/identity-index"
import { ReviewersView, type ReviewerPerson, type ReviewerAssignment } from "./reviewers-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Time Off Reviewers" }

const PATCH = "sql/patches/2026-09-24_time_off_requests.sql"

/**
 * Admin → Time Off Reviewers. For each person, the small team who may approve
 * or deny their time off (public.time_off_reviewers). That team is the
 * "Reviewing Team" on the Time Off page and decides who sees a request on
 * their Alerts page.
 *
 * Gates: proxy.ts (ADMIN_ONLY_ROUTES), the effective-role check below, and
 * ./actions.ts re-checking on every write.
 */
export default async function TimeOffReviewersPage() {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") redirect("/no-access")

  const sb = getSupabaseServer()
  const [usersRes, mapRes] = await Promise.all([
    sb.from("users").select("user_id, display_name, email, is_active"),
    sb.from("time_off_reviewers").select("id, person_user_id, reviewer_user_id"),
  ])

  if (usersRes.error) {
    return (
      <PageShell title="Time Off Reviewers">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load users: {usersRes.error.message}
        </div>
      </PageShell>
    )
  }

  const all = (usersRes.data ?? []) as {
    user_id: string
    display_name: string | null
    email: string | null
    is_active: boolean
  }[]
  const names: Record<string, string> = {}
  for (const u of all) names[u.user_id] = u.display_name?.trim() || u.email || "(unknown)"

  // Active, real people — the same roster rule as Admin → Account Teams
  // (drops hashed/disabled rows, tags and removes shared mailboxes).
  const roster: ReviewerPerson[] = buildIdentityIndex(all.filter((u) => u.is_active))
    .roster.filter((r) => !r.service)
    .map((r) => ({ userId: r.userId, name: r.name, email: r.email }))

  const assignments = (mapRes.data ?? []) as ReviewerAssignment[]

  return (
    <PageShell title="Time Off Reviewers" hideHeader canvas>
      <ReviewersView
        roster={roster}
        names={names}
        assignments={assignments}
        tableMissing={!!mapRes.error}
        tableError={mapRes.error?.message ?? null}
        patchPath={PATCH}
      />
    </PageShell>
  )
}

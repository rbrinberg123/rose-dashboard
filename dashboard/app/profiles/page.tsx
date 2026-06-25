import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import type { ProfileUpcomingRow } from "@/lib/types"
import { ProfilesView } from "./profiles-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Profiles" }

// The three business-week column anchors (each week's Monday), as YYYY-MM-DD.
// Mirrors v_profiles_upcoming's anchor exactly: Monday of the current business
// week, rolled forward to next Monday on weekends so the board advances once
// Friday is done. Computed in UTC because the view's meeting_day and Supabase's
// CURRENT_DATE are both UTC — so week_index 0/1/2 line up with these labels.
function businessWeekMondays(): string[] {
  const now = new Date()
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  const isoDow = ((today.getUTCDay() + 6) % 7) + 1 // Mon=1 … Sun=7
  const monday = new Date(today)
  monday.setUTCDate(today.getUTCDate() - (isoDow - 1))
  if (isoDow === 6 || isoDow === 7) monday.setUTCDate(monday.getUTCDate() + 7)
  return [0, 1, 2].map((i) => {
    const d = new Date(monday)
    d.setUTCDate(monday.getUTCDate() + i * 7)
    return d.toISOString().slice(0, 10)
  })
}

// Today's UTC calendar date (YYYY-MM-DD) — the SAME basis as the view's
// CURRENT_DATE and meeting_day, so the per-card "days to meeting" count can
// never disagree with the week column a card sits in.
function todayUtcISO(): string {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10)
}

export default async function ProfilesPage() {
  const sb = getSupabaseServer()

  // The view is already scoped to the next three business weeks (forward-only,
  // weekday-only, Cancelled excluded), so it is small — a single fetch is
  // enough. We still loop in PAGE_SIZE chunks as a guard against PostgREST's
  // db-max-rows cap.
  const PAGE_SIZE = 1000
  const rows: ProfileUpcomingRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("v_profiles_upcoming")
      .select("*")
      // Stable total order for pagination: by date, then meeting_id tiebreaker.
      .order("meeting_date", { ascending: true })
      .order("meeting_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      return (
        <PageShell title="Profiles">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="font-medium text-destructive">
              Could not load v_profiles_upcoming
            </div>
            <div className="mt-1 text-muted-foreground">{error.message}</div>
          </div>
        </PageShell>
      )
    }

    const page = (data ?? []) as ProfileUpcomingRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return (
    <PageShell title="Profiles" hideHeader canvas>
      <ProfilesView rows={rows} weekMondays={businessWeekMondays()} today={todayUtcISO()} />
    </PageShell>
  )
}

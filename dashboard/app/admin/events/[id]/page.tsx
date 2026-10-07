import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { isUuid } from "@/lib/crm-write"
import { loadBuilderItinerary } from "@/lib/events-planner/load"
import type { TypeOption } from "@/lib/events-planner/types"
import { BuilderView } from "./builder-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Itinerary · Events Planner" }

/**
 * Admin → Events Planner → one itinerary: the builder.
 *
 * The whole itinerary (days, items, travel/hotel details, who's in what,
 * attendees) is read in ONE query; edits are optimistic in the browser.
 *
 * Gates: proxy.ts (ADMIN_ONLY_ROUTES covers /admin/events/*), the page gate
 * below, and every server action re-checking on its own.
 */
export default async function ItineraryPage({ params }: { params: Promise<{ id: string }> }) {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") redirect("/no-access")

  const { id } = await params
  if (!isUuid(id)) notFound()

  const sb = getSupabaseServer()
  const [itin, mt, et, identity] = await Promise.all([
    loadBuilderItinerary(sb, id),
    sb.from("ep_meeting_types").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    sb.from("ep_event_types").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    getEffectiveIdentity(),
  ])

  if (itin.error) {
    return (
      <PageShell title="Itinerary">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load the itinerary: {itin.error}
        </div>
      </PageShell>
    )
  }
  if (!itin.data) notFound()

  return (
    <PageShell title={itin.data.title} hideHeader canvas>
      <BuilderView
        initial={itin.data}
        meetingTypes={(mt.data ?? []) as TypeOption[]}
        eventTypes={(et.data ?? []) as TypeOption[]}
        readOnly={identity.impersonated}
        // Optional: travel-time estimates only when a Google Maps key is configured.
        canEstimate={!!process.env.GOOGLE_MAPS_API_KEY?.trim()}
      />
    </PageShell>
  )
}

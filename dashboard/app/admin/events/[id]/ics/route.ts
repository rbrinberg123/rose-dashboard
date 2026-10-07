/**
 * Download one item as a .ics file — /admin/events/[id]/ics?item=<itemId>
 *
 * METHOD:PUBLISH with no attendee addresses: a plain calendar entry someone can
 * import or forward by hand. Same content rules as the emailed invites (no
 * internal notes, no confirmation numbers). Server-only.
 *
 * Gate: proxy.ts (/admin/events/*) + effective super_user here.
 */

import { NextResponse } from "next/server"

import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { isUuid } from "@/lib/crm-write"
import { buildIcs, invitePayload } from "@/lib/events-planner/core"
import { loadBuilderItinerary } from "@/lib/events-planner/load"
import { inviteInputs } from "@/lib/events-planner/invites"
import type { TypeOption } from "@/lib/events-planner/types"

export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // ---- GATE (must stay first) ----
  if ((await getEffectiveRole()) !== "super_user") return NextResponse.json({ error: "Not authorised." }, { status: 403 })
  const { id } = await params
  const itemId = new URL(req.url).searchParams.get("item") ?? ""
  if (!isUuid(id) || !isUuid(itemId)) return NextResponse.json({ error: "Not found." }, { status: 404 })

  const sb = getSupabaseServer()
  const [itin, mt] = await Promise.all([loadBuilderItinerary(sb, id), sb.from("ep_meeting_types").select("id, name")])
  if (!itin.data) return NextResponse.json({ error: itin.error ?? "Not found." }, { status: 404 })
  const { items, attendees } = inviteInputs(itin.data, (mt.data ?? []) as TypeOption[])
  const item = items.find((i) => i.id === itemId)
  if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 })

  const ics = buildIcs({ payload: invitePayload(item, attendees, itin.data.client_name), method: "PUBLISH", sequence: 0, recipient: null })
  const name = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "event"
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.ics"`,
      "Cache-Control": "no-store",
    },
  })
}

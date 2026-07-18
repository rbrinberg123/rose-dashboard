import { type NextRequest, NextResponse } from "next/server"
import { requireRouteAccess } from "@/lib/api-auth"
import { GraphError } from "@/lib/graph"
import { getConferenceRoomSchedules } from "@/lib/conference-rooms-data"
import { ROOMS_TIME_ZONE } from "@/lib/conference-rooms"

/**
 * Conference-room availability for a single day.
 *
 *   GET /api/conference-rooms?date=YYYY-MM-DD   (date optional → today, Eastern)
 *
 * Returns each room's occupied blocks (7am–6pm Eastern) for the Logistics →
 * Conference Rooms page. /api/* bypasses proxy.ts, so this self-guards: any
 * signed-in caller whose role can access /conference-rooms is allowed (same
 * allow-list as the page).
 */

export const dynamic = "force-dynamic"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Today's Eastern calendar date, 'YYYY-MM-DD', regardless of server TZ. */
function todayInEastern(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ROOMS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteAccess("/conference-rooms")
  if (!auth.ok) return auth.response

  const raw = request.nextUrl.searchParams.get("date")
  const date = raw && DATE_RE.test(raw) ? raw : todayInEastern()

  try {
    const data = await getConferenceRoomSchedules(date)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GraphError) {
      return NextResponse.json(
        { error: "Graph request failed", status: err.status, body: err.body },
        { status: 502 },
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

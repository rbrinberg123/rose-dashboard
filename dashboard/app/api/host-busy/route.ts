import { NextResponse } from "next/server"
import { requireRouteAccess } from "@/lib/api-auth"
import { GraphError } from "@/lib/graph"
import { getHostBusy } from "@/lib/host-busy-data"

/**
 * Outlook busy-time overlay for the Scheduler.
 *
 *   POST /api/host-busy
 *   body: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", hostIds: string[] }
 *
 * Returns each host's Outlook busy blocks across the (inclusive, Eastern) day
 * range. POST — not GET — because the Day view sends the full shown-host list
 * (~28 ids), which is unwieldy in a query string; POST responses are also never
 * cached, which is what we want for live free/busy. /api/* bypasses proxy.ts, so
 * this self-guards with the SAME allow-list as the /scheduler page.
 */

export const dynamic = "force-dynamic"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_HOSTS = 100
const MAX_RANGE_DAYS = 31

export async function POST(request: Request) {
  const auth = await requireRouteAccess("/scheduler")
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { startDate, endDate, hostIds } = (body ?? {}) as {
    startDate?: unknown
    endDate?: unknown
    hostIds?: unknown
  }

  if (typeof startDate !== "string" || !DATE_RE.test(startDate)) {
    return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 })
  }
  if (typeof endDate !== "string" || !DATE_RE.test(endDate)) {
    return NextResponse.json({ error: "endDate must be YYYY-MM-DD" }, { status: 400 })
  }
  if (endDate < startDate) {
    return NextResponse.json({ error: "endDate must be on or after startDate" }, { status: 400 })
  }
  // Cheap guard against an absurd range (string dates → day count via UTC).
  const spanDays =
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000
  if (spanDays > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `range exceeds ${MAX_RANGE_DAYS} days` }, { status: 400 })
  }
  if (!Array.isArray(hostIds) || !hostIds.every((h) => typeof h === "string")) {
    return NextResponse.json({ error: "hostIds must be an array of strings" }, { status: 400 })
  }
  if (hostIds.length > MAX_HOSTS) {
    return NextResponse.json({ error: `too many hostIds (max ${MAX_HOSTS})` }, { status: 400 })
  }

  try {
    const data = await getHostBusy(hostIds as string[], startDate, endDate)
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

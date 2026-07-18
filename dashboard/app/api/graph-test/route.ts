import { type NextRequest, NextResponse } from "next/server"
import { getSchedule, GraphError } from "@/lib/graph"

/**
 * TEMPORARY Stage-3 smoke test for the Microsoft Graph integration.
 *
 * Hits getSchedule for the given emails and returns the raw free/busy result,
 * so we can confirm real calendar data flows end-to-end before building any UI.
 * DELETE this route once the integration is wired into real views.
 *
 * Auth: `/api/*` bypasses the Supabase auth proxy (see proxy.ts), and this
 * response contains calendar data, so the route is gated to non-production.
 * In production it 403s unless called with `Authorization: Bearer <CRON_SECRET>`.
 *
 * Usage (local dev):
 *   GET /api/graph-test?emails=alice@roseandco.com,bob@roseandco.com
 *   Optional: &caller=scott@roseandco.com  (else env GRAPH_CALLER_MAILBOX)
 *             &date=2026-07-18             (else today, US Eastern)
 *             &interval=30                 (5–1440, default 30)
 */

export const dynamic = "force-dynamic"

const TIME_ZONE = "America/New_York"

/** Free/busy digit → meaning, for the packed availabilityView string. */
const AVAILABILITY_LEGEND: Record<string, string> = {
  "0": "free",
  "1": "tentative",
  "2": "busy",
  "3": "out of office",
  "4": "working elsewhere",
}

/** Today's calendar date (YYYY-MM-DD) in US Eastern, regardless of server TZ. */
function todayInEastern(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function decodeAvailability(view: string): string {
  return (
    view
      .split("")
      .map((d) => AVAILABILITY_LEGEND[d] ?? `unknown(${d})`)
      .join(", ") || "(empty)"
  )
}

export async function GET(request: NextRequest) {
  // Gate: dev-only, unless a valid CRON_SECRET bearer is presented.
  const isProd = process.env.NODE_ENV === "production"
  const secret = process.env.CRON_SECRET
  const bearerOk = !!secret && request.headers.get("authorization") === `Bearer ${secret}`
  if (isProd && !bearerOk) {
    return NextResponse.json({ error: "Not available in production." }, { status: 403 })
  }

  const params = request.nextUrl.searchParams

  const caller = params.get("caller") ?? process.env.GRAPH_CALLER_MAILBOX ?? ""
  if (!caller) {
    return NextResponse.json(
      {
        error:
          "No caller mailbox. Pass ?caller=you@roseandco.com or set GRAPH_CALLER_MAILBOX in .env.local.",
      },
      { status: 400 },
    )
  }

  const emails = (params.get("emails") ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
  if (emails.length === 0) {
    return NextResponse.json(
      { error: "No target emails. Pass ?emails=alice@roseandco.com,bob@roseandco.com" },
      { status: 400 },
    )
  }

  const date = params.get("date") ?? todayInEastern()
  const interval = Number(params.get("interval") ?? "30")

  try {
    const value = await getSchedule({
      callerMailbox: caller,
      schedules: emails,
      startTime: { dateTime: `${date}T00:00:00`, timeZone: TIME_ZONE },
      endTime: { dateTime: `${date}T23:59:59`, timeZone: TIME_ZONE },
      availabilityViewInterval: interval,
    })

    return NextResponse.json({
      ok: true,
      caller,
      query: { emails, date, interval, timeZone: TIME_ZONE },
      legend: AVAILABILITY_LEGEND,
      // Convenience decode alongside the raw Graph payload.
      schedules: value.map((s) => ({
        scheduleId: s.scheduleId,
        availabilityView: s.availabilityView,
        availabilityDecoded: s.availabilityView ? decodeAvailability(s.availabilityView) : null,
        scheduleItemCount: s.scheduleItems?.length ?? 0,
        error: s.error ?? null,
      })),
      raw: value,
    })
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

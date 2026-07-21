import { NextResponse } from "next/server"
import { requireSuperUser } from "@/lib/api-auth"
import { loadLiveOutreachRows } from "@/app/live-outreach/load"
import { buildEmailHtml } from "@/app/live-outreach/email-html"

/**
 * Preview-only endpoint for the Live Outreach digest.
 *
 * A signed-in **super_user** can GET this to see the exact HTML the send route
 * would email, rendered in the browser, WITHOUT sending anything. Read-only: it
 * loads the same live v_live_outreach data and calls the same builder as the
 * send path, then returns the fragment as text/html. Separate from the send
 * route because that route's GET is the scheduled cron path.
 */

export const dynamic = "force-dynamic"

const TIME_ZONE = "America/New_York"

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date())
}

export async function GET() {
  const auth = await requireSuperUser()
  if (!auth.ok) return auth.response

  const { rows, error } = await loadLiveOutreachRows()
  if (error) {
    return NextResponse.json({ error: `Could not load v_live_outreach: ${error}` }, { status: 500 })
  }

  const html = buildEmailHtml(rows, todayLabel())
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

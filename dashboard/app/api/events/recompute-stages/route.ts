import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServer } from "@/lib/supabase"
import { hasCronBearer } from "@/lib/cron-auth"

/**
 * Daily EVENT-LIFECYCLE recompute sweep.
 *
 * A dashboard-origin event's stage is computed by the database and refreshed by
 * triggers whenever a toggle, meeting or feedback task changes. Two steps,
 * though, depend on the CALENDAR rather than on any write — entering Meetings
 * Ongoing on the meetings-start day, and reaching Preparing Feedback the
 * morning after the last meeting — so this sweep re-evaluates every active
 * dashboard-origin event once a day (events_recompute_all_stages, in
 * sql/patches/2026-10-07e_event_lifecycle.sql). Dynamics-origin events are
 * never touched. Idempotent: an unchanged stage is not rewritten.
 *
 * Vercel Cron (GET) on the schedule in vercel.json, which attaches
 * `Authorization: Bearer ${CRON_SECRET}`. /api is outside the auth proxy, so
 * the bearer check here is the whole gate — it fails closed without a secret.
 *
 * Registered in lib/automations/registry.ts ("event-lifecycle-daily").
 */

export const dynamic = "force-dynamic"

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!hasCronBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { data, error } = await getSupabaseServer().rpc("events_recompute_all_stages")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ changed: Number(data ?? 0) })
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}

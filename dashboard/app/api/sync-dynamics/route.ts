import { type NextRequest, NextResponse } from "next/server"
import { runSync } from "@/lib/sync/run"

/**
 * Dynamics → Supabase sync.
 *
 * Runs at a TEN-MINUTE interval on weekdays, not nightly — 11:00-22:59 UTC,
 * Mon-Fri (roughly the Eastern working day). The exact cron expression is in
 * vercel.json and repeated in the line comment below; it cannot be written in a
 * block comment because it contains the comment-terminating sequence. Each run
 * is incremental (only records whose `modifiedon` is after the entity
 * watermark), which is what makes that cadence cheap.
 *
 * Invoked two ways, both gated by the same bearer token:
 *   - Vercel Cron (GET) on the schedule in vercel.json. Vercel automatically
 *     attaches `Authorization: Bearer ${CRON_SECRET}`.
 *   - The admin "Run sync now" button (POST), via a server action that adds
 *     the same header server-side (the secret never reaches the browser).
 *
 * This route handles its own auth, so it is excluded from the Supabase auth
 * proxy (see proxy.ts matcher). Without a valid CRON_SECRET it returns 401.
 */

// vercel.json cron: */10 11-22 * * 1-5
export const dynamic = "force-dynamic"
// Allow a long-running full pull. Vercel caps this per plan; cron jobs get the
// extended limit. 300s is plenty for the current data volumes.
export const maxDuration = 300

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Fail closed: if the secret isn't configured, reject everything rather
    // than running unauthenticated.
    return false
  }
  const header = request.headers.get("authorization")
  return header === `Bearer ${secret}`
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!process.env.CRON_SECRET) {
    // Belt-and-suspenders; isAuthorized already covers this.
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }

  try {
    const result = await runSync()
    const anyError = result.entities.some((e) => e.status === "error")
    return NextResponse.json(result, { status: anyError ? 207 : 200 })
  } catch (err) {
    // runSync swallows per-entity failures; reaching here means something
    // unexpected (e.g. Supabase client misconfigured).
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}

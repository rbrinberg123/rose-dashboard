import { type NextRequest, NextResponse } from "next/server"
import { runReconciliation } from "@/lib/sync/reconcile"

/**
 * Nightly deletion-reconciliation sweep.
 *
 * Pulls the full set of live primary keys per entity from Dynamics, diffs them
 * against the Supabase mirror tables, and flags rows missing upstream into the
 * `deletion_candidates` review queue. It NEVER deletes mirror data — an admin
 * approves each removal in /admin/reconciliation.
 *
 * Invoked two ways, both gated by the same bearer token (identical to
 * /api/sync-dynamics):
 *   - Vercel Cron (GET) on the schedule in vercel.json (runs after the sync so
 *     it reconciles against a fresh mirror). Vercel attaches
 *     `Authorization: Bearer ${CRON_SECRET}` automatically.
 *   - The admin "Run sweep now" button (POST), via a server action that adds
 *     the same header server-side (the secret never reaches the browser).
 *
 * This route handles its own auth, so it is excluded from the Supabase auth
 * proxy (see proxy.ts matcher). Without a valid CRON_SECRET it returns 401.
 */

export const dynamic = "force-dynamic"
// A full-population id pull across all entities can take a while; give it the
// same extended budget as the sync route.
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
    const result = await runReconciliation()
    const anySkipped = result.entities.some((e) => e.skipped)
    return NextResponse.json(result, { status: anySkipped ? 207 : 200 })
  } catch (err) {
    // runReconciliation records per-entity skips itself; reaching here means
    // something unexpected (e.g. Supabase client misconfigured).
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

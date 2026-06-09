import { NextResponse } from "next/server"
import { getSupabaseServer } from "@/lib/supabase"

/**
 * Read-only sync status. Returns per-entity state from sync_runs plus the most
 * recent rows from sync_errors. No auth required — this is non-sensitive
 * operational status (no business data, no secrets).
 *
 * Handles its own (absence of) auth, so it is excluded from the proxy matcher.
 */

export const dynamic = "force-dynamic"

const RECENT_ERROR_LIMIT = 50

export async function GET() {
  const sb = getSupabaseServer()

  const [runsRes, errorsRes] = await Promise.all([
    sb.from("sync_runs").select("*").order("entity_name", { ascending: true }),
    sb
      .from("sync_errors")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(RECENT_ERROR_LIMIT),
  ])

  const firstError = runsRes.error ?? errorsRes.error
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 })
  }

  return NextResponse.json({
    runs: runsRes.data ?? [],
    recentErrors: errorsRes.data ?? [],
  })
}

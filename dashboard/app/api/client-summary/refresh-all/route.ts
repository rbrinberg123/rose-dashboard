import { type NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getSupabaseServer } from "@/lib/supabase"
import {
  ClientSummaryError,
  generateAndCacheClientSummary,
  listActiveClientIds,
} from "@/lib/client-summary"

/**
 * Nightly batch: regenerate + cache the AI summary for EVERY active client.
 *
 * Invoked two ways, both gated by the same bearer token (same pattern as
 * /api/sync-dynamics):
 *   - Vercel Cron (GET) on the schedule in vercel.json — Vercel automatically
 *     attaches `Authorization: Bearer ${CRON_SECRET}`.
 *   - A manual run (GET or POST) where you attach the same header yourself.
 *
 * Costs Anthropic API money per client, so it MUST stay non-public: without a
 * valid CRON_SECRET it returns 401. /api/* is excluded from the Supabase auth
 * proxy (see proxy.ts matcher), so this route owns its auth.
 *
 * Each client is generated independently; one failure is logged and the batch
 * continues. The response reports how many succeeded / failed.
 */

export const dynamic = "force-dynamic"
// Long-running: ~105 clients, each one Haiku call. Vercel caps this per plan
// (Pro allows up to 300s). See CONCURRENCY below for the wall-time math.
export const maxDuration = 300

// How many clients to generate at once. 5 keeps us well under the Anthropic
// rate limit while finishing ~105 clients in roughly a minute. Raise it to cut
// wall time (watch for 429s); lower it if you hit rate limits.
const CONCURRENCY = 5

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  // Fail closed: if the secret isn't configured, reject everything rather than
  // running this paid endpoint unauthenticated.
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

type Failure = { account_id: string; error: string }

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server." },
      { status: 500 },
    )
  }

  const startedAt = Date.now()
  const sb = getSupabaseServer()
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    // Smooth over transient 429/529s during the burst.
    maxRetries: 3,
  })

  let accountIds: string[]
  try {
    accountIds = await listActiveClientIds(sb)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  let succeeded = 0
  const failures: Failure[] = []

  // Bounded concurrency: process the list in chunks of CONCURRENCY so we never
  // fan out all ~105 Haiku calls at once. One client erroring never kills the
  // batch — Promise.allSettled isolates each, and we tally the rejections.
  for (let i = 0; i < accountIds.length; i += CONCURRENCY) {
    const chunk = accountIds.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      chunk.map((id) => generateAndCacheClientSummary(sb, anthropic, id)),
    )
    results.forEach((res, j) => {
      if (res.status === "fulfilled") {
        succeeded += 1
      } else {
        const reason = res.reason
        const message =
          reason instanceof ClientSummaryError || reason instanceof Error
            ? reason.message
            : String(reason)
        failures.push({ account_id: chunk[j], error: message })
        console.error(`[refresh-all] ${chunk[j]} failed: ${message}`)
      }
    })
  }

  const elapsedMs = Date.now() - startedAt
  // 207 Multi-Status when some clients failed, 200 when all succeeded.
  const status = failures.length > 0 ? 207 : 200
  return NextResponse.json(
    {
      total: accountIds.length,
      succeeded,
      failed: failures.length,
      elapsed_ms: elapsedMs,
      failures,
    },
    { status },
  )
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}

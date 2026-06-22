import { type NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getSupabaseServer } from "@/lib/supabase"
import {
  ClientSummaryError,
  generateAndCacheClientSummary,
  isClientSummaryStale,
  listActiveClientsForRefresh,
} from "@/lib/client-summary"

/**
 * Nightly batch: refresh + cache the AI summary for active clients that need it.
 *
 * By default only clients that are stale (summary older than
 * STALENESS_THRESHOLD_DAYS) or whose underlying data changed since their last
 * summary are regenerated; fresh, unchanged clients are skipped to avoid
 * redundant paid calls. Pass ?force=1 to regenerate every active client (e.g.
 * after a prompt change). Generation is paced (see CONCURRENCY/CHUNK_DELAY_MS)
 * to stay under the Anthropic per-minute rate limit.
 *
 * Invoked two ways, both gated by the same bearer token (same pattern as
 * /api/sync-dynamics):
 *   - Vercel Cron (GET) on the schedule in vercel.json — Vercel automatically
 *     attaches `Authorization: Bearer ${CRON_SECRET}`.
 *   - A manual run (GET or POST) where you attach the same header yourself.
 *     Add ?force=1 here to force a full regenerate.
 *
 * Costs Anthropic API money per client, so it MUST stay non-public: without a
 * valid CRON_SECRET it returns 401. /api/* is excluded from the Supabase auth
 * proxy (see proxy.ts matcher), so this route owns its auth.
 *
 * Each client is generated independently; one failure is logged and the batch
 * continues. The response reports active / attempted / skipped / succeeded /
 * failed counts.
 */

export const dynamic = "force-dynamic"
// Long-running but deliberately paced (see CONCURRENCY/CHUNK_DELAY_MS). Vercel
// caps this per plan (Pro allows up to 300s). A full force-refresh of ~105
// clients lands around ~4 min; the normal nightly run only touches the handful
// of clients that changed, so it finishes far sooner. If a full run ever clips
// the cap, the unfinished clients still look stale and are picked up next night.
export const maxDuration = 300

// Pace under a low Anthropic tier (e.g. tier-1 ~50 req/min). 2 calls at a time
// plus a short gap between chunks holds us around ~27 req/min — well under the
// limit — instead of the old ~105-in-60s burst. It runs at 03:00 ET, so slow is
// fine. Raise CONCURRENCY / lower CHUNK_DELAY_MS only if you move to a higher tier.
const CONCURRENCY = 2
const CHUNK_DELAY_MS = 2000

// Regenerate an unchanged client only once its summary passes this age (a
// freshness floor); clients whose data changed are refreshed regardless of age.
const STALENESS_THRESHOLD_DAYS = 7

// Evaluate staleness with more parallelism than generation: these are cheap
// Supabase count queries, not paid Anthropic calls, so they need no pacing.
const STALENESS_CHECK_CONCURRENCY = 10

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

  // ?force=1 regenerates every active client, bypassing the staleness check —
  // use it after changing the prompt so everyone is refreshed.
  const force = new URL(request.url).searchParams.get("force") === "1"

  const startedAt = Date.now()
  const sb = getSupabaseServer()
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    // Pacing keeps us under the rate limit, so we no longer need aggressive
    // retries (3 multiplied each rate-limited call into several limit events).
    // One gentle retry still smooths over an occasional transient 529.
    maxRetries: 1,
  })

  // The active set, each with its last-generated timestamp.
  let candidates: Awaited<ReturnType<typeof listActiveClientsForRefresh>>
  try {
    candidates = await listActiveClientsForRefresh(sb)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // Decide which clients to regenerate. force = all; otherwise only the ones
  // that are stale or whose underlying data changed. The staleness probes are
  // cheap Supabase reads, run with their own (higher) concurrency.
  let accountIds: string[]
  let skipped = 0
  try {
    if (force) {
      accountIds = candidates.map((c) => c.account_id)
    } else {
      accountIds = []
      for (let i = 0; i < candidates.length; i += STALENESS_CHECK_CONCURRENCY) {
        const chunk = candidates.slice(i, i + STALENESS_CHECK_CONCURRENCY)
        const flags = await Promise.all(
          chunk.map((c) =>
            isClientSummaryStale(sb, c, STALENESS_THRESHOLD_DAYS),
          ),
        )
        flags.forEach((stale, j) => {
          if (stale) accountIds.push(chunk[j].account_id)
          else skipped += 1
        })
      }
    }
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
    // Space the chunks out to stay under the per-minute rate limit. Skip the
    // wait after the final chunk.
    if (i + CONCURRENCY < accountIds.length) {
      await sleep(CHUNK_DELAY_MS)
    }
  }

  const elapsedMs = Date.now() - startedAt
  // 207 Multi-Status when some clients failed, 200 when all succeeded.
  const status = failures.length > 0 ? 207 : 200
  return NextResponse.json(
    {
      forced: force,
      active: candidates.length,
      attempted: accountIds.length,
      skipped,
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

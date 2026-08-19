import { type NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getSupabaseServer } from "@/lib/supabase"
import { requireSuperUser } from "@/lib/api-auth"
import { hasCronBearer } from "@/lib/cron-auth"
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
 * to stay under the Anthropic per-minute rate limit, and each client gets its
 * own exponential backoff on a 429/529/5xx (see generateWithBackoff).
 *
 * FORCED FULL REGENERATE (query params, all optional, all require force=1):
 *
 *   ?force=1
 *       Regenerate every active client, no staleness check.
 *
 *   &before=<ISO timestamp>   — RESUMABLE. Only regenerate clients whose
 *       ai_summary_generated_at is NULL or older than this instant. Because a
 *       successful client stamps a NEW (later) timestamp, re-running the SAME
 *       url after a crash/timeout skips everyone already done and picks up
 *       exactly where it stopped. Pass the campaign's start time and keep it
 *       fixed across retries — that is the whole resumability mechanism.
 *
 *   &limit=<n>                — Regenerate at most n clients this invocation
 *       and report how many are left, so a long campaign can be split into
 *       several calls that each finish well inside maxDuration.
 *
 * The response's `remaining` is the count still matching the filter after this
 * invocation; a driver loops on the same URL until it reaches 0. Writes are
 * plain UPDATEs of ai_summary / ai_summary_generated_at — always OVERWRITE,
 * never append — so re-running is safe and cannot corrupt or duplicate data.
 *
 * Invoked three ways:
 *   - Vercel Cron (GET) on the schedule in vercel.json — Vercel automatically
 *     attaches `Authorization: Bearer ${CRON_SECRET}`.
 *   - A manual run (GET or POST) where you attach the same header yourself
 *     (scripts/refresh-summaries.mjs does this). Add ?force=1 to force a full
 *     regenerate.
 *   - The Admin hub's "Refresh all AI summaries" button, which POSTs here from
 *     the browser with the caller's SESSION and no token — authorized by
 *     requireSuperUser() instead (same guard the other admin-triggered routes
 *     use). See hasCronBearer/authorize below.
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

// Per-client retry for transient upstream failures. Rate-limited (429) and
// overloaded (529) are the ones that actually happen; a 5xx is worth one look
// too. Anything else (a missing client, a cache-write failure) is a real
// failure and is reported immediately rather than burning retries.
const RETRYABLE_UPSTREAM = new Set([408, 409, 429, 500, 502, 503, 529])
const BACKOFF_MS = [5_000, 15_000, 45_000]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Generate one client's summary, backing off exponentially on a transient
 * upstream error. Safe to retry: the Supabase write happens only AFTER a
 * successful generation, so a retried client is simply generated again — it
 * never half-writes.
 */
async function generateWithBackoff(
  sb: ReturnType<typeof getSupabaseServer>,
  anthropic: Anthropic,
  accountId: string,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await generateAndCacheClientSummary(sb, anthropic, accountId)
    } catch (err) {
      const upstream =
        err instanceof ClientSummaryError ? err.upstreamStatus : undefined
      if (
        attempt >= BACKOFF_MS.length ||
        upstream === undefined ||
        !RETRYABLE_UPSTREAM.has(upstream)
      ) {
        throw err
      }
      const wait = BACKOFF_MS[attempt]
      console.warn(
        `[refresh-all] ${accountId}: upstream ${upstream} — backing off ${wait}ms (retry ${attempt + 1}/${BACKOFF_MS.length})`,
      )
      await sleep(wait)
    }
  }
}

/**
 * Authorize by EITHER path:
 *   - the cron bearer token (Vercel Cron, the CLI script), or
 *   - a signed-in super_user session (the Admin hub button, so nobody has to
 *     handle the secret in a browser).
 *
 * The session check runs only when the token is absent, so the cron path stays
 * a pure header comparison with no auth round-trip. Returns null when allowed,
 * or the response to send when not.
 */
async function authorize(request: NextRequest): Promise<NextResponse | null> {
  if (hasCronBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return null
  }
  const auth = await requireSuperUser()
  return auth.ok ? null : auth.response
}

type Failure = { account_id: string; error: string }

async function handle(request: NextRequest): Promise<NextResponse> {
  const denied = await authorize(request)
  if (denied) return denied
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server." },
      { status: 500 },
    )
  }

  // ?force=1 regenerates every active client, bypassing the staleness check —
  // use it after changing the prompt so everyone is refreshed. ?before= and
  // ?limit= make that forced run resumable and splittable (see the header).
  const params = new URL(request.url).searchParams
  const force = params.get("force") === "1"

  const beforeRaw = params.get("before")
  let before: Date | null = null
  if (beforeRaw !== null) {
    if (!force) {
      return NextResponse.json(
        { error: "before= only applies to a forced run; add force=1." },
        { status: 400 },
      )
    }
    const parsed = new Date(beforeRaw)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: `before= is not a valid ISO timestamp: ${beforeRaw}` },
        { status: 400 },
      )
    }
    before = parsed
  }

  const limitRaw = params.get("limit")
  let limit: number | null = null
  if (limitRaw !== null) {
    if (!force) {
      return NextResponse.json(
        { error: "limit= only applies to a forced run; add force=1." },
        { status: 400 },
      )
    }
    const parsed = Number(limitRaw)
    if (!Number.isInteger(parsed) || parsed < 1) {
      return NextResponse.json(
        { error: `limit= must be a positive integer: ${limitRaw}` },
        { status: 400 },
      )
    }
    limit = parsed
  }

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
  let eligible = 0
  let skipped = 0
  try {
    if (force) {
      // RESUME FILTER: with ?before=, a client that already regenerated in this
      // campaign now carries a LATER timestamp and drops out — so re-running the
      // identical URL continues rather than starting over.
      const pending = before
        ? candidates.filter((c) => {
            if (!c.ai_summary_generated_at) return true
            const at = new Date(c.ai_summary_generated_at)
            return Number.isNaN(at.getTime()) || at < before
          })
        : candidates
      eligible = pending.length
      skipped = candidates.length - eligible
      accountIds = pending.map((c) => c.account_id)
      // ?limit= caps THIS invocation; the rest are reported as `remaining`.
      if (limit !== null) accountIds = accountIds.slice(0, limit)
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
      eligible = accountIds.length
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
  const total = accountIds.length
  if (total > 0) {
    console.log(
      `[refresh-all] starting: ${total} to regenerate` +
        (force ? " (forced)" : "") +
        (before ? ` — resumable window before ${before.toISOString()}` : "") +
        (limit !== null ? `, limit ${limit} this run` : "") +
        `; ${candidates.length} active clients total.`,
    )
  }

  for (let i = 0; i < accountIds.length; i += CONCURRENCY) {
    const chunk = accountIds.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      chunk.map((id) => generateWithBackoff(sb, anthropic, id)),
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
    // Progress, so a long run is observable in the server log rather than
    // silent until it returns.
    const done = Math.min(i + CONCURRENCY, total)
    console.log(
      `[refresh-all] ${done}/${total} done — ${succeeded} ok, ${failures.length} failed`,
    )
    // Space the chunks out to stay under the per-minute rate limit. Skip the
    // wait after the final chunk.
    if (i + CONCURRENCY < accountIds.length) {
      await sleep(CHUNK_DELAY_MS)
    }
  }

  const elapsedMs = Date.now() - startedAt
  // What is still waiting AFTER this invocation: whatever the filter matched
  // but the limit deferred, plus anything that failed (a failure leaves the old
  // timestamp in place, so the resume filter picks it up again next run).
  const remaining = Math.max(0, eligible - succeeded)
  console.log(
    `[refresh-all] finished: ${succeeded} succeeded, ${failures.length} failed, ${remaining} remaining, ${Math.round(elapsedMs / 1000)}s.`,
  )
  // 207 Multi-Status when some clients failed, 200 when all succeeded.
  const status = failures.length > 0 ? 207 : 200
  return NextResponse.json(
    {
      forced: force,
      before: before ? before.toISOString() : null,
      limit,
      active: candidates.length,
      eligible,
      attempted: accountIds.length,
      skipped,
      succeeded,
      failed: failures.length,
      // 0 means the campaign is complete; a driver loops while this is > 0.
      remaining,
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

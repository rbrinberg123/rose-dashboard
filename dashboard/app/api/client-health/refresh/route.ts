import { randomUUID } from "node:crypto"
import { after, type NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getSupabaseServer } from "@/lib/supabase"
import { requireSuperUser } from "@/lib/api-auth"
import { hasCronBearer } from "@/lib/cron-auth"
import { isUuid } from "@/lib/crm-write"
import { AI_BATCH_CONFIG, runThrottled, sleep } from "@/lib/ai-batch"
import { isFrameworkConfigured } from "@/lib/client-health-prompt"
import { listActiveClientIds } from "@/lib/client-summary"
import {
  generateWithBackoff,
  isActiveClientId,
  listPendingForRun,
  recordClientHealthError,
} from "@/lib/client-health"
import {
  claimLease,
  createRun,
  finishRun,
  getLatestRun,
  getRunningRun,
  getRunStatus,
  heartbeat,
  releaseLease,
} from "@/lib/client-health-runs"
import { decideStart, isRunAlive } from "@/lib/client-health-run-policy"

/**
 * Client Health — the ONE batch route, used by the weekly cron, the page's
 * Refresh button and the per-client Regenerate. Every path goes through the
 * SHARED throttling in lib/ai-batch.ts (same concurrency cap, pacing and
 * jittered backoff as the AI client summary).
 *
 * ACTIONS
 *   (cron)               GET/POST with the CRON_SECRET bearer and no action →
 *                        start-or-resume as trigger 'cron'.
 *   ?action=start        POST, super-user. Start a full run of every active
 *                        client (or resume a stale one).
 *   ?action=status       GET, super-user. Run status + progress for the page.
 *   ?action=continue     Bearer only — the self-chained next batch of a run.
 *   ?account_id=<uuid>   POST, super-user. Re-rate one client now (refused
 *                        while a full run is in progress).
 *
 * HOW A RUN EXECUTES (serverless-safe)
 *   A start creates a client_health_runs row (single-flight: at most one is
 *   'running') and responds 202 at once. The work happens in after(): ONE batch
 *   of BATCH_SIZE clients, each persisted the moment it finishes. If clients
 *   remain, the batch releases its lease and POSTs ?action=continue to itself,
 *   which claims the lease and does the next batch — one batch per invocation,
 *   so none ever nears maxDuration. If a link in that chain dies, the run's
 *   heartbeat lapses (LEASE_MS) and the next start request or cron watchdog
 *   reclaims and resumes it; listPendingForRun skips every client already
 *   rated or tried in that run.
 *
 * AUTH: the cron bearer OR a signed-in super_user session. /api/* bypasses
 * proxy.ts, so this route is its own boundary. Refuses to generate (503)
 * until the framework is in lib/client-health-prompt.ts.
 */

export const dynamic = "force-dynamic"
export const maxDuration = 300

/** Stop starting new groups after this long, leaving room under maxDuration. */
const BATCH_TIME_BUDGET_MS = 200_000

type Caller = { kind: "cron" } | { kind: "user"; email: string }

async function authorize(request: NextRequest): Promise<Caller | NextResponse> {
  if (hasCronBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return { kind: "cron" }
  }
  const auth = await requireSuperUser()
  return auth.ok ? { kind: "user", email: auth.email } : auth.response
}

function newAnthropic() {
  // maxRetries 1: the SDK honours retry-after once; our shared backoff does the rest.
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 90_000 })
}

function generationBlocked(): NextResponse | null {
  if (!isFrameworkConfigured()) {
    return NextResponse.json(
      { error: "The Client Health classification framework has not been added (lib/client-health-prompt.ts)." },
      { status: 503 },
    )
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 })
  }
  return null
}

/**
 * Do ONE batch of run `runId` (the caller already holds its lease), then either
 * finish the run or hand off to the next batch. Never throws.
 */
async function processBatch(runId: string, origin: string, isContinuation: boolean): Promise<void> {
  const sb = getSupabaseServer()
  const startedAt = Date.now()
  try {
    if (isContinuation) await sleep(AI_BATCH_CONFIG.DELAY_MS_BETWEEN_BATCHES)

    const { pending } = await listPendingForRun(sb, runId)
    if (pending.length === 0) {
      await finishRun(sb, runId)
      console.log(`[client-health] run ${runId} finished.`)
      return
    }

    const batch = pending.slice(0, AI_BATCH_CONFIG.BATCH_SIZE)
    const anthropic = newAnthropic()
    let processed = 0
    await runThrottled(batch, (id) => generateWithBackoff(sb, anthropic, id, runId), {
      concurrency: AI_BATCH_CONFIG.MAX_CONCURRENCY,
      delayMs: AI_BATCH_CONFIG.DELAY_MS_BETWEEN_CHUNKS,
      shouldStop: () => Date.now() - startedAt > BATCH_TIME_BUDGET_MS,
      onGroupDone: async (results) => {
        for (const { id, result } of results) {
          if (result.status === "rejected") {
            const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
            console.error(`[client-health] ${id} failed: ${message}`)
            await recordClientHealthError(sb, id, message, runId)
          }
        }
        processed += results.length
        await heartbeat(sb, runId)
      },
    })

    const remaining = pending.length - processed
    console.log(`[client-health] run ${runId}: batch of ${processed} done, ${remaining} remaining.`)
    if (remaining <= 0) {
      await finishRun(sb, runId)
      console.log(`[client-health] run ${runId} finished.`)
      return
    }

    // Hand off: release the lease, then trigger the next batch. The next
    // invocation responds immediately (its work is in its own after()), so this
    // await is short and the chain never nests lifetimes.
    await releaseLease(sb, runId)
    const secret = process.env.CRON_SECRET
    if (!secret) {
      console.error("[client-health] CRON_SECRET is not set — cannot chain the next batch; the run will be resumed by the next start / watchdog.")
      return
    }
    const res = await fetch(`${origin}/api/client-health/refresh?action=continue&run_id=${runId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    })
    if (!res.ok) {
      console.error(`[client-health] chaining the next batch returned ${res.status}; the run will be resumed by the next start / watchdog.`)
    }
  } catch (err) {
    console.error(`[client-health] batch for run ${runId} crashed:`, err)
    // Free the lease so the run can be reclaimed once its heartbeat lapses.
    await releaseLease(sb, runId)
  }
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const caller = await authorize(request)
  if (caller instanceof NextResponse) return caller

  const url = new URL(request.url)
  const params = url.searchParams
  const accountId = params.get("account_id")
  const action = accountId ? "single" : (params.get("action") ?? (caller.kind === "cron" ? "start" : "status"))
  const sb = getSupabaseServer()

  try {
    // ---- status ---------------------------------------------------------------
    if (action === "status") {
      return NextResponse.json(await getRunStatus(sb))
    }

    const blocked = generationBlocked()
    if (blocked) return blocked

    // ---- single client --------------------------------------------------------
    if (action === "single") {
      if (!isUuid(accountId!)) return NextResponse.json({ error: "account_id must be a uuid." }, { status: 400 })
      if (!(await isActiveClientId(sb, accountId!))) {
        return NextResponse.json({ error: "That client is not an active client." }, { status: 404 })
      }
      const running = await getRunningRun(sb)
      if (running && isRunAlive(running, Date.now())) {
        return NextResponse.json(
          { error: "A full refresh is in progress. Try again when it finishes." },
          { status: 409 },
        )
      }
      const runId = randomUUID()
      try {
        const r = await generateWithBackoff(sb, newAnthropic(), accountId!, runId)
        return NextResponse.json({ ok: true, rating: r.rating, note: r.note })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await recordClientHealthError(sb, accountId!, message, runId)
        return NextResponse.json({ error: message }, { status: 502 })
      }
    }

    // ---- continue (self-chained batch) ----------------------------------------
    if (action === "continue") {
      if (caller.kind !== "cron") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      const runId = params.get("run_id")
      if (!runId || !isUuid(runId)) return NextResponse.json({ error: "run_id must be a uuid." }, { status: 400 })
      if (!(await claimLease(sb, runId))) {
        // Someone else holds it, or the run is finished — nothing to do.
        return NextResponse.json({ status: "not_claimed", run_id: runId }, { status: 200 })
      }
      after(() => processBatch(runId, url.origin, true))
      return NextResponse.json({ status: "continuing", run_id: runId }, { status: 202 })
    }

    // ---- start (cron or manual) -----------------------------------------------
    if (action === "start") {
      if (caller.kind === "user" && request.method !== "POST") {
        return NextResponse.json({ error: "Use POST to start a run." }, { status: 405 })
      }
      const trigger = caller.kind === "cron" ? "cron" : "manual"
      const [running, latest] = await Promise.all([getRunningRun(sb), getLatestRun(sb)])
      const decision = decideStart(running, latest, trigger, Date.now())

      if (decision.kind === "already_running") {
        return NextResponse.json({ status: "already_running", run_id: running!.run_id }, { status: 200 })
      }
      if (decision.kind === "up_to_date") {
        return NextResponse.json({ status: "up_to_date", run_id: latest!.run_id }, { status: 200 })
      }
      if (decision.kind === "reclaim") {
        if (!(await claimLease(sb, running!.run_id))) {
          return NextResponse.json({ status: "already_running", run_id: running!.run_id }, { status: 200 })
        }
        console.log(`[client-health] reclaiming stale run ${running!.run_id} (${trigger}).`)
        after(() => processBatch(running!.run_id, url.origin, false))
        return NextResponse.json({ status: "resumed", run_id: running!.run_id }, { status: 202 })
      }

      const active = (await listActiveClientIds(sb)).length
      const run = await createRun(sb, trigger, caller.kind === "user" ? caller.email : null, active)
      if (!run) {
        // Lost a race with another start — the database refused a second run.
        const other = await getRunningRun(sb)
        return NextResponse.json({ status: "already_running", run_id: other?.run_id ?? null }, { status: 200 })
      }
      console.log(`[client-health] run ${run.run_id} started (${trigger}): ${active} active clients.`)
      after(() => processBatch(run.run_id, url.origin, false))
      return NextResponse.json({ status: "started", run_id: run.run_id, total: active }, { status: 202 })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}

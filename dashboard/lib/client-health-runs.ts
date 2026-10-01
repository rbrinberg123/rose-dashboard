import type { SupabaseClient } from "@supabase/supabase-js"
import { HEALTH_TABLE } from "@/lib/client-health"
import { isRunAlive, LEASE_MS, type HealthRun } from "@/lib/client-health-run-policy"

/**
 * public.client_health_runs — the run-status row behind Client Health's
 * single-flight guard and self-chaining batches.
 *
 *   - At most ONE row is 'running' (partial unique index), so a second start
 *     while a run is in progress is refused by the database itself.
 *   - lease_until is the per-batch lock. The batch that holds it renews it
 *     (heartbeat) after every group of calls and releases it when it hands off
 *     to the next chained batch, which claims it again with a conditional
 *     UPDATE. Only one invocation can hold a run's lease at a time.
 *   - A run whose lease AND heartbeat have lapsed (crashed / timed out / chain
 *     link lost) is "stale": the next start request or cron watchdog reclaims
 *     it and resumes — completed clients are skipped (see listPendingForRun).
 */

export const RUNS_TABLE = "client_health_runs"
const COLS = "run_id, trigger, status, total, started_by, started_at, heartbeat_at, lease_until, finished_at"

/** The run currently marked 'running' (alive or stale), or null. */
export async function getRunningRun(sb: SupabaseClient): Promise<HealthRun | null> {
  const { data, error } = await sb.from(RUNS_TABLE).select(COLS).eq("status", "running").maybeSingle()
  if (error) throw new Error(`Failed to read ${RUNS_TABLE}: ${error.message}`)
  return (data as HealthRun | null) ?? null
}

/** The most recently started run of any status, or null. */
export async function getLatestRun(sb: SupabaseClient): Promise<HealthRun | null> {
  const { data, error } = await sb
    .from(RUNS_TABLE)
    .select(COLS)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to read ${RUNS_TABLE}: ${error.message}`)
  return (data as HealthRun | null) ?? null
}

/**
 * Create a new running run with its lease already held by the caller.
 * Returns null when another run is already 'running' (unique-index conflict) —
 * the single-flight guard.
 */
export async function createRun(
  sb: SupabaseClient,
  trigger: "cron" | "manual",
  startedBy: string | null,
  total: number,
): Promise<HealthRun | null> {
  const now = Date.now()
  const { data, error } = await sb
    .from(RUNS_TABLE)
    .insert({
      trigger,
      started_by: startedBy,
      total,
      heartbeat_at: new Date(now).toISOString(),
      lease_until: new Date(now + LEASE_MS).toISOString(),
    })
    .select(COLS)
    .single()
  if (error) {
    if (error.code === "23505") return null
    throw new Error(`Failed to create run: ${error.message}`)
  }
  return data as HealthRun
}

/**
 * Atomically take a running run's lease. Succeeds only when nobody holds it:
 * the lease is unset (a batch just handed off) or expired (its holder died).
 * Returns false when another invocation already holds it.
 */
export async function claimLease(sb: SupabaseClient, runId: string): Promise<boolean> {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const { data, error } = await sb
    .from(RUNS_TABLE)
    .update({ lease_until: new Date(now + LEASE_MS).toISOString(), heartbeat_at: nowIso })
    .eq("run_id", runId)
    .eq("status", "running")
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .select("run_id")
  if (error) throw new Error(`Failed to claim run lease: ${error.message}`)
  return (data ?? []).length === 1
}

/** Renew the lease + heartbeat while a batch is working. */
export async function heartbeat(sb: SupabaseClient, runId: string): Promise<void> {
  const now = Date.now()
  const { error } = await sb
    .from(RUNS_TABLE)
    .update({ heartbeat_at: new Date(now).toISOString(), lease_until: new Date(now + LEASE_MS).toISOString() })
    .eq("run_id", runId)
    .eq("status", "running")
  if (error) console.warn(`[client-health] heartbeat failed for ${runId}: ${error.message}`)
}

/**
 * Release the lease for a handoff. The heartbeat is refreshed at the same time,
 * so the run still reads as ALIVE for LEASE_MS — long enough for the chained
 * batch to claim it, and no longer: if the chain link is lost, the run turns
 * stale and is reclaimed.
 */
export async function releaseLease(sb: SupabaseClient, runId: string): Promise<void> {
  const { error } = await sb
    .from(RUNS_TABLE)
    .update({ lease_until: null, heartbeat_at: new Date().toISOString() })
    .eq("run_id", runId)
    .eq("status", "running")
  if (error) console.warn(`[client-health] lease release failed for ${runId}: ${error.message}`)
}

export async function finishRun(sb: SupabaseClient, runId: string): Promise<void> {
  const nowIso = new Date().toISOString()
  const { error } = await sb
    .from(RUNS_TABLE)
    .update({ status: "finished", finished_at: nowIso, heartbeat_at: nowIso, lease_until: null })
    .eq("run_id", runId)
  if (error) console.warn(`[client-health] could not mark ${runId} finished: ${error.message}`)
}

export type RunStatus = {
  run: (HealthRun & { alive: boolean }) | null
  done: number
  failed: number
}

/** Status for the page: the running run (else the latest), with progress counts. */
export async function getRunStatus(sb: SupabaseClient): Promise<RunStatus> {
  const run = (await getRunningRun(sb)) ?? (await getLatestRun(sb))
  if (!run) return { run: null, done: 0, failed: 0 }
  const [doneRes, failedRes] = await Promise.all([
    sb.from(HEALTH_TABLE).select("*", { count: "exact", head: true }).eq("run_id", run.run_id),
    sb
      .from(HEALTH_TABLE)
      .select("*", { count: "exact", head: true })
      .eq("ai_error_run_id", run.run_id)
      .or(`run_id.is.null,run_id.neq.${run.run_id}`),
  ])
  return {
    run: { ...run, alive: isRunAlive(run, Date.now()) },
    done: doneRes.count ?? 0,
    failed: failedRes.count ?? 0,
  }
}

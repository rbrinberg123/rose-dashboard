/**
 * PURE run policy for Client Health batches — no I/O, unit-tested in
 * lib/client-health-run-policy.test.ts. The I/O lives in client-health-runs.ts.
 */

/**
 * How long a lease / heartbeat keeps a run "alive". Longer than any single
 * batch can live (maxDuration 300s on the route), so an alive run is never
 * reclaimed out from under a working batch; short enough that a dead run is
 * picked up within minutes.
 */
export const LEASE_MS = 6 * 60 * 1000

/** A cron start is a no-op when a run started within this window ("done this week"). */
export const CRON_SKIP_IF_STARTED_WITHIN_MS = 3 * 24 * 60 * 60 * 1000

export type HealthRun = {
  run_id: string
  trigger: "cron" | "manual"
  status: "running" | "finished"
  total: number
  started_by: string | null
  started_at: string
  heartbeat_at: string
  lease_until: string | null
  finished_at: string | null
}

/**
 * A running run is ALIVE while someone holds an unexpired lease, or it handed
 * off within LEASE_MS (heartbeat fresh, lease momentarily null). Otherwise it is
 * STALE — its batch died — and may be reclaimed.
 */
export function isRunAlive(
  run: Pick<HealthRun, "status" | "lease_until" | "heartbeat_at">,
  nowMs: number,
): boolean {
  if (run.status !== "running") return false
  if (run.lease_until && new Date(run.lease_until).getTime() > nowMs) return true
  return nowMs - new Date(run.heartbeat_at).getTime() < LEASE_MS
}

export type StartDecision =
  | { kind: "already_running" }
  | { kind: "reclaim" }
  | { kind: "up_to_date" }
  | { kind: "create" }

/**
 * What a START request should do.
 *   - a live run exists        → already_running (never a second concurrent run)
 *   - a stale run exists       → reclaim it and resume
 *   - cron, and a run started
 *     within the skip window   → up_to_date (the watchdog fires are no-ops)
 *   - otherwise                → create a new run
 * A MANUAL start always creates a fresh full run when nothing is running.
 */
export function decideStart(
  running: Pick<HealthRun, "status" | "lease_until" | "heartbeat_at"> | null,
  latest: Pick<HealthRun, "started_at"> | null,
  trigger: "cron" | "manual",
  nowMs: number,
): StartDecision {
  if (running) return isRunAlive(running, nowMs) ? { kind: "already_running" } : { kind: "reclaim" }
  if (
    trigger === "cron" &&
    latest &&
    nowMs - new Date(latest.started_at).getTime() < CRON_SKIP_IF_STARTED_WITHIN_MS
  ) {
    return { kind: "up_to_date" }
  }
  return { kind: "create" }
}

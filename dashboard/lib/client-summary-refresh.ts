/**
 * PURE driver logic for the batched "Refresh all AI summaries" run — no I/O, no
 * React, so the loop's stopping conditions are unit-testable.
 *
 * It generates NOTHING. It only decides what URL to call next and how to fold a
 * batch response into on-screen progress; the generation, pacing, backoff and
 * resumability all live in /api/client-summary/refresh-all (which in turn calls
 * the one generator in lib/client-summary.ts). This mirrors what
 * scripts/refresh-summaries.mjs does from the command line — same route, same
 * params, same stopping rules — so the button and the script can't drift.
 */

/** Clients per request. Short enough that no single call risks a timeout. */
export const DEFAULT_BATCH_SIZE = 15

/** The fields the batch route returns that the driver actually reads. */
export type RefreshBatchResponse = {
  active?: number
  succeeded?: number
  failed?: number
  remaining?: number
  failures?: { account_id: string; error: string }[]
}

export type RefreshProgress = {
  /** Total active clients, as reported by the route (0 until the first pass). */
  total: number
  /** Successfully regenerated so far. */
  done: number
  /** Failed so far (a failed client keeps its old summary and is retried). */
  failed: number
  /** Still to do after the last pass. -1 means "not started yet". */
  remaining: number
  /** How many batch requests have completed. */
  passes: number
  failures: { account_id: string; error: string }[]
}

export function initialProgress(): RefreshProgress {
  return { total: 0, done: 0, failed: 0, remaining: -1, passes: 0, failures: [] }
}

/**
 * Build the URL for the next batch. `before` is the campaign timestamp, held
 * FIXED for the whole run: the route only regenerates clients whose summary
 * predates it, so each pass naturally skips what earlier passes completed.
 */
export function buildBatchUrl(before: string, limit = DEFAULT_BATCH_SIZE): string {
  const params = new URLSearchParams({
    force: "1",
    before,
    limit: String(limit),
  })
  return `/api/client-summary/refresh-all?${params.toString()}`
}

/** Fold one batch response into the running totals. */
export function applyBatch(
  prev: RefreshProgress,
  body: RefreshBatchResponse,
): RefreshProgress {
  return {
    total: body.active ?? prev.total,
    done: prev.done + (body.succeeded ?? 0),
    failed: prev.failed + (body.failed ?? 0),
    remaining: body.remaining ?? 0,
    passes: prev.passes + 1,
    failures: [...prev.failures, ...(body.failures ?? [])],
  }
}

/** Has the campaign finished? (`remaining === 0` after at least one pass.) */
export function isComplete(p: RefreshProgress): boolean {
  return p.passes > 0 && p.remaining <= 0
}

/**
 * Should the loop fire another request?
 *
 * Stops when nothing is left, and ALSO when a pass regenerated nobody while
 * work remains — that means every client in the batch failed (bad API key,
 * exhausted quota), so continuing would spin forever re-failing. The run stops
 * and reports instead; re-clicking resumes, because the successful clients now
 * carry newer timestamps and drop out of the `before` window.
 */
export function shouldContinue(
  progress: RefreshProgress,
  lastBatch: RefreshBatchResponse,
): boolean {
  if (isComplete(progress)) return false
  if ((lastBatch.succeeded ?? 0) === 0) return false
  return true
}

/** The one-line status shown under the button. */
export function describeProgress(p: RefreshProgress): string {
  if (p.passes === 0) return "Starting…"
  const total = p.total || p.done + Math.max(0, p.remaining)
  return `Regenerating… ${p.done} of ${total} (${p.failed} failed)`
}

/** The end-of-run line. */
export function describeResult(p: RefreshProgress): string {
  const plural = p.done === 1 ? "summary" : "summaries"
  if (p.failed === 0) return `Done — ${p.done} ${plural} regenerated.`
  return `Finished with errors — ${p.done} ${plural} regenerated, ${p.failed} failed. Run it again to retry just those.`
}

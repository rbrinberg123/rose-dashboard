/**
 * SHARED throttling for every batch of paid Anthropic calls — the AI client
 * summary (/api/client-summary/refresh-all) and Client Health
 * (/api/client-health/refresh). Factored out of the summary route so both
 * features pace, retry and back off identically. Change a limit HERE.
 *
 * Pure apart from the timer: `sleep` and `random` are injectable so the backoff
 * and chunking rules are unit-testable (lib/ai-batch.test.ts).
 */

export const AI_BATCH_CONFIG = {
  /** Clients per Client Health invocation (one self-chained batch). Small
   *  enough that a batch always finishes well inside maxDuration. */
  BATCH_SIZE: 10,
  /** Paid calls in flight at once. 2 + the gap below holds a low Anthropic
   *  tier (~50 req/min) at roughly 25 req/min. */
  MAX_CONCURRENCY: 2,
  /** Pause between concurrency groups inside a batch (rate pacing). */
  DELAY_MS_BETWEEN_CHUNKS: 2_000,
  /** Pause before a chained Client Health batch starts its first call. */
  DELAY_MS_BETWEEN_BATCHES: 5_000,
  /** Retries per client on a transient upstream failure (429/529/5xx/timeout). */
  MAX_RETRIES: 3,
  /** Backoff base: retry n waits ~BASE × 3^n (5s, 15s, 45s) with jitter. */
  BACKOFF_BASE_MS: 5_000,
} as const

/** Upstream statuses worth retrying. 408 also stands for a client-side timeout. */
export const RETRYABLE_UPSTREAM: ReadonlySet<number> = new Set([408, 409, 429, 500, 502, 503, 529])

export function isRetryableUpstream(status: number | undefined): boolean {
  return status !== undefined && RETRYABLE_UPSTREAM.has(status)
}

/**
 * Exponential backoff with "equal jitter": half the step is fixed, half random,
 * so parallel clients that hit a 429 together do not retry in lockstep.
 */
export function backoffDelayMs(
  attempt: number,
  baseMs: number = AI_BATCH_CONFIG.BACKOFF_BASE_MS,
  random: () => number = Math.random,
): number {
  const step = baseMs * 3 ** attempt
  return Math.round(step / 2 + random() * (step / 2))
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Run `fn`, retrying up to `maxRetries` times while `upstreamStatusOf(err)` is
 * retryable. Anything else (or the last failure) is rethrown immediately.
 * Safe because every caller writes to the database only AFTER a successful
 * generation — a retried call never half-writes.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: {
    label: string
    upstreamStatusOf: (err: unknown) => number | undefined
    maxRetries?: number
    sleepFn?: (ms: number) => Promise<void>
    random?: () => number
  },
): Promise<T> {
  const maxRetries = opts.maxRetries ?? AI_BATCH_CONFIG.MAX_RETRIES
  const wait = opts.sleepFn ?? sleep
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const upstream = opts.upstreamStatusOf(err)
      if (attempt >= maxRetries || !isRetryableUpstream(upstream)) throw err
      const ms = backoffDelayMs(attempt, AI_BATCH_CONFIG.BACKOFF_BASE_MS, opts.random)
      console.warn(`[ai-batch] ${opts.label}: upstream ${upstream} — backing off ${ms}ms (retry ${attempt + 1}/${maxRetries})`)
      await wait(ms)
    }
  }
}

/**
 * Process `ids` in groups of `concurrency`, pausing `delayMs` between groups.
 * One item failing never stops the rest (allSettled). `onGroupDone` runs after
 * every group (progress logs, heartbeats); `shouldStop` is checked before each
 * group (time budgets).
 */
export async function runThrottled<T>(
  ids: readonly string[],
  worker: (id: string) => Promise<T>,
  opts: {
    concurrency?: number
    delayMs?: number
    onGroupDone?: (results: { id: string; result: PromiseSettledResult<T> }[]) => void | Promise<void>
    shouldStop?: () => boolean
    sleepFn?: (ms: number) => Promise<void>
  } = {},
): Promise<{ id: string; result: PromiseSettledResult<T> }[]> {
  const concurrency = opts.concurrency ?? AI_BATCH_CONFIG.MAX_CONCURRENCY
  const delayMs = opts.delayMs ?? AI_BATCH_CONFIG.DELAY_MS_BETWEEN_CHUNKS
  const wait = opts.sleepFn ?? sleep
  const all: { id: string; result: PromiseSettledResult<T> }[] = []
  for (let i = 0; i < ids.length; i += concurrency) {
    if (opts.shouldStop?.()) break
    const group = ids.slice(i, i + concurrency)
    const settled = await Promise.allSettled(group.map((id) => worker(id)))
    const results = settled.map((result, j) => ({ id: group[j], result }))
    all.push(...results)
    await opts.onGroupDone?.(results)
    if (i + concurrency < ids.length) await wait(delayMs)
  }
  return all
}

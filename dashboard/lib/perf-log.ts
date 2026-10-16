/**
 * Server-side step timer for diagnosing slow page loads.
 *
 * OFF unless the server is started with PERF_LOG=1 (see .claude/launch.json
 * for the local dev server). When on, each call to `step()` logs one line:
 *
 *   [perf] /accounts  views+columns 241ms  (total 512ms)
 *
 * Logs step names and timings only — never row data, ids or user details.
 * Safe to leave in place: with the flag unset every call is a no-op.
 */

const ENABLED = process.env.PERF_LOG === "1"

export type PerfTimer = { step: (label: string) => void }

const NOOP: PerfTimer = { step: () => {} }

export function perfTimer(scope: string): PerfTimer {
  if (!ENABLED) return NOOP
  const t0 = performance.now()
  let last = t0
  return {
    step(label: string) {
      const now = performance.now()
      console.log(
        `[perf] ${scope.padEnd(14)} ${label.padEnd(18)} ${Math.round(now - last)}ms  (total ${Math.round(now - t0)}ms)`,
      )
      last = now
    },
  }
}

/* ---------------------------------------------------- production slow log */
// ALWAYS ON, but silent unless something is slow (2026-10-16): wraps a promise,
// and only when it takes PERF_SLOW_MS or longer (default 1500) writes one
// `[slow]` line to the server log (Vercel function logs in production):
//
//   [slow] event:drawer record 9123ms cold=false region=iad1
//
// OBSERVE ONLY: returns / throws exactly what the wrapped promise does. Logs
// scope + label names, timing, the cold flag and the region — never data, ids
// or user details. `cold` is true for the first timed call in this server
// instance (a fresh function start).

const parsedSlowMs = Number(process.env.PERF_SLOW_MS)
export const SLOW_MS = Number.isFinite(parsedSlowMs) && parsedSlowMs > 0 ? parsedSlowMs : 1500

let coldStart = true

export async function timed<T>(scope: string, label: string, p: Promise<T>): Promise<T> {
  const t0 = performance.now()
  const cold = coldStart
  coldStart = false
  try {
    return await p
  } finally {
    const ms = Math.round(performance.now() - t0)
    if (ms >= SLOW_MS) {
      console.warn(`[slow] ${scope} ${label} ${ms}ms cold=${cold} region=${process.env.VERCEL_REGION ?? "?"}`)
    }
  }
}

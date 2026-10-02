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

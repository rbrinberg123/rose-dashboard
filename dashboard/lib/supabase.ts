import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { SLOW_MS } from "@/lib/perf-log"

/**
 * Server-only Supabase client factory.
 *
 * Uses the service_role key, which bypasses RLS. Must NEVER be imported into a
 * Client Component. The dashboard is internal-only with no auth in v1, so all
 * reads and writes go through this client from Server Components and Server
 * Actions.
 *
 * Throws at first call if env vars are missing — preferable to silent NULLs.
 */

let cached: SupabaseClient | null = null

export function getSupabaseServer(): SupabaseClient {
  if (cached) return cached

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local (see .env.example).",
    )
  }

  cached = createClient(url, key, {
    auth: {
      // No user sessions; server-only with service_role.
      persistSession: false,
      autoRefreshToken: false,
    },
    global: { fetch: timedFetch },
  })

  return cached
}

/**
 * OBSERVE-ONLY fetch for the client above (2026-10-16): passes input/init
 * through unchanged and returns the real response / throws the real error. It
 * writes one `[slow-db]` line only when a call is slow (PERF_SLOW_MS), failed
 * at the network, got a 5xx, or is one of supabase-js's silent automatic
 * retries (X-Retry-Count) — the hidden 1s/2s/4s back-off. Logs the method,
 * table/path (no query string), status, timing and retry count — never data.
 */
const timedFetch: typeof fetch = async (input, init) => {
  const t0 = performance.now()
  try {
    const res = await fetch(input, init)
    logDbCall(input, init, res.status, t0)
    return res
  } catch (e) {
    logDbCall(input, init, "NETWORK", t0, e)
    throw e
  }
}

function logDbCall(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  status: number | "NETWORK",
  t0: number,
  err?: unknown,
): void {
  try {
    const ms = Math.round(performance.now() - t0)
    const retry = new Headers(init?.headers).get("X-Retry-Count") ?? "0"
    const failed = status === "NETWORK" || status >= 500
    if (ms < SLOW_MS && retry === "0" && !failed) return
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const path = new URL(href).pathname.replace(/^\/rest\/v1\//, "")
    const why = err instanceof Error ? ` ${err.name}` : ""
    console.warn(`[slow-db] ${init?.method ?? "GET"} ${path} ${status} ${ms}ms retry=${retry}${why}`)
  } catch {
    // Instrumentation must never affect the request.
  }
}

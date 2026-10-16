/**
 * Single-flight wrapper for Supabase Auth TOKEN REFRESH calls (2026-10-16).
 *
 * Why: every request builds a fresh @supabase/ssr client, and a client only
 * de-duplicates refreshes against itself. When the access token nears expiry,
 * N parallel requests from one browser (a page plus its link prefetches) each
 * POST /auth/v1/token?grant_type=refresh_token with the SAME refresh token.
 * Supabase rate-limits that endpoint per IP (all our traffic leaves Vercel from
 * shared IPs), so a burst of ~30+ gets 429s — and on a 429 auth-js deletes the
 * session cookies, which signs the user out.
 *
 * What: pass this as `global.fetch` to createServerClient. Non-refresh calls go
 * straight through untouched. Refresh calls carrying the same body (i.e. the
 * same refresh token) share ONE network call on this server instance; each
 * caller gets its own copy of the response, so auth-js behaves exactly as if it
 * had made the call itself.
 *
 * Security: the key is the refresh token itself (a secret), so only a caller
 * that already holds that refresh token can receive its result — the same
 * session it would have got by calling Supabase. A SUCCESSFUL result is reused
 * for REUSE_MS after it lands, mirroring Supabase Auth's own refresh-token
 * reuse interval (default 10 s), so stragglers holding the just-rotated token
 * get the new session instead of firing another call. Failures are never
 * reused. Nothing here decides who is signed in: the token that comes back is
 * still verified by getClaims() as before.
 */

const REUSE_MS = 10_000

type CapturedResponse = {
  status: number
  statusText: string
  headers: [string, string][]
  body: string
}

const inFlight = new Map<string, Promise<CapturedResponse>>()

function isRefreshCall(input: RequestInfo | URL, init?: RequestInit): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  return url.includes("/token?grant_type=refresh_token") && (init?.method ?? "GET").toUpperCase() === "POST"
}

export const singleFlightRefreshFetch: typeof fetch = async (input, init) => {
  if (!isRefreshCall(input, init) || typeof init?.body !== "string") return fetch(input, init)

  const key = init.body
  let pending = inFlight.get(key)
  if (!pending) {
    pending = fetch(input, init).then(async (res) => ({
      status: res.status,
      statusText: res.statusText,
      // The body is re-served already decoded, so drop the encoding/length headers.
      headers: [...res.headers.entries()].filter(
        ([name]) => name !== "content-encoding" && name !== "content-length",
      ),
      body: await res.text(),
    }))
    inFlight.set(key, pending)
    pending.then(
      (r) => {
        if (r.status >= 200 && r.status < 300) {
          setTimeout(() => inFlight.delete(key), REUSE_MS).unref?.()
        } else {
          inFlight.delete(key)
        }
      },
      () => inFlight.delete(key),
    )
  }

  const r = await pending
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers })
}

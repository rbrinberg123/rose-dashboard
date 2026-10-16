import { NextResponse, type NextRequest } from "next/server"
import { combineChunks, createServerClient, stringFromBase64URL } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import { singleFlightRefreshFetch } from "@/lib/supabase/refresh-single-flight"

/**
 * Supabase auth client for Next.js's proxy.ts (formerly middleware.ts in
 * <16). The proxy is the single place where token refreshes can be
 * persisted across requests, so this factory MUST be called on every
 * protected request — otherwise sessions silently expire.
 *
 * Returns a `{ supabase, response }` pair. The response is a fresh
 * NextResponse.next() the caller should mutate (and return) so any
 * Set-Cookie headers from a token refresh make it back to the browser.
 */
export function getSupabaseProxy(request: NextRequest): {
  supabase: SupabaseClient
  response: NextResponse
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Set them in .env.local (see .env.example).",
    )
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, key, {
    // Parallel requests needing a token refresh share one call (see file).
    global: { fetch: singleFlightRefreshFetch },
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        // First mutate the request cookie jar so downstream handlers see
        // the refreshed values, then rebuild the response so the new
        // Set-Cookie headers are emitted to the browser.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  return { supabase, response }
}

/**
 * The access token stored in this request's Supabase session cookie, read
 * WITHOUT any network call and WITHOUT refreshing (2026-10-16). Used by
 * proxy.ts for link prefetches only: it passes the token to getClaims(token),
 * which still verifies the signature and expiry but never triggers a refresh.
 * Mirrors @supabase/ssr's own cookie storage (default key, chunking, "base64-"
 * prefix) using its exported helpers. Returns null on any doubt; the caller
 * then falls back to the normal getClaims() path.
 */
export async function readSessionAccessToken(request: NextRequest): Promise<string | null> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!url) return null
    const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`
    const raw = await combineChunks(storageKey, (name) => request.cookies.get(name)?.value)
    if (!raw) return null
    const json = raw.startsWith("base64-") ? stringFromBase64URL(raw.slice("base64-".length)) : raw
    const token = (JSON.parse(json) as { access_token?: unknown }).access_token
    return typeof token === "string" && token ? token : null
  } catch {
    return null
  }
}

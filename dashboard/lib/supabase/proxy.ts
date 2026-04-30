import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

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

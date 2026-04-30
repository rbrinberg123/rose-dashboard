"use client"

import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Browser-side Supabase client for the auth flow (signInWithOtp, signOut,
 * onAuthStateChange).
 *
 * Uses the `anon` key, which is safe to ship to the browser. Auth tokens
 * for the signed-in user are stored in cookies (read by middleware/RSC) by
 * @supabase/ssr's helpers.
 *
 * NEVER use this client to read business data — that goes through the
 * service-role client in lib/supabase.ts. RLS isn't configured on the data
 * tables yet, so a browser-side anon client could leak data.
 */

let cached: SupabaseClient | null = null

export function getSupabaseBrowser(): SupabaseClient {
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Set them in .env.local (see .env.example).",
    )
  }

  cached = createBrowserClient(url, key)
  return cached
}

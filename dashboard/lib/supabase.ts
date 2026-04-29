import { createClient, type SupabaseClient } from "@supabase/supabase-js"

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
  })

  return cached
}

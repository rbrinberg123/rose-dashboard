import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Server-side Supabase auth client for Server Components, Server Actions,
 * and Route Handlers.
 *
 * Uses the `anon` key (auth-flow only — never read business data with it).
 * Cookie reads/writes go through Next.js's request `cookies()` API. In
 * Server Components, `setAll` is a no-op because cookies cannot be
 * mutated during render — the proxy/middleware handles token refreshes.
 *
 * Per @supabase/ssr docs: a new client is created on every call (no
 * caching), because each request has its own cookie store.
 */
export async function getSupabaseServerAuth(): Promise<SupabaseClient> {
  const cookieStore = await cookies()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Set them in .env.local (see .env.example).",
    )
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        // In Server Components this throws (cookies are read-only during
        // render); we swallow because the proxy handles session refresh.
        // In Server Actions / Route Handlers it succeeds.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // No-op in RSC render path.
        }
      },
    },
  })
}

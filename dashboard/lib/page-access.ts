import { getSupabaseServer } from "@/lib/supabase"
import { PAGE_REGISTRY } from "@/lib/page-registry"
import type { Role } from "@/lib/access-control"

/**
 * Load the routes a role is allowed to reach, from public.role_page_access
 * (the Admin → Roles matrix). Returns only routes with an `allowed = true`
 * row, ORDERED by PAGE_REGISTRY so the first entry is a natural landing page.
 *
 * Call this ONCE per request and hand the result to canAccessRoute() — the nav
 * checks many routes against the same set, so this is one small query, not one
 * per link.
 *
 * No next/headers import, so proxy.ts can call it directly. It FAILS CLOSED:
 * any error (including the table not existing yet) returns [] — a missing
 * matrix denies access rather than leaking it. super_user is never gated by
 * the matrix (see the canAccessRoute backstop), so this short-circuits to []
 * for supers and skips the query.
 */
export async function getAllowedRoutes(role: Role | null): Promise<string[]> {
  if (!role || role === "super_user") return []
  try {
    const sb = getSupabaseServer()
    const { data, error } = await sb
      .from("role_page_access")
      .select("route")
      .eq("role", role)
      .eq("allowed", true)
    if (error || !data) return []
    const granted = new Set((data as { route: string }[]).map((r) => r.route))
    // Order by the registry so allowed[0] is a sensible page to land on, and
    // drop any stale route no longer in the registry.
    return PAGE_REGISTRY.filter((p) => granted.has(p.route)).map((p) => p.route)
  } catch {
    return []
  }
}

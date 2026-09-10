import { cache } from "react"

import { getSupabaseServer } from "@/lib/supabase"
import { isViewAsRole, type Role } from "@/lib/access-control"

/**
 * The role read itself, memoised for the lifetime of ONE request.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 * A single page load used to run this exact one-row query SEVEN times (~120 ms
 * each): once in proxy.ts, once in the root layout, and up to five more inside
 * getEffectiveIdentity → lookupPerson → getUserScopes → canSeeFinancials. They
 * all ask the same question about the same person, so they now share one answer.
 *
 * ── SECURITY: THIS CACHE IS PER-REQUEST, NEVER PROCESS-WIDE ────────────────
 * React's `cache()` stores its memo on the per-request cache dispatcher that
 * Next.js installs around each RSC render. A new request gets a new dispatcher
 * and therefore a COLD cache, so one user's role can never be served to
 * another. Do NOT "optimise" this into a module-level Map/global keyed by
 * email — that would outlive the request and leak permissions across users.
 * The same rule applies to every identity-, role- or scope-derived value
 * (see getUserScopes, lookupPerson, loadIdentity).
 *
 * Outside an RSC render — proxy.ts, which has no React dispatcher — React's
 * `cache()` simply calls straight through, so the proxy still does its own
 * fresh lookup and nothing is shared with it either.
 *
 * The cache key is the NORMALISED (lower-cased) email, so callers passing
 * different casings still share the one lookup instead of missing the memo.
 */
const loadRoleForEmail = cache(async (emailLower: string): Promise<Role | null> => {
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("user_role_grants")
    .select("role")
    // Grants are keyed by lower-cased email.
    .eq("email", emailLower)
    .maybeSingle()

  if (error || !data) return null
  return isViewAsRole(data.role) ? data.role : null
})

/**
 * Look up a signed-in user's REAL role from `user_role_grants` (the live source
 * since go-live — the Admin → Users & Roles grid writes it). This is their
 * actual role, never the impersonated "View as" role, so the app authorizes
 * impersonation (and the exit action) against it and it can never be spoofed by
 * a cookie. See resolveEffective() in lib/impersonation.ts for the
 * impersonation-aware role used to gate the nav and routes.
 *
 * The older `user_roles` table is left in place as a backup but is NO LONGER
 * read — migrate rows into `user_role_grants` first (see the go-live SQL in
 * docs/01-access-and-users.md), or nobody (not even a super-user) will have a
 * role.
 *
 * SERVER-ONLY: uses the service_role client (bypasses RLS — the table has
 * RLS on with no policies, so this is the only way to read it). Never import
 * this into a Client Component; the role for the nav is passed down from the
 * server layout instead.
 *
 * Returns one of the four roles, or null when the email is absent, has no grant
 * row, or holds an unexpected value — all of which mean "no access" under the
 * deny-by-default model.
 */
export async function getRealRole(
  email: string | null | undefined,
): Promise<Role | null> {
  if (!email) return null
  return loadRoleForEmail(email.toLowerCase())
}

/**
 * Back-compat alias. Existing callers (api-auth.ts) import `getUserRole`; it is
 * the same real-role DB lookup as getRealRole(). New code should prefer
 * getRealRole for clarity about which role it is reading.
 */
export const getUserRole = getRealRole

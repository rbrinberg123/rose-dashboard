import { cache } from "react"
import { cookies } from "next/headers"

import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { getRealRole } from "@/lib/user-role"
import { VIEW_AS_COOKIE, VIEW_AS_USER_COOKIE, effectiveAccessEmail, type Role, type ViewAsRole } from "@/lib/access-control"
import { lookupPerson, resolveEffective } from "@/lib/impersonation"
import { getAllowedRoutes, getCrmLevels } from "@/lib/page-access"
import type { CrmLevel, CrmLevelRoute } from "@/lib/access/crm-levels-policy"

/**
 * Request-context wrappers around the core resolver (lib/impersonation.ts) for
 * Server Components / Server Actions, which read cookies via `next/headers`.
 * (The proxy can't use next/headers, so it calls resolveEffective directly with
 * the NextRequest cookies — see proxy.ts.)
 *
 * These two are the public identity/role API the rest of the app builds on:
 *   - getEffectiveRole()     — the role the nav + routes gate on.
 *   - getEffectiveIdentity() — the effective PERSON (impersonated or real). This
 *     is the SINGLE SOURCE the future row-scoping resolvers (accessibleClientIds,
 *     hostedMeetingIds, feedbackAssignments) will consume, so person-scoping
 *     lights up automatically once those land — no scoping changes here.
 */

/**
 * Verify the JWT with Supabase Auth and read the caller's real role.
 *
 * Memoised for ONE request. `auth.getUser()` is a network call to Supabase Auth
 * (~180 ms — more expensive than a database query), and pages that ask for both
 * the role and the identity (e.g. /meetings calls getEffectiveRole then
 * getEffectiveIdentity) used to pay for it twice.
 *
 * ── SECURITY: PER-REQUEST ONLY ─────────────────────────────────────────────
 * This is the authenticity check itself — it establishes WHO is calling. React's
 * `cache()` is scoped to a single request's dispatcher, so the verified user is
 * never carried into another request. Never make this a module-level cache: it
 * would authenticate every visitor as whoever loaded a page first. The JWT's
 * signature is still VERIFIED once per request, not trusted from a cookie —
 * via getClaims(), which checks it locally against the project's cached ES256
 * public key instead of a ~250ms round trip to Supabase Auth (getUser()). Same
 * trade-off as proxy.ts: Auth-server revocation lags until token expiry (≤1h);
 * the role below is still read fresh every request. See lib/user-role.ts.
 */
const readRealIdentity = cache(
  async (): Promise<{ email: string | null; role: Role | null }> => {
    const supabase = await getSupabaseServerAuth()
    const { data } = await supabase.auth.getClaims()
    const email = (data?.claims?.email as string | undefined) ?? null
    return { email, role: await getRealRole(email) }
  },
)

async function readViewCookies(): Promise<{ user?: string; role?: string }> {
  const c = await cookies()
  return {
    user: c.get(VIEW_AS_USER_COOKIE)?.value,
    role: c.get(VIEW_AS_COOKIE)?.value,
  }
}

/** The effective role the app should gate on (impersonation-aware). */
export async function getEffectiveRole(): Promise<ViewAsRole | null> {
  const { role: realRole } = await readRealIdentity()
  const cookieVals = await readViewCookies()
  const { effectiveRole } = await resolveEffective(realRole, cookieVals.user, cookieVals.role)
  return effectiveRole
}

/**
 * The effective ALLOWED ROUTES for page callers — role pages ∪ per-user grants,
 * for the same effective person/role getEffectiveRole() gates on (PERSON View
 * as → that person's grants; ROLE View as → role pages only). Hand the result
 * to canAccessRoute with getEffectiveRole(). See lib/page-access.ts.
 */
export async function getEffectiveAllowedRoutes(): Promise<string[]> {
  const { email, role: realRole } = await readRealIdentity()
  const cookieVals = await readViewCookies()
  const resolution = await resolveEffective(realRole, cookieVals.user, cookieVals.role)
  return getAllowedRoutes(resolution.effectiveRole, effectiveAccessEmail(email, resolution))
}

/**
 * The effective CRM ACCESS LEVELS (2026-10-16) for the four level-gated CRM
 * tables, for the same effective person/role as getEffectiveAllowedRoutes —
 * PERSON View as → that person's role ∪ grants; ROLE View as → role only.
 * Memoised per request (several actions/pages ask). See lib/page-access.ts
 * getCrmLevels and lib/access/crm-levels-policy.ts.
 */
export const getEffectiveCrmLevels = cache(async (): Promise<Record<CrmLevelRoute, CrmLevel>> => {
  const { email, role: realRole } = await readRealIdentity()
  const cookieVals = await readViewCookies()
  const resolution = await resolveEffective(realRole, cookieVals.user, cookieVals.role)
  return getCrmLevels(resolution.effectiveRole, effectiveAccessEmail(email, resolution))
})

export type EffectiveIdentity = {
  email: string | null
  /** Dynamics system-user id — the join key for future row-scoping. */
  userId: string | null
  name: string | null
  role: Role | null
  /** True when a super-user is currently viewing the app AS this person. */
  impersonated: boolean
}

/**
 * The effective identity: the impersonated person when PERSON mode is active
 * for a real super-user, otherwise the real signed-in user (resolved through
 * the same `users`-mirror lookup so `userId`/`name` are always populated).
 */
export async function getEffectiveIdentity(): Promise<EffectiveIdentity> {
  const { email: realEmail, role: realRole } = await readRealIdentity()
  const cookieVals = await readViewCookies()
  const { person } = await resolveEffective(realRole, cookieVals.user, cookieVals.role)

  if (person) {
    return { ...person, impersonated: true }
  }

  // Not impersonating a person → real identity (still resolved through the
  // mirror so future resolvers get a userId for the real user too).
  const self = realEmail ? await lookupPerson(realEmail) : null
  return {
    email: realEmail,
    userId: self?.userId ?? null,
    name: self?.name ?? realEmail,
    role: realRole,
    impersonated: false,
  }
}

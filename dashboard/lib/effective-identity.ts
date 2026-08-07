import { cookies } from "next/headers"

import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { getRealRole } from "@/lib/user-role"
import { VIEW_AS_COOKIE, VIEW_AS_USER_COOKIE, type Role, type ViewAsRole } from "@/lib/access-control"
import { lookupPerson, resolveEffective } from "@/lib/impersonation"

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

async function readRealIdentity(): Promise<{ email: string | null; role: Role | null }> {
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const email = user?.email ?? null
  return { email, role: await getRealRole(email) }
}

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

import { getSupabaseServer } from "@/lib/supabase"
import { getRealRole } from "@/lib/user-role"
import {
  isViewAsRole,
  type Role,
  type ViewAsRole,
} from "@/lib/access-control"

/**
 * CORE impersonation resolver — shared by the proxy, the root layout, and the
 * request-context wrappers in lib/effective-identity.ts.
 *
 * IMPORTANT: this module does NOT import `next/headers`, so it is safe to pull
 * into proxy.ts (which reads cookies off the NextRequest instead). Each caller
 * passes the two cookie VALUES; this module supplies the resolution logic + the
 * DB lookups an impersonated PERSON requires.
 *
 * Two impersonation modes, both super-user-only:
 *   - PERSON  (`view_as_user` = an @roseandco.com email) — takes precedence;
 *     you see the app as that exact person, with THEIR real role.
 *   - ROLE    (`view_as` = a role) — the abstract role preview.
 * Neither is honored unless the caller's REAL role is 'super_user'.
 */

const DOMAIN = "@roseandco.com"

/** A resolved impersonated (or real) person — the single identity source that
 *  future row-scoping resolvers (accessibleClientIds, hostedMeetingIds,
 *  feedbackAssignments) will consume. */
export type PersonView = {
  email: string
  /** Dynamics system-user id from the `users` mirror (null if absent). */
  userId: string | null
  name: string
  /** The person's LIVE role (from user_roles) — often null. */
  role: Role | null
}

/**
 * Look up a person in the `users` mirror plus their LIVE role. Returns null
 * when no active mirror row matches (so a stale/bogus cookie is safely
 * ignored). Case-insensitive email match.
 */
export async function lookupPerson(email: string): Promise<PersonView | null> {
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("users")
    .select("user_id, display_name, email")
    .ilike("email", email)
    .limit(1)
  if (error || !data || data.length === 0) return null
  const row = data[0] as { user_id: string | null; display_name: string | null; email: string | null }
  if (!row.email) return null
  const role = await getRealRole(row.email)
  return {
    email: row.email,
    userId: row.user_id ?? null,
    name: row.display_name?.trim() || row.email,
    role,
  }
}

export type EffectiveResolution = {
  /** Role the app should gate on (nav + routes). Null → no-access experience. */
  effectiveRole: ViewAsRole | null
  /** Set when PERSON impersonation is active. */
  person: PersonView | null
  /** Set when ROLE impersonation is active. */
  roleView: ViewAsRole | null
}

/**
 * Resolve the effective role + impersonation state from the real identity and
 * the two cookie values. Person impersonation wins over role impersonation;
 * both require a real super_user.
 */
export async function resolveEffective(
  realRole: Role | null,
  viewAsUserRaw: string | null | undefined,
  viewAsRoleRaw: string | null | undefined,
): Promise<EffectiveResolution> {
  // Only a REAL super-user may impersonate — everyone else gets their own role,
  // and any stray cookie is ignored.
  if (realRole !== "super_user") {
    return { effectiveRole: realRole, person: null, roleView: null }
  }

  // PERSON mode (precedence): view the app as a specific @roseandco.com user.
  const personEmail = viewAsUserRaw?.trim().toLowerCase()
  if (personEmail && personEmail.endsWith(DOMAIN)) {
    const person = await lookupPerson(personEmail)
    // person.role may be null → effectiveRole null → the valid "no access" test.
    if (person) return { effectiveRole: person.role, person, roleView: null }
  }

  // ROLE mode: abstract role preview.
  if (isViewAsRole(viewAsRoleRaw)) {
    return { effectiveRole: viewAsRoleRaw, person: null, roleView: viewAsRoleRaw }
  }

  // Not impersonating → real role.
  return { effectiveRole: realRole, person: null, roleView: null }
}

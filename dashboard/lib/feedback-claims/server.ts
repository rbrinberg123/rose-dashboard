import { getEffectiveIdentity } from "@/lib/effective-identity"
import { getUserScopes } from "@/lib/access/data-scope"
import { loadIdentity } from "@/lib/access/identity"
import { viewerUserIds } from "@/app/clients/alerts/load"
import type { ClaimActor } from "./policy"

/**
 * Server-side identity for Feedback claiming. Two flavours:
 *
 *   loadClaimViewer() — for RENDERING. Effective identity, so "View as" shows
 *                       exactly which buttons that person would get.
 *   resolveClaimActor() — for WRITING. Refuses while in "View as" (a super-user
 *                       previewing someone must not act under the preview),
 *                       and requires the person to resolve to a CRM user so the
 *                       claim can be stamped with a real users.user_id.
 *
 * Both read the capability through getUserScopes (Super User → always on) and
 * the admin bit from the role — no data-scope bypass, no origin check: claim
 * actions are gated on the CAPABILITY, never on record origin.
 */

export type ClaimViewer = ClaimActor & {
  impersonated: boolean
  /** The id stamped as claimed_by / closed_by (one record of the person). */
  userId: string | null
  name: string | null
  email: string | null
}

export async function loadClaimViewer(): Promise<ClaimViewer> {
  const identity = await getEffectiveIdentity()
  const [scopes, viewer] = await Promise.all([
    getUserScopes(identity.email),
    viewerUserIds(identity.email),
  ])
  const myIds = new Set(viewer.ids)
  if (identity.userId) myIds.add(identity.userId)
  return {
    myIds,
    isAdmin: identity.role === "super_user",
    hasCapability: scopes.claimFeedback,
    impersonated: identity.impersonated,
    userId: identity.userId,
    name: identity.name,
    email: identity.email,
  }
}

export async function resolveClaimActor(): Promise<
  { ok: true; actor: ClaimViewer } | { ok: false; error: string }
> {
  const actor = await loadClaimViewer()
  if (actor.impersonated) return { ok: false, error: "Exit “View as” before changing a claim." }
  if (!actor.email) return { ok: false, error: "Not authorised." }
  if (!actor.userId) {
    return { ok: false, error: "Your sign-in isn't matched to a CRM user, so a claim can't be recorded." }
  }
  return { ok: true, actor }
}

/** Active, real people (no hashed / service rows) — the Reassign picker. */
export async function loadClaimRoster(): Promise<{ userId: string; name: string }[]> {
  const identity = await loadIdentity()
  if (!identity.ok) return []
  return identity.roster
    .filter((r) => !r.service)
    .map((r) => ({ userId: r.userId, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

import "server-only"

/**
 * Who reviews whom — the server-side reads of public.time_off_reviewers that
 * the approval gate, the Time Off drawer and the Alerts section all share, so
 * "is this person on that person's reviewing team?" is answered in one place.
 *
 * ── DUPLICATE CRM RECORDS ──────────────────────────────────────────────────
 * A few people carry two Dynamics user records (see lib/access/identity-index.ts).
 * The admin may map one id and the request may carry the other, so every check
 * here widens a person to ALL of their ids first — the same same-name union
 * the rest of the app's scoping uses.
 *
 * ── FAILS CLOSED ───────────────────────────────────────────────────────────
 * A read error yields "not a reviewer" / an empty team, never "everyone".
 */

import { getSupabaseServer } from "@/lib/supabase"
import { loadIdentity } from "@/lib/access/identity"

const uniq = (ids: (string | null | undefined)[]): string[] =>
  [...new Set(ids.filter((x): x is string => !!x))]

/** Every user_id belonging to the person signed in as `email` ([] when unknown). */
export async function idsForEmail(email: string | null | undefined): Promise<string[]> {
  if (!email) return []
  const identity = await loadIdentity()
  if (!identity.ok) return []
  const r = identity.resolve(email)
  return r.state === "resolved" ? r.userIds : []
}

/** Every user_id that is the same person as `userId` (always includes it). */
export async function idsForUser(userId: string): Promise<string[]> {
  const { data } = await getSupabaseServer()
    .from("users")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle()
  const email = (data as { email: string | null } | null)?.email
  return uniq([userId, ...(await idsForEmail(email))])
}

/** The reviewer user_ids on `personId`'s reviewing team (null on read error). */
export async function reviewerIdsFor(personId: string): Promise<string[] | null> {
  const personIds = await idsForUser(personId)
  const { data, error } = await getSupabaseServer()
    .from("time_off_reviewers")
    .select("reviewer_user_id")
    .in("person_user_id", personIds)
  if (error) return null
  return uniq(((data ?? []) as { reviewer_user_id: string }[]).map((r) => r.reviewer_user_id))
}

/** Reviewer display names for `personId`, by name (empty on error). */
export async function reviewerNamesFor(personId: string): Promise<string[]> {
  const ids = await reviewerIdsFor(personId)
  if (!ids || ids.length === 0) return []
  const { data } = await getSupabaseServer()
    .from("users")
    .select("user_id, display_name")
    .in("user_id", ids)
  const names = ((data ?? []) as { display_name: string | null }[]).map(
    (u) => u.display_name?.trim() || "(unknown)",
  )
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

/**
 * Is the person with ids `actorIds` on `personId`'s reviewing team RIGHT NOW?
 * Re-read on every call — a reviewer removed in admin loses the power at once.
 */
export async function isReviewerOf(actorIds: string[], personId: string): Promise<boolean> {
  if (actorIds.length === 0) return false
  const reviewers = await reviewerIdsFor(personId)
  if (!reviewers) return false
  const reviewerIds = new Set<string>()
  // Widen each reviewer too, so either of a duplicate person's records counts.
  for (const id of reviewers) for (const x of await idsForUser(id)) reviewerIds.add(x)
  return actorIds.some((id) => reviewerIds.has(id))
}

/**
 * Every requester user_id whose reviewing team includes the viewer — for the
 * Alerts section. `null` on a read error (the section shows an error strip).
 */
export async function personIdsReviewedBy(viewerIds: string[]): Promise<string[] | null> {
  if (viewerIds.length === 0) return []
  const { data, error } = await getSupabaseServer()
    .from("time_off_reviewers")
    .select("person_user_id")
    .in("reviewer_user_id", viewerIds)
  if (error) return null
  const people = uniq(((data ?? []) as { person_user_id: string }[]).map((r) => r.person_user_id))
  const out = new Set<string>()
  for (const p of people) for (const x of await idsForUser(p)) out.add(x)
  return [...out]
}

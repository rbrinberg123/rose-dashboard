import "server-only"

/**
 * WHO SEES WHICH TIME OFF REQUESTS on CRM → Time Off (/time-off-requests) —
 * the individual-requests list and its drawer. 2026-10-09.
 *
 *   visible = my own requests
 *           ∪ (super_user ? EVERY request : ∅)
 *           ∪ requests of every person whose reviewing team I am on
 *             (time_off_reviewers — the designated approver), ALL statuses
 *
 * Both sources (Dynamics history + dashboard requests) carry requested_by_id
 * in the same public.users id space, so one rule covers both.
 *
 * The page and loadTimeOffRecord read v_admin_time_off_all with the
 * service-role key (RLS bypassed), so THIS is the gate — applied to the query,
 * never by hiding rows in the browser.
 *
 * Uses the EFFECTIVE role + identity, so a super-user in "View as" sees exactly
 * what that person would. Same-name duplicate CRM records are one person
 * (idsForEmail / personIdsReviewedBy widen them).
 *
 * NOT the Logistics calendar (/time-off, lib/time-off/load.ts): that firm-wide
 * "who's out" view stays team-visible and does not use this.
 *
 * FAILS CLOSED: no role → nothing; an unmatched sign-in → nothing of anyone
 * else's; a reviewer-table read error → own requests only, with `error` set.
 */

import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { idsForEmail, idsForUser, personIdsReviewedBy } from "./reviewers"

export type TimeOffVisibility =
  | { all: true; error: null }
  | { all: false; requesterIds: string[]; error: string | null }

export async function resolveTimeOffVisibility(): Promise<TimeOffVisibility> {
  const [role, identity] = await Promise.all([getEffectiveRole(), getEffectiveIdentity()])
  if (!role) return { all: false, requesterIds: [], error: null }
  if (role === "super_user") return { all: true, error: null }

  const own = new Set(await idsForEmail(identity.email))
  if (identity.userId) for (const id of await idsForUser(identity.userId)) own.add(id)
  if (own.size === 0) return { all: false, requesterIds: [], error: null }

  const reviewed = await personIdsReviewedBy([...own])
  if (reviewed === null) {
    return {
      all: false,
      requesterIds: [...own],
      error: "Couldn't load who you approve for — showing only your own requests.",
    }
  }
  return { all: false, requesterIds: [...new Set([...own, ...reviewed])], error: null }
}

/** May the viewer open a request by this requester? (The drawer's gate.) */
export async function canViewTimeOffRequest(requestedById: string | null | undefined): Promise<boolean> {
  const v = await resolveTimeOffVisibility()
  if (v.all) return true
  return !!requestedById && v.requesterIds.includes(requestedById)
}

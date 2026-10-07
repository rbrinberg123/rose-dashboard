/**
 * PURE rules for Feedback task CLAIMING — no I/O, so every allow/deny decision
 * is unit-testable (policy.test.ts) and lives in exactly one place. The server
 * actions in app/feedback-manager/actions.ts apply these AFTER re-reading the
 * task, and then repeat the same conditions in the UPDATE's WHERE clause so a
 * race cannot slip past.
 *
 * Lifecycle (one Feedback task, subtype 'Feedback'):
 *   Open · unclaimed  → claim (capability)              → Open · claimed
 *   Open · claimed    → release (owner or admin)         → Open · unclaimed
 *   Open · claimed    → reassign (admin)                 → Open · claimed (new owner)
 *   Open · any        → close (owner, or admin)          → Completed
 * Completing the Feedback task is the EXISTING completion workflow: it moves
 * the report into Pending Review in v_feedback_pipeline (the paired "Feedback
 * Report Sent" task's review / send flow is unchanged).
 *
 * See content/docs/14-tasks.md → "Feedback claiming".
 */

/**
 * ── THE CUTOVER SWITCH ─────────────────────────────────────────────────────
 * false (today): only DASHBOARD-origin Feedback tasks are claimable. Dynamics-
 * origin tasks are read-only mirror rows until cutover and are never written.
 *
 * true (at cutover, once direct editing of Dynamics-origin records is allowed):
 * Dynamics-origin Feedback tasks become claimable too. Nothing else changes —
 * the claim / close columns are dashboard-owned (the sync never writes them),
 * and Close already writes the task's native completion fields. Flipping this
 * constant is the whole switch; see the cutover checklist in the docs.
 */
export const FEEDBACK_CLAIMS_INCLUDE_DYNAMICS = false

export const FEEDBACK_SUBTYPE = "Feedback"

/** Is a task of this origin inside the claimable pool at all? */
export function isClaimableOrigin(origin: string | null | undefined): boolean {
  return origin === "dashboard" || (FEEDBACK_CLAIMS_INCLUDE_DYNAMICS && origin === "dynamics")
}

/** The task facts every decision needs (read fresh from public.tasks). */
export type ClaimTask = {
  origin: string | null
  stateLabel: string | null
  subtypeLabel: string | null
  /** crdfa_feedback_received_date — the pool requires feedback received. */
  receivedDate: string | null
  /** Current owner (dashboard claim column, see ownerOf in the actions). */
  ownerId: string | null
}

/** Who is acting. `myIds` = every user_id of the actor (duplicate CRM records unioned). */
export type ClaimActor = {
  myIds: ReadonlySet<string>
  isAdmin: boolean
  hasCapability: boolean
}

/** null = allowed; otherwise the user-facing reason. */
export type Decision = string | null

/** Shared preconditions: a Feedback task, in the pool, still Open. */
function inPool(t: ClaimTask): Decision {
  if (t.subtypeLabel !== FEEDBACK_SUBTYPE) return "Only Feedback tasks can be claimed."
  if (!isClaimableOrigin(t.origin)) {
    return "This task is synced from Dynamics and can't be claimed here until cutover."
  }
  if (t.stateLabel !== "Open") return "This task is already closed."
  return null
}

export function decideClaim(t: ClaimTask, a: ClaimActor): Decision {
  if (!a.hasCapability && !a.isAdmin) return "You don't have permission to claim feedback."
  const pool = inPool(t)
  if (pool) return pool
  if (!t.receivedDate) return "Feedback hasn't been received for this task yet."
  if (t.ownerId) return "Someone has already claimed this task."
  return null
}

export function decideRelease(t: ClaimTask, a: ClaimActor): Decision {
  const pool = inPool(t)
  if (pool) return pool
  if (!t.ownerId) return "This task isn't claimed."
  if (!a.isAdmin && !a.myIds.has(t.ownerId)) return "Only the owner or an admin can release this task."
  return null
}

export function decideReassign(t: ClaimTask, a: ClaimActor, toUserId: string | null): Decision {
  if (!a.isAdmin) return "Only an admin can reassign a task."
  const pool = inPool(t)
  if (pool) return pool
  if (!toUserId) return "Pick someone to assign it to."
  if (t.ownerId === toUserId) return "That person already owns this task."
  return null
}

export function decideClose(t: ClaimTask, a: ClaimActor): Decision {
  const pool = inPool(t)
  if (pool) return pool
  if (a.isAdmin) return null
  if (!t.ownerId || !a.myIds.has(t.ownerId)) return "Only the owner or an admin can close this task."
  return null
}

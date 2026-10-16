/**
 * PURE rules for Feedback task CLAIMING — no I/O, so every allow/deny decision
 * is unit-testable (policy.test.ts) and lives in exactly one place. The server
 * actions in app/feedback-manager/actions.ts apply these AFTER re-reading the
 * task, and then repeat the same conditions in the UPDATE's WHERE clause so a
 * race cannot slip past.
 *
 * Lifecycle (one Feedback task, subtype 'Feedback'):
 *   Open · unclaimed  → claim (Claim capability, or admin)       → Open · claimed
 *   Open · claimed    → release (owner, admin, or Mark-received) → Open · unclaimed
 *   Open · any        → assign / reassign (same three)           → Open · claimed (new owner)
 *   Open · claimed    → close (owner, or admin)                  → Completed
 * "admin" = hasSuperUserPrivileges (super user or admin). The two capabilities
 * (2026-10-16) are lib/access/feedback-capabilities.ts.
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
  /** "Claim feedback report" capability (role or person grant). */
  hasCapability: boolean
  /** "Mark feedback received" capability (role or person grant) — also lets them assign / release / reassign. */
  markReceived: boolean
}

/**
 * May this actor assign / release / reassign a Feedback (report) task?
 * (2026-10-16) hasSuperUserPrivileges OR the task's current owner (the
 * claimer) OR the "Mark feedback received" capability. Collection task only —
 * the Feedback Report Sent task has no reassign.
 */
export function canManageAssignment(t: Pick<ClaimTask, "ownerId">, a: ClaimActor): boolean {
  return a.isAdmin || a.markReceived || (!!t.ownerId && a.myIds.has(t.ownerId))
}

const MANAGE_DENIED =
  "Only the task's owner, an admin, or someone who can mark feedback received can change who has this task."

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
  if (!canManageAssignment(t, a)) return MANAGE_DENIED
  return null
}

export function decideReassign(t: ClaimTask, a: ClaimActor, toUserId: string | null): Decision {
  const pool = inPool(t)
  if (pool) return pool
  if (!canManageAssignment(t, a)) return MANAGE_DENIED
  if (!toUserId) return "Pick someone to assign it to."
  if (t.ownerId === toUserId) return "That person already owns this task."
  return null
}

/**
 * Closing / sending a report's "Feedback Report Sent" task (= Sent, done) — ONE
 * rule for every path (Feedback Reports → Close, the event card's Send, Tasks →
 * Close / Edit → Completed). OWNER-ONLY (2026-10-16 — the account-team branch
 * was removed): allowed for
 *   - the sent task's OWNER (auto-assigned: the client's associate), or
 *   - hasSuperUserPrivileges (Super User or Admin).
 * The server works out each flag on a fresh read (lib/feedback-claims/close-guard.ts).
 */
export function decideSentClose(a: { isOwner: boolean; isAdmin: boolean }): Decision {
  if (a.isOwner || a.isAdmin) return null
  return "Not authorised — only the report's associate (the task owner) or an admin can send this report."
}

/** The Close guard's reason — shared with the buttons' tooltip. */
export const CLOSE_NEEDS_ASSIGNEE = "Assign before closing."

/**
 * Closing the Feedback (collection / report) task — OWNER-ONLY: its owner (the
 * claimer) or hasSuperUserPrivileges. No account-team branch (never had one).
 */
export function decideClose(t: ClaimTask, a: ClaimActor): Decision {
  const pool = inPool(t)
  if (pool) return pool
  // GUARD (2026-10-15): a Feedback task can't be closed until someone is
  // assigned — admins included. closeFeedbackTask runs this for BOTH the
  // Feedback Reports page and the event card.
  if (!t.ownerId) return CLOSE_NEEDS_ASSIGNEE
  if (a.isAdmin) return null
  if (!a.myIds.has(t.ownerId)) return "Only the owner or an admin can close this task."
  return null
}

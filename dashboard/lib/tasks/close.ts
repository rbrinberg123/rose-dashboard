/**
 * PURE rules for CLOSING a task from its record card (the Close button next to
 * Edit) — no I/O, so every allow/deny decision is unit-testable (close.test.ts).
 * The server action (closeTask in app/tasks/actions.ts) applies these to a
 * FRESH read of the task, then repeats the conditions in the UPDATE's WHERE.
 *
 * Closing is the EXISTING completion workflow — the same native fields a CRM
 * completion / the Feedback Reports Close set (state + status Completed,
 * actual_end = now; TASK_STATUS_OPTIONS "completed") — plus the dashboard-owned
 * sidecar columns closed_by_id / closed_by_name / closed_at, which the Dynamics
 * sync never writes (sql/patches/2026-10-07 feedback-claims patch).
 *
 * BY ORIGIN:
 *   dashboard → "native": the native completion fields + sidecar, written
 *               directly. Triggers / views react exactly as to any completion.
 *   dynamics  → "sidecar" (pre-cutover): ONLY the sidecar columns. The task
 *               stays Open in the mirror (Dynamics owns it until cutover);
 *               dashboard readers treat "Open + closed_at" as closed (My
 *               Dashboard drops it). The native write-through is the CUTOVER
 *               STEP — flip TASK_CLOSE_WRITE_THROUGH_DYNAMICS.
 */

/**
 * ── THE CUTOVER SWITCH ─────────────────────────────────────────────────────
 * false (today): a Dynamics-origin close records the dashboard-owned closed
 * state only. true (at cutover): it also writes the native completion fields,
 * exactly like a dashboard-origin close. Rows closed before the flip are the
 * ones to write through: origin = 'dynamics' AND state_label = 'Open' AND
 * closed_at IS NOT NULL.
 */
export const TASK_CLOSE_WRITE_THROUGH_DYNAMICS = false

export type CloseTask = {
  origin: string | null
  stateLabel: string | null
  /** Dashboard-owned sidecar: set once closed from the dashboard. */
  closedAt: string | null
  ownerId: string | null
}

export type CloseActor = {
  /** Every user_id of the actor (duplicate CRM records unioned). */
  myIds: ReadonlySet<string>
  /** super_user. */
  isAdmin: boolean
}

/** null = allowed; otherwise the user-facing reason. */
export function decideTaskClose(t: CloseTask, a: CloseActor): string | null {
  if (t.origin !== "dashboard" && t.origin !== "dynamics") return "This task can't be closed here."
  if (t.stateLabel !== "Open" || t.closedAt) return "This task is already closed."
  const isOwner = !!t.ownerId && a.myIds.has(t.ownerId)
  if (!isOwner && !a.isAdmin) return "Not authorised: only the task's owner or an admin can close it."
  return null
}

/** How a close is written for this origin (see the header). */
export function closeMode(origin: string | null): "native" | "sidecar" {
  return origin === "dashboard" || TASK_CLOSE_WRITE_THROUGH_DYNAMICS ? "native" : "sidecar"
}

/** Closed from the dashboard but still Open in the Dynamics mirror (pre-cutover). */
export function isSidecarClosed(t: { stateLabel: string | null; closedAt: string | null }): boolean {
  return t.stateLabel === "Open" && !!t.closedAt
}

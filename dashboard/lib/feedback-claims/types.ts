/** Client-safe shapes for the Feedback Reports claim UI (no server imports). */

export type ClaimViewerInfo = {
  /** May claim (capability, or Super User). */
  canClaim: boolean
  /** Super User: release / reassign / close anything in the pool. */
  isAdmin: boolean
  /** Every user_id of the viewer (duplicate CRM records unioned) — "Mine". */
  myIds: string[]
  /** In "View as": buttons render (preview) but are disabled. */
  impersonated: boolean
}

/** Per-task claim facts for rows in the claimable pool. */
export type ClaimMeta = {
  claimedAt: string | null
}

export type ClosedClaimRow = {
  taskId: string
  client: string | null
  event: string | null
  ownerName: string | null
  closedByName: string | null
  closedAt: string
}

/**
 * A Pending Review row's automation-created review task ("Feedback Report
 * Pending Review – …", linked by tasks.review_of_task_id). Present ONLY for
 * in-scope (dashboard-origin today) review tasks that are still Open.
 */
export type ReviewTaskInfo = {
  reviewTaskId: string
  /** The viewer is on the client's account team (display only — the action re-checks). */
  canClose: boolean
}

export type ClaimsContext = {
  viewer: ClaimViewerInfo
  /** task_id → meta, ONLY for tasks inside the claimable pool (Open, in-origin). */
  meta: Record<string, ClaimMeta>
  /** Feedback (report) task_id → its open review task, for Pending Review rows. */
  reviews: Record<string, ReviewTaskInfo>
  closed: ClosedClaimRow[]
  /** Reassign picker — admins only (empty for everyone else). */
  roster: { userId: string; name: string }[]
  /** The 2026-10-07 SQL patch has not been run yet. */
  setupMissing: boolean
}

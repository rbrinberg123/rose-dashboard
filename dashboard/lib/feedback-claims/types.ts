/** Client-safe shapes for the Feedback Reports claim UI (no server imports). */

export type ClaimViewerInfo = {
  /** May claim (capability, or Super User). */
  canClaim: boolean
  /** Super User / Admin: close anything in the pool. */
  isAdmin: boolean
  /**
   * May assign / release / reassign ANY pool task (2026-10-16): super-user
   * privileges OR the "Mark feedback received" capability. The task's own
   * owner may also release / reassign theirs (worked out per task).
   */
  canManageAll: boolean
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
  /** The viewer owns this review task or is an admin (display only — the action re-checks). */
  canClose: boolean
}

/** Just what the shared ClaimActions buttons need (Feedback Reports + event card). */
export type ClaimControls = {
  viewer: ClaimViewerInfo
  roster: { userId: string; name: string }[]
}

export type ClaimsContext = {
  viewer: ClaimViewerInfo
  /** task_id → meta, ONLY for tasks inside the claimable pool (Open, in-origin). */
  meta: Record<string, ClaimMeta>
  /**
   * Clients (account ids) where the viewer is on the account team — any of the
   * six roles. Pending Review → Close is offered on these rows (display only;
   * closeFeedbackReview re-checks).
   */
  teamAccountIds: string[]
  /** Feedback (report) task_id → its open review task, for Pending Review rows. */
  reviews: Record<string, ReviewTaskInfo>
  closed: ClosedClaimRow[]
  /** Reassign picker (empty for viewers who can't assign anything). */
  roster: { userId: string; name: string }[]
  /** Open Feedback Report Sent task ids the viewer OWNS — Pending Review → Close (owner-only). */
  ownedReviewTaskIds: string[]
  /** The 2026-10-07 SQL patch has not been run yet. */
  setupMissing: boolean
}

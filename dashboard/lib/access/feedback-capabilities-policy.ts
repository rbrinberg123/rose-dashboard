/**
 * PURE rules for the two FEEDBACK CAPABILITIES (2026-10-16) — no I/O, so the
 * decision is unit-testable (feedback-capabilities-policy.test.ts). Same shape
 * as financials-policy.ts.
 *
 *   Claim feedback report         may claim an unclaimed Feedback (report) task.
 *   Mark feedback received        may Mark feedback all in, and may assign /
 *                                 release / reassign the Feedback (report) task.
 *
 * Each is granted when ANY of:
 *   - the person's role has super-user privileges (super_user / admin) — always;
 *   - their per-person flag in public.user_data_scopes (Admin → Users);
 *   - their ROLE holds the matching data permission in the Roles matrix,
 *     stored in public.role_page_access under the non-route `data:` key below.
 * Deny-by-default: nobody else has either until it is granted.
 *
 * The async orchestration lives in ./feedback-capabilities.ts.
 */

/** role_page_access.route key for the ROLE-level "Claim feedback report" grant. */
export const CLAIM_FEEDBACK_PERMISSION_KEY = "data:claim_feedback"

/** role_page_access.route key for the ROLE-level "Mark feedback received" grant. */
export const MARK_FEEDBACK_RECEIVED_PERMISSION_KEY = "data:mark_feedback_received"

export type FeedbackCapabilities = {
  claimFeedback: boolean
  markFeedbackReceived: boolean
}

export const NO_FEEDBACK_CAPABILITIES: FeedbackCapabilities = {
  claimFeedback: false,
  markFeedbackReceived: false,
}

export type FeedbackCapabilityInputs = {
  /** Role has super-user privileges (super_user / admin). */
  isSuper: boolean
  /** user_data_scopes flags. */
  userFlags: FeedbackCapabilities
  /** Roles-matrix grants for the person's role. */
  roleFlags: FeedbackCapabilities
}

export function decideFeedbackCapabilities(input: FeedbackCapabilityInputs): FeedbackCapabilities {
  if (input.isSuper) return { claimFeedback: true, markFeedbackReceived: true }
  return {
    claimFeedback: input.userFlags.claimFeedback || input.roleFlags.claimFeedback,
    markFeedbackReceived: input.userFlags.markFeedbackReceived || input.roleFlags.markFeedbackReceived,
  }
}

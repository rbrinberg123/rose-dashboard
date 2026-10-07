/**
 * PURE "Needs review" rules for Client Health overrides — no I/O, so the
 * flagging decision is unit-testable (client-health-review.test.ts).
 *
 * An override is a strong human prior, not a permanent lock. Each regeneration
 * computes a fresh AI ("shadow") rating; for a PREFER override this decides
 * whether that run should raise a review flag. A flag is STICKY — only a human
 * resolution (Keep / Update / Revert / mode change, app/client-health/actions.ts)
 * clears it; a regeneration may raise or upgrade one, never clear it.
 */

export type OverrideMode = "prefer" | "pin"
export type ReviewReason = "divergence" | "new_evidence"

export function isOverrideMode(v: unknown): v is OverrideMode {
  return v === "prefer" || v === "pin"
}

export type ReviewInput = {
  /** override_rating / override_note present at all (a note-only override counts). */
  hasOverride: boolean
  overrideRating: string | null
  mode: OverrideMode
  /** AI rating at the last review baseline (override save / Keep / mode change). */
  baselineAiRating: string | null
  /** The rating this run just produced. */
  freshAiRating: string
  /** New client notes / contract changes since override_reviewed_at. */
  newEvidence: boolean
  /** The flag as it stands before this run. */
  current: { suggested: boolean; reason: ReviewReason | null }
}

/**
 * null = write nothing to the review columns this run.
 * { reason, upgrade: false } = raise a new flag.
 * { reason: "divergence", upgrade: true } = an open new-evidence flag becomes
 *   the louder divergence flag (review_flagged_at is kept).
 *
 * Divergence needs an override RATING (a note-only override can only be
 * flagged for new evidence), a fresh AI rating different from it, AND one
 * different from the baseline — so a divergence a human already acknowledged
 * (Keep) does not re-flag every week while it stays the same.
 */
export function decideReview(i: ReviewInput): { reason: ReviewReason; upgrade: boolean } | null {
  if (!i.hasOverride || i.mode === "pin") return null
  const divergence =
    i.overrideRating !== null &&
    i.freshAiRating !== i.overrideRating &&
    i.freshAiRating !== i.baselineAiRating
  if (!divergence && !i.newEvidence) return null
  const reason: ReviewReason = divergence ? "divergence" : "new_evidence"
  if (i.current.suggested) {
    // Idempotent: never thrash an open flag; only upgrade new_evidence → divergence.
    return reason === "divergence" && i.current.reason !== "divergence"
      ? { reason: "divergence", upgrade: true }
      : null
  }
  return { reason, upgrade: false }
}

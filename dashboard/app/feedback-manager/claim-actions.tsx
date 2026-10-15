"use client"

import * as React from "react"

import { CLOSE_NEEDS_ASSIGNEE } from "@/lib/feedback-claims/policy"
import type { ClaimControls } from "@/lib/feedback-claims/types"

/**
 * The Feedback task's ownership buttons — Claim · Release · Assign / Reassign ·
 * Close — SHARED by Feedback Reports (feedback-manager-view.tsx) and the event
 * card's report lifecycle card (app/events/report-lifecycle-card.tsx), so both
 * offer the same buttons to the same people. The buttons are cosmetic: every
 * action re-checks permission, pool and owner on the server
 * (app/feedback-manager/actions.ts → lib/feedback-claims/policy.ts).
 *
 * Who sees what (unchanged from the page):
 *   Claim             unowned, viewer may claim (capability or admin)
 *   Release           owned, viewer is the owner or an admin
 *   Assign / Reassign admin (roster picker)
 *   Close             viewer is the owner or an admin — DISABLED until someone
 *                     is assigned ("Assign before closing"); decideClose
 *                     enforces the same rule server-side.
 */

const ACTION_BTN =
  "inline-flex h-7 items-center rounded-md border border-input bg-background px-2 text-xs font-medium " +
  "text-foreground transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"

export function ClaimActions({
  inPool,
  ownerId,
  controls,
  myIds,
  onClaim,
  onRelease,
  onReassign,
  onClose,
  compact = false,
}: {
  /** The task is in the claimable pool (Open Feedback task, in-origin, received). */
  inPool: boolean
  /** Current assignee, or null. */
  ownerId: string | null
  controls: ClaimControls
  myIds: ReadonlySet<string>
  onClaim: () => void
  onRelease: () => void
  onReassign: (userId: string, name: string) => void
  onClose: () => void
  /** Smaller buttons in a single row (event card). */
  compact?: boolean
}) {
  const [picking, setPicking] = React.useState(false)
  // Only tasks inside the claimable pool get buttons — today that is
  // dashboard-origin Feedback tasks; Dynamics-origin rows stay read-only until
  // the cutover switch opens them.
  if (!inPool) return null

  const { viewer, roster } = controls
  const owner = ownerId
  const isMine = !!owner && myIds.has(owner)
  const disabled = viewer.impersonated
  const title = disabled ? "Exit “View as” to change claims" : undefined
  const btn = compact ? ACTION_BTN.replace("h-7", "h-6").replace("text-xs", "text-[11.5px]") : ACTION_BTN

  const buttons: React.ReactNode[] = []
  if (!owner && viewer.canClaim) {
    buttons.push(
      <button key="claim" type="button" className={btn} disabled={disabled} title={title} onClick={onClaim}>
        Claim
      </button>,
    )
  }
  if (owner && (isMine || viewer.isAdmin)) {
    buttons.push(
      <button key="release" type="button" className={btn} disabled={disabled} title={title} onClick={onRelease}>
        Release
      </button>,
    )
  }
  if (viewer.isAdmin) {
    buttons.push(
      <button
        key="reassign"
        type="button"
        className={btn}
        disabled={disabled}
        title={title}
        onClick={() => setPicking((p) => !p)}
      >
        {owner ? "Reassign" : "Assign"}
      </button>,
    )
  }
  if (isMine || viewer.isAdmin) {
    // The Close guard: nobody assigned → disabled, with the reason.
    const unassigned = !owner
    buttons.push(
      <button
        key="close"
        type="button"
        className={btn}
        disabled={disabled || unassigned}
        title={title ?? (unassigned ? CLOSE_NEEDS_ASSIGNEE : "Complete this Feedback task — it moves on to Pending Review")}
        onClick={() => {
          if (window.confirm("Close this feedback task? It will be marked complete and move on to Pending Review.")) onClose()
        }}
      >
        Close
      </button>,
    )
  }
  if (buttons.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">{buttons}</div>
      {picking && viewer.isAdmin && (
        <select
          autoFocus
          defaultValue=""
          aria-label="Assign to"
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          onChange={(e) => {
            const person = roster.find((p) => p.userId === e.target.value)
            if (!person) return
            setPicking(false)
            onReassign(person.userId, person.name)
          }}
        >
          <option value="" disabled>
            Assign to…
          </option>
          {roster
            .filter((p) => p.userId !== owner)
            .map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
        </select>
      )}
    </div>
  )
}

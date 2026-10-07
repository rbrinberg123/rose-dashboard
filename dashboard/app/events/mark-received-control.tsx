"use client"

import * as React from "react"
import { toast } from "sonner"

import { markFeedbackReceived } from "./feedback-report-actions"

const BTN =
  "inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-md border border-input bg-background px-2 text-[11.5px] font-medium " +
  "text-foreground transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"

function todayEastern(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date())
}

/**
 * "Mark feedback received" — one button that opens a date (default today,
 * editable) and saves it as the report's Feedback Received Date. Used on
 * FB Coming Soon rows and per report in the event drawer's Feedback reports
 * panel. The server action re-checks everything (super user, not View as,
 * dashboard-origin Open Feedback task, not already received).
 */
export function MarkReceivedControl({
  taskId,
  disabled = false,
  onDone,
  onOptimistic,
  onRollback,
}: {
  taskId: string
  disabled?: boolean
  /** After a successful save (e.g. router.refresh / reload the panel). */
  onDone?: () => void
  /** Called just before the request — hide the row straight away. */
  onOptimistic?: () => void
  /** Called if the server refuses — undo onOptimistic. */
  onRollback?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [day, setDay] = React.useState(todayEastern)
  const [busy, startTransition] = React.useTransition()

  if (!open) {
    return (
      <button type="button" className={BTN} disabled={disabled || busy} onClick={() => setOpen(true)}>
        Mark received
      </button>
    )
  }
  return (
    <div className="flex flex-nowrap items-center gap-1">
      <input
        type="date"
        aria-label="Feedback received on"
        value={day}
        max={todayEastern()}
        onChange={(e) => setDay(e.target.value)}
        className="h-6 w-[118px] shrink-0 rounded-md border border-input bg-background px-1 text-[11.5px]"
      />
      <button
        type="button"
        className={BTN}
        disabled={busy || !day}
        onClick={() =>
          startTransition(async () => {
            onOptimistic?.()
            const res = await markFeedbackReceived(taskId, day)
            if (res.ok) {
              toast.success("Feedback received — the report is now on Feedback Reports, ready to claim.")
              setOpen(false)
              onDone?.()
            } else {
              onRollback?.()
              toast.error("Couldn't mark feedback received", { description: res.error })
            }
          })
        }
      >
        Save
      </button>
      <button type="button" className={BTN} disabled={busy} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  )
}

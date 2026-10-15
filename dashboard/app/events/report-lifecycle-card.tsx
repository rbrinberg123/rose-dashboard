"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check, FileText } from "lucide-react"

import { RAIL_ACCENT_FILL, STATUS_PILL_LIGHT, TEXT_MUTED, TEXT_PRIMARY, TEXT_TERTIARY } from "@/lib/design"
import {
  LIFECYCLE_STEPS,
  canAct,
  deriveStage,
  lifecycleNote,
  nextAction,
  stageIndex,
  type LifecycleViewer,
} from "@/lib/feedback-reports/lifecycle"
import { cn } from "@/lib/utils"
import type { FeedbackReportSummary } from "./feedback-report-actions"
import { sendReport, type ReportLifecycle } from "./feedback-lifecycle-actions"
import { MarkReceivedControl } from "./mark-received-control"
import type { ActionResult } from "@/lib/actions"
import type { ClaimControls } from "@/lib/feedback-claims/types"
import {
  claimFeedbackTask,
  closeFeedbackTask,
  reassignFeedbackTask,
  releaseFeedbackTask,
} from "@/app/feedback-manager/actions"
import { ClaimActions } from "@/app/feedback-manager/claim-actions"

/**
 * One report's LIFECYCLE card at the top of its group in Meetings & Reports
 * (event drawer + Edit Event dialog; dashboard-origin events only). Two reports
 * = two cards. Derived from the two existing tasks — see
 * lib/feedback-reports/lifecycle.ts:
 *   strip   Collection → Claimed → Review → Sent
 *   note    the people at this stage ("Claimed by X · working", …)
 *   actions Collection: "Mark feedback all in". Once all in, while the
 *           Feedback task is open: the SHARED ownership buttons — Claim ·
 *           Release · Assign/Reassign · Close (app/feedback-manager/
 *           claim-actions.tsx) calling the SAME Feedback Reports actions, so
 *           the card and the page behave and permission-gate identically;
 *           Close needs someone assigned. Review: "Mark Sent" (closes the Feedback
 *           Report Sent task — done). Buttons show only to whoever may use
 *           them; every action is re-checked server-side.
 * Styled as the panel's distinct report row: accent tint, solid left bar,
 * dashed border, report icon.
 */

const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })

const BTN_PRIMARY =
  "inline-flex h-6 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md px-2 text-[11.5px] font-semibold text-white " +
  "transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"

const SEND_CONFIRM = "Mark this report sent? It closes the Feedback Report Sent task — the report is done."

export function ReportLifecycleCard({
  report: r,
  focused = false,
  life,
  viewer,
  controls,
  accent,
  count,
  disabled,
  onDone,
}: {
  report: FeedbackReportSummary
  /** Deep-linked from Feedback Reports — ringed so it stands out. */
  focused?: boolean
  /** null while loading or if the lifecycle read failed. */
  life: ReportLifecycle | null
  viewer: LifecycleViewer | null
  /** The shared ClaimActions' rights + roster (loadClaimControls); null = no buttons. */
  controls: ClaimControls | null
  accent: string
  count: number
  disabled: boolean
  onDone: () => void
}) {
  const [busy, startTransition] = React.useTransition()
  const stage = life ? deriveStage(life.report, life.sent) : null
  const current = stage ? stageIndex(stage) : -1
  const action = stage && life ? nextAction(stage, life.sent) : null
  const blocked = action && life && viewer ? canAct(action, life.report, life.sent, viewer) : "…"
  const tone = stage === "sent" ? STATUS_PILL_LIGHT.positive : STATUS_PILL_LIGHT.watch

  /** Server action → toast → reload the panel (same messages as Feedback Reports). */
  function run(call: () => Promise<ActionResult>, success: string) {
    startTransition(async () => {
      const res = await call()
      if (res.ok) {
        toast.success(success)
        onDone()
      } else {
        toast.error("Couldn't update the task", { description: res.error })
      }
    })
  }
  const myIds = React.useMemo(() => new Set(controls?.viewer.myIds ?? []), [controls])
  // The shared buttons' pool: an Open Feedback task with feedback all in (as on
  // Feedback Reports' Open section). Dashboard-origin only — the card is.
  const inPool = !!life && life.report.state === "Open" && !!life.report.receivedDate

  return (
    <li
      className="mx-2 my-1.5 grid gap-1.5 rounded-md border border-dashed border-l-[3px] py-2 pl-2.5 pr-2 text-xs"
      style={{
        backgroundColor: `color-mix(in srgb, ${accent} 7%, white)`,
        borderColor: `color-mix(in srgb, ${accent} 45%, white)`,
        borderLeftColor: accent,
        borderLeftStyle: "solid",
        // Deep-linked report: a ring in its own accent.
        boxShadow: focused ? `0 0 0 2px ${accent}` : undefined,
      }}
    >
      {/* Title row */}
      <div className="flex items-center gap-1.5">
        <FileText className="size-3.5 shrink-0" style={{ color: accent }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate" style={{ color: TEXT_PRIMARY }} title={r.subject ?? undefined}>
          <span className="font-semibold">Feedback report {r.letter}</span>
          <span style={{ color: TEXT_MUTED }}>
            {" · "}
            {count} meeting{count === 1 ? "" : "s"} · due {r.dueDate ? ET_DAY.format(new Date(r.dueDate)) : "—"}
          </span>
        </span>
      </div>

      {/* Strip: Collection → Claimed → Review → Sent */}
      <ol className="grid grid-cols-4 gap-1" aria-label="Report lifecycle">
        {LIFECYCLE_STEPS.map((s, i) => {
          const done = i < current || stage === "sent"
          const here = i === current && stage !== "sent"
          return (
            <li key={s.key} className="flex items-center gap-1" aria-current={here ? "step" : undefined}>
              <span
                className="flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
                style={{
                  backgroundColor: done ? accent : "#FFFFFF",
                  color: done ? "#FFFFFF" : here ? accent : TEXT_TERTIARY,
                  border: done ? "none" : `1.5px solid ${here ? accent : "#D5DBE7"}`,
                }}
              >
                {done ? <Check className="size-2.5" strokeWidth={3} /> : i + 1}
              </span>
              <span
                className={cn("truncate text-[10.5px]", here ? "font-semibold" : "font-medium")}
                style={{ color: done || here ? TEXT_PRIMARY : TEXT_TERTIARY }}
              >
                {s.label}
              </span>
            </li>
          )
        })}
      </ol>

      {/* Note + action */}
      <div className="flex min-h-6 items-center gap-2">
        <span className="min-w-0 flex-1" style={{ color: stage ? TEXT_PRIMARY : TEXT_MUTED }}>
          {life && stage ? (
            <span
              className="rounded px-1 py-px"
              style={stage === "sent" || stage === "review" ? { backgroundColor: tone.bg, color: tone.text } : undefined}
            >
              {lifecycleNote(stage, life.report, life.sent)}
            </span>
          ) : (
            "Loading…"
          )}
        </span>
        {action && !blocked && (
          action === "mark_in" ? (
            // Enter in its date box must not submit the Edit Event form around it.
            <span title="Mark feedback all in" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}>
              <MarkReceivedControl taskId={r.taskId} disabled={disabled || busy} onDone={onDone} label="Mark feedback all in" />
            </span>
          ) : (
            <button
              type="button"
              className={BTN_PRIMARY}
              // The shared CRM primary fill (AddNewButton's RAIL_ACCENT_FILL).
              style={{ background: RAIL_ACCENT_FILL }}
              disabled={disabled || busy}
              onClick={() => {
                if (window.confirm(SEND_CONFIRM)) run(() => sendReport(r.taskId), "Report sent.")
              }}
            >
              Mark Sent
            </button>
          )
        )}
      </div>

      {/* Ownership — the SAME buttons and actions as Feedback Reports. */}
      {inPool && controls && (
        <ClaimActions
          compact
          inPool
          ownerId={life!.report.claimedById}
          controls={controls}
          myIds={myIds}
          onClaim={() => run(() => claimFeedbackTask(r.taskId), "Claimed — it's yours.")}
          onRelease={() => run(() => releaseFeedbackTask(r.taskId), "Released — back to unclaimed.")}
          onReassign={(userId, name) => run(() => reassignFeedbackTask(r.taskId, userId), `Assigned to ${name}.`)}
          onClose={() => run(() => closeFeedbackTask(r.taskId), "Closed — moved on to Review.")}
        />
      )}
    </li>
  )
}

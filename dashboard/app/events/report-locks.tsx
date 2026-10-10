"use client"

import * as React from "react"
import { toast } from "sonner"
import { AlertTriangle, Lock, LockOpen } from "lucide-react"

import { STATUS_PILL_LIGHT, TEXT_MUTED } from "@/lib/design"
import { checkReallocation, meetingFeedbackFlag } from "@/lib/feedback-reports/policy"
import type { FeedbackReportSummary, ReallocationOptions } from "./feedback-report-actions"

/**
 * Shared by both feedback-report panels (event drawer → Feedback reports, Edit
 * Event → Meetings & Reports): the per-meeting feedback flag, the per-report
 * lock indicators, the save-time confirm, and the admin override control.
 * Every rule here is re-checked server-side (feedback-report-actions.ts).
 */

const FLAG_STYLE: Record<ReturnType<typeof meetingFeedbackFlag>["key"], { bg: string; fg: string }> = {
  not_in: { bg: STATUS_PILL_LIGHT.neutral.bg, fg: TEXT_MUTED },
  waiting: { bg: STATUS_PILL_LIGHT.watch.bg, fg: STATUS_PILL_LIGHT.watch.text },
  no_feedback: { bg: STATUS_PILL_LIGHT.neutral.bg, fg: STATUS_PILL_LIGHT.neutral.text },
  in: { bg: STATUS_PILL_LIGHT.positive.bg, fg: STATUS_PILL_LIGHT.positive.text },
}

/** Compact pill from the definitive meetings.feedback_status_label. */
export function FeedbackFlagPill({ status, receivedDate }: { status: string | null; receivedDate?: string | null }) {
  const flag = meetingFeedbackFlag(status)
  const { bg, fg } = FLAG_STYLE[flag.key]
  const when = receivedDate ? ` · received ${receivedDate.slice(0, 10)}` : ""
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full px-1.5 text-[10px] font-medium leading-4"
      style={{ backgroundColor: bg, color: fg }}
      title={`Feedback: ${status ?? "nothing recorded yet"}${when}`}
    >
      {flag.label}
    </span>
  )
}

/** Lock (claimed / closed) or warn (all feedback in) mark beside a report. */
export function ReportLockMark({ report }: { report: FeedbackReportSummary }) {
  if (report.lock === "hard") {
    const why = report.claimed ? `Claimed by ${report.claimedByName ?? "someone"}` : `Report is ${report.state ?? "closed"}`
    return (
      <span title={`${why} — locked: its meetings can't move and none can be added (admin override)`} className="shrink-0">
        <Lock aria-label="Locked" className="size-3.5" style={{ color: STATUS_PILL_LIGHT.atRisk.text }} />
      </span>
    )
  }
  if (report.lock === "warm") {
    return (
      <span title="All feedback is in — reallocating its meetings asks for confirmation" className="shrink-0">
        <AlertTriangle aria-label="All feedback in" className="size-3.5" style={{ color: STATUS_PILL_LIGHT.watch.text }} />
      </span>
    )
  }
  return null
}

/**
 * Before saving a re-allocation: refuse (with a toast) a hard-locked move
 * unless the override is on, and ask to confirm a warm one. Returns the options
 * to send, or null when the user backed out.
 */
export function confirmReallocation(
  reports: readonly FeedbackReportSummary[],
  before: Record<string, string | null>,
  after: Record<string, string>,
  override: boolean,
): ReallocationOptions | null {
  const chk = checkReallocation(reports, before, after)
  if (chk.hard.length > 0 && !override) {
    toast.error(`Report ${chk.hardLetters.join(" / ")} is locked`, {
      description: "It's claimed or closed — its meetings can't move and none can be added. Use Override lock (admin).",
    })
    return null
  }
  if (chk.warmLetters.length > 0) {
    const ok = window.confirm(`All feedback is in for Report ${chk.warmLetters.join(" / ")} — reallocate anyway?`)
    if (!ok) return null
  }
  return { confirmWarm: chk.warmLetters.length > 0, overrideLock: override && chk.hard.length > 0 }
}

/** Admin override switch — shown only when some report is hard-locked. */
export function OverrideLockButton({
  reports,
  on,
  onChange,
  className,
  disabled,
}: {
  reports: readonly FeedbackReportSummary[]
  on: boolean
  onChange: (next: boolean) => void
  className: string
  disabled?: boolean
}) {
  const locked = reports.filter((r) => r.lock === "hard")
  if (locked.length === 0) return null
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      style={on ? { borderColor: STATUS_PILL_LIGHT.atRisk.text, color: STATUS_PILL_LIGHT.atRisk.text } : undefined}
      title={
        on
          ? "Lock override is ON — changes to locked reports will be saved and audited"
          : `Admin: allow changes to locked report ${locked.map((r) => r.letter).join(" / ")} (audited)`
      }
      onClick={() => {
        if (on) return onChange(false)
        const ok = window.confirm(
          `Report ${locked.map((r) => r.letter).join(" / ")} is claimed or closed. Override the lock and allow its meetings to be reallocated? This is recorded in the audit log.`,
        )
        if (ok) onChange(true)
      }}
    >
      {on ? <LockOpen className="mr-1 size-3.5" /> : <Lock className="mr-1 size-3.5" />}
      {on ? "Override on" : "Override lock"}
    </button>
  )
}

/** Is this report a valid choice in a meeting's report picker right now? */
export function reportSelectable(r: FeedbackReportSummary, override: boolean): boolean {
  return override || r.lock !== "hard"
}

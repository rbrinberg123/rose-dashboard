"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { STATUS_PILL_LIGHT, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import { MAX_REPORTS_PER_EVENT } from "@/lib/feedback-reports/policy"
import {
  addFeedbackReport,
  deleteFeedbackReport,
  loadEventFeedbackReports,
  saveFeedbackReportAssignments,
  type EventFeedbackReports,
} from "./feedback-report-actions"
import { MarkReceivedControl } from "./mark-received-control"
import {
  FeedbackFlagPill,
  OverrideLockButton,
  ReportLockMark,
  confirmReallocation,
  reportSelectable,
} from "./report-locks"

/**
 * Event drawer → "Feedback reports". Shows the event's 1–3 Feedback report
 * tasks (auto-created when the event was created) and which meetings each one
 * covers; lets a super user Split (add a report), reassign meetings A / B / C,
 * and delete an unclaimed report. Every rule is re-checked on the server.
 *
 * Each meeting shows its own feedback flag (definitive feedback_status_label).
 * LOCKS (report-locks.tsx; enforced server-side): a claimed / closed report is
 * hard-locked (lock icon, its meetings' pickers and its option disabled; admin
 * "Override lock", audited); an all-feedback-in unclaimed report is warm (warn
 * icon; Save / Delete ask to confirm).
 */

const UTC_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" })
const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })
const BTN =
  "inline-flex h-7 items-center rounded-md border border-input bg-background px-2 text-xs font-medium " +
  "text-foreground transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"

export function FeedbackReportsPanel({ eventId }: { eventId: string }) {
  const [data, setData] = React.useState<EventFeedbackReports | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Record<string, string> | null>(null)
  const [busy, startTransition] = React.useTransition()
  const [reloadKey, setReloadKey] = React.useState(0)
  const [override, setOverride] = React.useState(false)
  const router = useRouter()

  // The effect owns only the async fetch — every setState is in its callback.
  React.useEffect(() => {
    let cancelled = false
    loadEventFeedbackReports(eventId).then((res) => {
      if (cancelled) return
      if (res.ok) {
        setData(res.data)
        setError(null)
        setDraft(null)
        setOverride(false)
      } else setError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [eventId, reloadKey])

  if (error) {
    return <p className="mb-6 text-xs text-destructive">Feedback reports: {error}</p>
  }
  if (!data || !data.inScope) return null

  const section = (body: React.ReactNode) => (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: TEXT_MUTED }}>
          Feedback reports
        </h3>
        <span className="h-px flex-1 bg-[#E5E8EC]" />
      </div>
      {body}
    </section>
  )

  if (data.setupMissing) {
    return section(
      <p className="text-xs" style={{ color: TEXT_MUTED }}>
        Switched off until <code>sql/patches/2026-10-07b_feedback_report_automation.sql</code> is run.
      </p>,
    )
  }
  if (data.reports.length === 0) {
    return section(
      <p className="text-xs" style={{ color: TEXT_MUTED }}>
        No feedback report for this event (it was created before the automation was switched on).
      </p>,
    )
  }

  const reload = () => {
    setReloadKey((k) => k + 1)
    router.refresh()
  }
  const eligible = data.meetings.filter((m) => m.eligible)
  const cancelled = data.meetings.filter((m) => !m.eligible)
  const current = (id: string) => draft?.[id] ?? data.meetings.find((m) => m.meetingId === id)?.reportTaskId ?? ""
  const dirty = draft !== null
  const autoRouted = eligible.filter((m) => m.autoRouted).length
  const savedLocked = (taskId: string | null) => data.reports.some((r) => r.taskId === taskId && r.lock === "hard")

  function run(call: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const res = await call()
      if (res.ok) {
        toast.success(success)
        reload()
      } else {
        toast.error("Couldn't update feedback reports", { description: res.error })
      }
    })
  }

  return section(
    <>
      {/* The reports */}
      <div className="mb-3 flex flex-col gap-1.5">
        {data.reports.map((r) => {
          const count = eligible.filter((m) => current(m.meetingId) === r.taskId).length
          return (
            <div
              key={r.taskId}
              className="flex items-center gap-2 rounded-md border border-[#E5E8EC] px-2.5 py-1.5 text-xs"
            >
              <span className="w-5 shrink-0 font-semibold" style={{ color: TEXT_PRIMARY }}>
                {r.letter}
              </span>
              <ReportLockMark report={r} />
              <span className="min-w-0 flex-1 truncate" style={{ color: TEXT_PRIMARY }} title={r.subject ?? undefined}>
                {r.claimedByName ?? "System (unclaimed)"}
                <span style={{ color: TEXT_MUTED }}>
                  {" · "}
                  {count} meeting{count === 1 ? "" : "s"} · due {r.dueDate ? ET_DAY.format(new Date(r.dueDate)) : "—"}
                  {r.state !== "Open" ? " · " + r.state : r.receivedDate ? " · feedback received" : " · awaiting feedback"}
                </span>
              </span>
              {/* Move it along: an Open report still awaiting feedback can be
                  marked received right here (e.g. a freshly split report B). */}
              {r.state === "Open" && !r.receivedDate && (
                <MarkReceivedControl taskId={r.taskId} disabled={busy || dirty} onDone={reload} />
              )}
              {data.reports.length > 1 && (
                <button
                  type="button"
                  className={BTN}
                  disabled={busy || dirty || !!r.claimedByName || r.state !== "Open"}
                  title={
                    r.claimedByName
                      ? "Claimed reports can't be deleted"
                      : r.state !== "Open"
                        ? "Only an open report can be deleted"
                        : "Delete — its meetings move to another report"
                  }
                  onClick={() => {
                    const warm = r.lock === "warm" && count > 0
                    const msg = warm
                      ? `All feedback is in for Report ${r.letter} — delete it and reallocate its meetings anyway?`
                      : `Delete report ${r.letter}? Its meetings move to another report of this event.`
                    if (window.confirm(msg)) {
                      run(
                        () => deleteFeedbackReport(eventId, r.taskId, { confirmWarm: warm, overrideLock: override }),
                        `Report ${r.letter} deleted.`,
                      )
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Meeting assignment */}
      {eligible.length > 0 && (
        <div className="mb-2 overflow-hidden rounded-md border border-[#E5E8EC]">
          {eligible.map((m) => (
            <div key={m.meetingId} className="flex items-center gap-2 border-b border-[#E5E8EC] px-2.5 py-1.5 text-xs last:border-0">
              <span className="w-12 shrink-0 tabular-nums" style={{ color: TEXT_MUTED }}>
                {m.date ? UTC_DAY.format(new Date(m.date)) : "—"}
              </span>
              <span className="min-w-0 flex-1 truncate" style={{ color: TEXT_PRIMARY }}>
                {m.institution ?? "Meeting"}
                {m.autoRouted && !draft?.[m.meetingId] && (
                  <span className="ml-1.5" style={{ color: STATUS_PILL_LIGHT.watch.text }} title="Added automatically after the split — please check">
                    · auto-added
                  </span>
                )}
              </span>
              <FeedbackFlagPill status={m.feedbackStatus} receivedDate={m.feedbackReceivedDate} />
              <select
                aria-label={`Report for ${m.institution ?? "meeting"}`}
                value={current(m.meetingId)}
                // A meeting in a hard-locked report can't move out (admin override).
                disabled={busy || data.reports.length < 2 || (savedLocked(m.reportTaskId) && !override)}
                title={savedLocked(m.reportTaskId) && !override ? "Its report is claimed — locked" : undefined}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...Object.fromEntries(eligible.map((x) => [x.meetingId, current(x.meetingId)])),
                    ...(d ?? {}),
                    [m.meetingId]: e.target.value,
                  }))
                }
                className="h-7 rounded-md border border-input bg-background px-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {!current(m.meetingId) && <option value="">—</option>}
                {data.reports.map((r) => (
                  <option
                    key={r.taskId}
                    value={r.taskId}
                    // Nothing can be added to a hard-locked report (admin override).
                    disabled={r.taskId !== current(m.meetingId) && !reportSelectable(r, override)}
                  >
                    Report {r.letter}
                    {r.lock === "hard" ? " · locked" : ""}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
      {cancelled.length > 0 && (
        <p className="mb-2 text-[11px]" style={{ color: TEXT_MUTED }}>
          {cancelled.length} cancelled / inactive meeting{cancelled.length === 1 ? "" : "s"} not in any report.
        </p>
      )}
      {eligible.length === 0 && (
        <p className="mb-2 text-xs" style={{ color: TEXT_MUTED }}>
          No meetings yet — they join the report automatically as they are added.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={BTN}
          disabled={busy || dirty || data.reports.length >= MAX_REPORTS_PER_EVENT}
          title={
            data.reports.length >= MAX_REPORTS_PER_EVENT
              ? `At most ${MAX_REPORTS_PER_EVENT} reports per event`
              : "Create another feedback report for this event"
          }
          onClick={() => run(() => addFeedbackReport(eventId), "Report added — now assign meetings to it.")}
        >
          Split feedback report
        </button>
        {(dirty || autoRouted > 0) && data.reports.length > 1 && (
          <button
            type="button"
            className={BTN}
            disabled={busy}
            onClick={() => {
              const all = Object.fromEntries(eligible.map((m) => [m.meetingId, current(m.meetingId)]))
              const before = Object.fromEntries(eligible.map((m) => [m.meetingId, m.reportTaskId]))
              const opts = confirmReallocation(data.reports, before, all, override)
              if (!opts) return
              run(() => saveFeedbackReportAssignments(eventId, all, opts), "Meeting assignments saved.")
            }}
          >
            {dirty ? "Save assignments" : "Confirm assignments"}
          </button>
        )}
        {dirty && (
          <button type="button" className={BTN} disabled={busy} onClick={() => setDraft(null)}>
            Cancel
          </button>
        )}
        <span className="ml-auto" />
        <OverrideLockButton reports={data.reports} on={override} onChange={setOverride} className={BTN} disabled={busy} />
      </div>
    </>,
  )
}

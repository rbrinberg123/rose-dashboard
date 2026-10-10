"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronRight } from "lucide-react"

import { STATUS_PILL_LIGHT, TEXT_MUTED, TEXT_PRIMARY, TEXT_TERTIARY } from "@/lib/design"
import { reportAccent } from "@/lib/feedback-reports/accents"
import { cn } from "@/lib/utils"
import { MAX_REPORTS_PER_EVENT } from "@/lib/feedback-reports/policy"
import {
  addFeedbackReport,
  deleteFeedbackReport,
  loadEventFeedbackReports,
  saveFeedbackReportAssignments,
  type EventFeedbackReports,
  type FeedbackReportMeeting,
  type FeedbackReportSummary,
} from "./feedback-report-actions"
import {
  FeedbackFlagPill,
  OverrideLockButton,
  ReportLockMark,
  confirmReallocation,
  reportSelectable,
} from "./report-locks"

/**
 * Edit Event dialog → 4th column, "Meetings & Reports". The event's meetings
 * grouped under the feedback report each belongs to (A → B → C), with the SAME
 * split / move controls as the drawer's Feedback reports section
 * (feedback-reports-panel.tsx) — same model, same server actions, same guards:
 *   - Split = addFeedbackReport (max MAX_REPORTS_PER_EVENT, server-checked);
 *   - move = a per-meeting A / B / C selector held as a draft, applied with
 *     saveFeedbackReportAssignments (every eligible meeting in exactly one
 *     report — validated server-side); "Confirm assignments" clears the
 *     auto-added markers left by auto-routing;
 *   - Delete = deleteFeedbackReport (unclaimed + open only; its meetings move).
 * Moved rows jump to their new group straight away (the draft); nothing is
 * written until Save.
 *
 * DATA: loadEventFeedbackReports — report tasks (tasks.feedback_report_seq) +
 * the feedback_report_meetings mapping. Eligibility is isEligibleMeeting
 * (= SQL feedback_meeting_is_eligible): cancelled / inactive meetings sit in a
 * subtle "Cancelled / inactive" group, never in a report.
 *
 * FEEDBACK FLAG per meeting = the meeting's OWN feedback status, from the
 * definitive meetings.feedback_status_label (FeedbackFlagPill): blank → Not in ·
 * Awaiting Additional → Waiting · Closed - No Feedback → No feedback ·
 * Closed - All in → Feedback in.
 *
 * LOCKS (report-locks.tsx; enforced server-side): a CLAIMED / closed report is
 * hard-locked (lock icon; its rows' pickers and its option are disabled), an
 * all-feedback-in unclaimed report is warm (warn icon; Save asks to confirm).
 * "Override lock" (admin) re-enables the locked controls; the save is audited.
 *
 * These writes are immediate and independent of the event form: every button
 * is type="button", and the panel holds no form state, so it never submits or
 * changes the event save.
 */

const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })

/* Report accents, A / B / C — shared with Feedback Reports (lib/feedback-reports/accents.ts). */

const BTN =
  "inline-flex h-7 items-center rounded-md border border-input bg-background px-2 text-xs font-medium " +
  "text-foreground transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"

/** Status dot: Done (date passed) green · Confirmed amber · Pending / TBR grey. */
function statusDot(m: FeedbackReportMeeting, now: number): { color: string; label: string } {
  if (!m.eligible) return { color: "#D5DBE7", label: m.status ?? "Cancelled" }
  if (m.date && new Date(m.date).getTime() < now) return { color: STATUS_PILL_LIGHT.positive.text, label: "Done" }
  if (m.status === "Confirmed") return { color: "#D99A1E", label: "Confirmed" }
  return { color: TEXT_TERTIARY, label: m.status ?? "Pending" }
}

/** The report's status line — the same wording as the Feedback reports section. */
function reportStatus(r: FeedbackReportSummary): string {
  if (r.state !== "Open") return r.state ?? "—"
  return r.receivedDate ? "Feedback received" : "Awaiting feedback"
}

export function MeetingsReportsPanel({ eventId }: { eventId: string }) {
  const [data, setData] = React.useState<EventFeedbackReports | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Record<string, string> | null>(null)
  const [busy, startTransition] = React.useTransition()
  const [reloadKey, setReloadKey] = React.useState(0)
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set(["cancelled"]))
  const [now] = React.useState(() => Date.now())
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

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const reload = () => {
    setReloadKey((k) => k + 1)
    router.refresh()
  }
  function run(call: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    if (!data) return
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

  const shell = (body: React.ReactNode, header?: React.ReactNode, footer?: React.ReactNode) => (
    <div className="flex max-h-[62vh] min-h-0 flex-col overflow-hidden rounded-lg border border-[#E5E8EC] bg-[#FBFCFD]">
      <div className="flex items-baseline gap-2 border-b border-[#E5E8EC] px-3 py-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: TEXT_MUTED }}>
          Meetings &amp; Reports
        </h3>
        {header}
      </div>
      {/* Scrolls on its own — never lengthens the form. */}
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      {footer}
    </div>
  )

  if (error) return shell(<p className="px-3 py-3 text-xs text-destructive">{error}</p>)
  if (!data) return shell(<p className="px-3 py-6 text-center text-xs" style={{ color: TEXT_MUTED }}>Loading…</p>)
  if (!data.inScope) {
    return shell(
      <p className="px-3 py-3 text-xs" style={{ color: TEXT_MUTED }}>
        Feedback reports aren&apos;t automated for this event.
      </p>,
    )
  }
  if (data.setupMissing) {
    return shell(
      <p className="px-3 py-3 text-xs" style={{ color: TEXT_MUTED }}>
        Switched off until <code>sql/patches/2026-10-07b_feedback_report_automation.sql</code> is run.
      </p>,
    )
  }

  // Same draft model as the Feedback reports section.
  const eligible = data.meetings.filter((m) => m.eligible)
  const current = (id: string) => draft?.[id] ?? data.meetings.find((m) => m.meetingId === id)?.reportTaskId ?? ""
  const dirty = draft !== null
  const autoRouted = eligible.filter((m) => m.autoRouted).length
  const reportIds = new Set(data.reports.map((r) => r.taskId))
  const savedLocked = (taskId: string | null) => data.reports.find((r) => r.taskId === taskId && r.lock === "hard")
  const move = (meetingId: string, taskId: string) =>
    setDraft((d) => ({
      ...Object.fromEntries(eligible.map((x) => [x.meetingId, current(x.meetingId)])),
      ...(d ?? {}),
      [meetingId]: taskId,
    }))

  const header = (
    <span className="ml-auto text-[11px] tabular-nums" style={{ color: TEXT_TERTIARY }}>
      {eligible.length} meeting{eligible.length === 1 ? "" : "s"} · {data.reports.length} report
      {data.reports.length === 1 ? "" : "s"}
    </span>
  )

  const footer = (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-[#E5E8EC] px-3 py-2">
      <button
        type="button"
        className={BTN}
        disabled={busy || dirty || data.reports.length === 0 || data.reports.length >= MAX_REPORTS_PER_EVENT}
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
  )

  if (data.reports.length === 0) {
    return shell(
      <p className="px-3 py-3 text-xs" style={{ color: TEXT_MUTED }}>
        No feedback report for this event (it was created before the automation was switched on).
      </p>,
      header,
    )
  }

  const groups = data.reports.map((r) => ({
    key: r.taskId,
    report: r as FeedbackReportSummary | null,
    title: `Report ${r.letter}`,
    accent: reportAccent(r.seq),
    rows: eligible.filter((m) => current(m.meetingId) === r.taskId),
  }))
  const unassigned = eligible.filter((m) => !reportIds.has(current(m.meetingId)))
  if (unassigned.length) {
    groups.push({ key: "unassigned", report: null, title: "Not in a report", accent: TEXT_TERTIARY, rows: unassigned })
  }
  const cancelledRows = data.meetings.filter((m) => !m.eligible)
  if (cancelledRows.length) {
    groups.push({ key: "cancelled", report: null, title: "Cancelled / inactive", accent: "#D5DBE7", rows: cancelledRows })
  }

  const body =
    data.meetings.length === 0 ? (
      <>
        {groups.map((g) => (
          <GroupHeader key={g.key} g={g} count={0} open={false} onToggle={() => {}} />
        ))}
        <p className="px-3 py-6 text-center text-xs" style={{ color: TEXT_MUTED }}>
          No meetings yet — they join the latest report automatically as they are added.
        </p>
      </>
    ) : (
      groups.map((g) => {
        const open = !collapsed.has(g.key)
        const muted = g.key === "cancelled"
        const r = g.report
        return (
          <div key={g.key} className="border-b border-[#E5E8EC] last:border-0">
            <GroupHeader
              g={g}
              count={g.rows.length}
              open={open}
              onToggle={() => toggle(g.key)}
              action={
                r && data.reports.length > 1 ? (
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer rounded px-1 text-[10px] font-medium underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
                    style={{ color: TEXT_MUTED }}
                    disabled={busy || dirty || !!r.claimedByName || r.state !== "Open"}
                    title={
                      r.claimedByName
                        ? "Claimed reports can't be deleted"
                        : r.state !== "Open"
                          ? "Only an open report can be deleted"
                          : "Delete — its meetings move to another report"
                    }
                    onClick={() => {
                      const warm = r.lock === "warm" && g.rows.length > 0
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
                ) : null
              }
            />
            {open && (
              <ul>
                {g.rows.length === 0 && (
                  <li className="px-4 py-1.5 text-[11px]" style={{ color: TEXT_TERTIARY }}>
                    No meetings in this report.
                  </li>
                )}
                {g.rows.map((m) => {
                  const dot = statusDot(m, now)
                  return (
                    <li
                      key={m.meetingId}
                      className={cn("flex items-center gap-1.5 py-1 pl-3 pr-2 text-xs hover:bg-[#F3F5F8]", muted && "opacity-60")}
                    >
                      <span className="w-10 shrink-0 tabular-nums" style={{ color: TEXT_MUTED }}>
                        {m.date ? ET_DAY.format(new Date(m.date)) : "—"}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate"
                        style={{ color: TEXT_PRIMARY }}
                        title={[m.institution, m.investor].filter(Boolean).join(" · ")}
                      >
                        {m.institution ?? "Meeting"}
                        {m.investor && <span style={{ color: TEXT_MUTED }}> · {m.investor}</span>}
                        {m.autoRouted && !draft?.[m.meetingId] && (
                          <span style={{ color: STATUS_PILL_LIGHT.watch.text }} title="Added automatically after the split — please check">
                            {" "}· auto
                          </span>
                        )}
                      </span>
                      <FeedbackFlagPill status={m.feedbackStatus} receivedDate={m.feedbackReceivedDate} />
                      {m.eligible && data.reports.length > 1 && (
                        <select
                          aria-label={`Report for ${m.institution ?? "meeting"}`}
                          value={current(m.meetingId)}
                          // A meeting in a hard-locked report can't move out (admin override).
                          disabled={busy || (!!savedLocked(m.reportTaskId) && !override)}
                          title={savedLocked(m.reportTaskId) && !override ? "Its report is claimed — locked" : undefined}
                          onChange={(e) => move(m.meetingId, e.target.value)}
                          className="h-6 shrink-0 rounded border border-input bg-background px-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {!current(m.meetingId) && <option value="">—</option>}
                          {data.reports.map((rep) => (
                            <option
                              key={rep.taskId}
                              value={rep.taskId}
                              // Nothing can be added to a hard-locked report (admin override).
                              disabled={rep.taskId !== current(m.meetingId) && !reportSelectable(rep, override)}
                            >
                              {rep.letter}
                              {rep.lock === "hard" ? " · locked" : ""}
                            </option>
                          ))}
                        </select>
                      )}
                      <span
                        aria-label={dot.label}
                        title={dot.label}
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: dot.color }}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })
    )

  return shell(body, header, footer)
}

function GroupHeader({
  g,
  count,
  open,
  onToggle,
  action,
}: {
  g: { key: string; report: FeedbackReportSummary | null; title: string; accent: string }
  count: number
  open: boolean
  onToggle: () => void
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1 border-l-[3px] pr-2 hover:bg-[#F3F5F8]" style={{ borderLeftColor: g.accent }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 pl-2 text-left text-xs"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} style={{ color: TEXT_TERTIARY }} />
        <span className="shrink-0 font-semibold" style={{ color: g.key === "cancelled" ? TEXT_MUTED : TEXT_PRIMARY }}>
          {g.title}
        </span>
        {g.report && <ReportLockMark report={g.report} />}
        {g.report && (
          <span className="truncate text-[11px]" style={{ color: TEXT_MUTED }}>
            · {reportStatus(g.report)}
            {g.report.claimed && g.report.claimedByName ? ` · ${g.report.claimedByName}` : ""}
          </span>
        )}
      </button>
      {action}
      <span
        className="shrink-0 rounded-full px-1.5 text-[10px] font-semibold tabular-nums"
        style={{ backgroundColor: STATUS_PILL_LIGHT.neutral.bg, color: STATUS_PILL_LIGHT.neutral.text }}
      >
        {count}
      </span>
    </div>
  )
}

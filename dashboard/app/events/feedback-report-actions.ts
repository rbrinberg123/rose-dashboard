"use server"

import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { recordAudit } from "@/lib/audit"
import { easternLocalToIso, isUuid, requireCrmWriter } from "@/lib/crm-write"
import {
  checkReallocation,
  decideAddReport,
  decideDeleteReport,
  decideReallocation,
  deleteTarget,
  isAutomationOrigin,
  isEligibleMeeting,
  reportLetter,
  reportLock,
  validateAssignments,
  validateReceivedDay,
  type ReportLock,
} from "@/lib/feedback-reports/policy"

/**
 * Events drawer → "Feedback reports" panel: view, Split (add a report),
 * reassign meetings, delete an unclaimed report.
 *
 * GATES: reading needs the effective role super_user (the /events page's own
 * gate); every WRITE goes through requireCrmWriter (super user, not in "View
 * as") — the same gate as creating / editing the event itself. The database
 * functions re-check every structural rule (one report per meeting, own event
 * only, max 3, last report kept, unclaimed delete) inside one transaction.
 *
 * Reports are dashboard-origin Feedback tasks the automation created, so these
 * are ordinary dashboard edits — no Dynamics row is ever written.
 *
 * RE-ALLOCATION LOCKS (2026-10-10) — enforced HERE, server-side, on fresh data
 * (the service-role client bypasses RLS, so the UI is never the guard):
 *   - hard lock (report CLAIMED, or no longer Open): no meeting moves out of it
 *     and none is added to it — saveFeedbackReportAssignments and
 *     deleteFeedbackReport refuse, unless `overrideLock` is passed by an admin
 *     (super user); every override writes its own audit row
 *     (entity feedback_report_lock_override).
 *   - warm lock (all feedback in = Feedback Received Date set, NOT claimed):
 *     allowed only with `confirmWarm`.
 * Rules: reportLock / checkReallocation / decideReallocation in
 * lib/feedback-reports/policy.ts. New meetings never auto-route into a hard-
 * locked report — that is the database trigger
 * (sql/patches/2026-10-10_feedback_report_locks.sql).
 */

const PATHS = ["/events", "/feedback-manager", "/fb-coming-soon", "/my-dashboard"]

export type FeedbackReportSummary = {
  taskId: string
  seq: number
  letter: string
  subject: string | null
  state: string | null
  claimedByName: string | null
  /** claimed_by_id or bcs_claimed_by_id set — the claim feature's sidecar. */
  claimed: boolean
  dueDate: string | null
  receivedDate: string | null
  /** Re-allocation lock — see reportLock. */
  lock: ReportLock
}

export type FeedbackReportMeeting = {
  meetingId: string
  date: string | null
  institution: string | null
  investor: string | null
  status: string | null
  /** The meeting's OWN feedback status (meetings.feedback_status_label) + FB Received date. */
  feedbackStatus: string | null
  feedbackReceivedDate: string | null
  eligible: boolean
  reportTaskId: string | null
  autoRouted: boolean
}

export type EventFeedbackReports = {
  /** The event is in the automation's scope (dashboard-origin today). */
  inScope: boolean
  reports: FeedbackReportSummary[]
  meetings: FeedbackReportMeeting[]
  /** The 2026-10-07b SQL patch has not been run yet. */
  setupMissing: boolean
}

function missingSetup(message: string): boolean {
  return /feedback_report_seq|feedback_report_meetings|feedback_report_|does not exist/.test(message)
}

export async function loadEventFeedbackReports(eventId: string): Promise<ActionResult<EventFeedbackReports>> {
  if ((await getEffectiveRole()) !== "super_user") return fail("Not authorised.")
  if (!isUuid(eventId)) return fail("Unknown event.")
  const sb = getSupabaseServer()

  const { data: ev, error: evErr } = await sb.from("events").select("event_id, origin").eq("event_id", eventId).maybeSingle()
  if (evErr) return fail(describeError(evErr))
  if (!ev) return fail("That event no longer exists.")
  const inScope = isAutomationOrigin(ev.origin as string | null)
  if (!inScope) return ok({ inScope, reports: [], meetings: [], setupMissing: false })

  const [repRes, mtgRes, mapRes] = await Promise.all([
    sb
      .from("tasks")
      .select(
        "task_id, feedback_report_seq, subject, state_label, bcs_claimed_by_id, bcs_claimed_by_name, claimed_by_id, claimed_by_name, scheduled_end, crdfa_feedback_received_date",
      )
      .eq("bcs_event_id", eventId)
      .not("feedback_report_seq", "is", null)
      .order("feedback_report_seq"),
    sb
      .from("meetings")
      .select("meeting_id, meeting_date, institution_name, investor_text, meeting_status_label, state_label, feedback_status_label, fb_received_date")
      .eq("event_id", eventId)
      .order("meeting_date", { ascending: true, nullsFirst: false }),
    sb.from("feedback_report_meetings").select("meeting_id, report_task_id, auto_routed").eq("event_id", eventId),
  ])
  const firstErr = repRes.error ?? mtgRes.error ?? mapRes.error
  if (firstErr) {
    if (missingSetup(firstErr.message)) return ok({ inScope, reports: [], meetings: [], setupMissing: true })
    return fail(describeError(firstErr))
  }

  const map = new Map(
    ((mapRes.data ?? []) as { meeting_id: string; report_task_id: string; auto_routed: boolean }[]).map((m) => [
      m.meeting_id,
      m,
    ]),
  )
  const reports: FeedbackReportSummary[] = (
    (repRes.data ?? []) as {
      task_id: string
      feedback_report_seq: number
      subject: string | null
      state_label: string | null
      bcs_claimed_by_id: string | null
      bcs_claimed_by_name: string | null
      claimed_by_id: string | null
      claimed_by_name: string | null
      scheduled_end: string | null
      crdfa_feedback_received_date: string | null
    }[]
  ).map((r) => {
    const claimed = !!(r.claimed_by_id ?? r.bcs_claimed_by_id)
    return {
      taskId: r.task_id,
      seq: r.feedback_report_seq,
      letter: reportLetter(r.feedback_report_seq),
      subject: r.subject,
      state: r.state_label,
      claimedByName: r.claimed_by_name ?? r.bcs_claimed_by_name,
      claimed,
      dueDate: r.scheduled_end,
      receivedDate: r.crdfa_feedback_received_date,
      lock: reportLock({ state: r.state_label, claimed, receivedDate: r.crdfa_feedback_received_date }),
    }
  })
  const meetings: FeedbackReportMeeting[] = (
    (mtgRes.data ?? []) as {
      meeting_id: string
      meeting_date: string | null
      institution_name: string | null
      investor_text: string | null
      feedback_status_label: string | null
      fb_received_date: string | null
      meeting_status_label: string | null
      state_label: string | null
    }[]
  ).map((m) => ({
    meetingId: m.meeting_id,
    date: m.meeting_date,
    institution: m.institution_name,
    investor: m.investor_text,
    feedbackStatus: m.feedback_status_label,
    feedbackReceivedDate: m.fb_received_date,
    status: m.meeting_status_label,
    eligible: isEligibleMeeting(m.meeting_status_label, m.state_label),
    reportTaskId: map.get(m.meeting_id)?.report_task_id ?? null,
    autoRouted: map.get(m.meeting_id)?.auto_routed === true,
  }))
  return ok({ inScope, reports, meetings, setupMissing: false })
}

/** Shared write front half: gate, event exists, in scope. */
async function writeGate(eventId: string): Promise<ActionResult<{ reports: FeedbackReportSummary[]; meetings: FeedbackReportMeeting[] }>> {
  const gate = await requireCrmWriter("changing feedback reports")
  if (!gate.ok) return fail(gate.error)
  const loaded = await loadEventFeedbackReports(eventId)
  if (!loaded.ok) return loaded
  if (loaded.data.setupMissing) return fail("Feedback reports need the 2026-10-07b SQL patch run first.")
  if (!loaded.data.inScope) return fail("Feedback reports are automated for dashboard-created events only (until cutover).")
  return ok({ reports: loaded.data.reports, meetings: loaded.data.meetings })
}

function revalidate() {
  for (const p of PATHS) revalidatePath(p)
}

/** SPLIT: physically create another Feedback report task for the event. */
export async function addFeedbackReport(eventId: string): Promise<ActionResult<{ taskId: string }>> {
  const pre = await writeGate(eventId)
  if (!pre.ok) return pre
  const reason = decideAddReport(pre.data.reports.length)
  if (reason) return fail(reason)

  const { data, error } = await getSupabaseServer().rpc("feedback_report_add", { p_event: eventId })
  if (error) return fail(describeError(error))
  // The database writes its own audit row for the created task; this one records
  // WHO asked for the split.
  await recordAudit({
    action: "create",
    entity: "feedback_report_split",
    recordId: String(data),
    changes: { event_id: eventId, report_count: pre.data.reports.length + 1 },
    context: "/events · Split feedback report",
  })
  revalidate()
  return ok({ taskId: String(data) })
}

/** Reassign meetings across the event's reports (the whole set at once). */
export type ReallocationOptions = {
  /** The user confirmed moving meetings of an all-feedback-in (warm) report. */
  confirmWarm?: boolean
  /** Admin override of a claimed / closed (hard-locked) report. Audited. */
  overrideLock?: boolean
}

/** Audit an admin's override of a hard lock (a separate row, easy to find). */
async function auditOverride(eventId: string, what: string, details: Record<string, unknown>) {
  await recordAudit({
    action: "update",
    entity: "feedback_report_lock_override",
    recordId: eventId,
    changes: { action: what, ...details },
    context: "/events · Feedback report lock override (admin)",
  })
}

export async function saveFeedbackReportAssignments(
  eventId: string,
  assignments: Record<string, string>,
  opts: ReallocationOptions = {},
): Promise<ActionResult> {
  const pre = await writeGate(eventId)
  if (!pre.ok) return pre
  const { reports, meetings } = pre.data
  const reason = validateAssignments(
    meetings.filter((m) => m.eligible).map((m) => m.meetingId),
    reports.map((r) => r.taskId),
    assignments,
  )
  if (reason) return fail(reason)

  const before = Object.fromEntries(meetings.filter((m) => m.reportTaskId).map((m) => [m.meetingId, m.reportTaskId]))
  // LOCKS, judged on the freshly loaded reports — never on what the browser sent.
  const check = checkReallocation(reports, before, assignments)
  const isAdmin = (await getEffectiveRole()) === "super_user"
  const lockReason = decideReallocation(check, { ...opts, isAdmin })
  if (lockReason) return fail(lockReason)
  const { error } = await getSupabaseServer().rpc("feedback_report_set_assignments", {
    p_event: eventId,
    p_assignments: assignments,
  })
  if (error) return fail(describeError(error))

  const letter = (id: string | null) => reports.find((r) => r.taskId === id)?.letter ?? null
  const moved = Object.entries(assignments)
    .filter(([m, r]) => before[m] !== r)
    .map(([m, r]) => ({ meeting_id: m, from: letter(before[m] ?? null), to: letter(r) }))
  await recordAudit({
    action: "update",
    entity: "feedback_report_meetings",
    recordId: eventId,
    changes: { moved, ...(check.warmLetters.length > 0 ? { warm_confirmed: check.warmLetters } : {}) },
    context: "/events · Feedback report assignments",
  })
  if (check.hard.length > 0) {
    await auditOverride(eventId, "reassign meetings", {
      locked_reports: check.hardLetters,
      moved: check.hard.map((h) => ({ meeting_id: h.meetingId, from: letter(h.from), to: letter(h.to) })),
    })
  }
  revalidate()
  return ok()
}

/** Delete an unclaimed, open report; its meetings move to another report. */
export async function deleteFeedbackReport(
  eventId: string,
  reportTaskId: string,
  opts: ReallocationOptions = {},
): Promise<ActionResult> {
  if (!isUuid(reportTaskId)) return fail("Unknown report.")
  const pre = await writeGate(eventId)
  if (!pre.ok) return pre
  const { reports, meetings } = pre.data
  const report = reports.find((r) => r.taskId === reportTaskId)
  if (!report) return fail("That report isn't on this event.")
  const reason = decideDeleteReport(
    { taskId: report.taskId, state: report.state, claimed: report.claimed },
    reports.length,
  )
  if (reason) return fail(reason)

  // Its meetings must land on a report that is NOT hard-locked. They are moved
  // first, through the assignment RPC, so the delete RPC itself moves nothing
  // (its own target pick does not know about claims).
  const leaving = meetings.filter((m) => m.eligible && m.reportTaskId === reportTaskId)
  if (leaving.length > 0) {
    if (report.lock === "warm" && !opts.confirmWarm) {
      return fail(`All feedback is in for Report ${report.letter} — confirm to reallocate anyway.`)
    }
    let target = deleteTarget(reports, reportTaskId)
    if (!target) {
      if (!opts.overrideLock) {
        return fail("Every other report is claimed or closed, so its meetings have nowhere to go. An admin can override.")
      }
      if ((await getEffectiveRole()) !== "super_user") return fail("Only an admin can override a claimed report's lock.")
      target = reports.find((r) => r.taskId !== reportTaskId)?.taskId ?? null
      if (!target) return fail("An event must keep at least one feedback report.")
      await auditOverride(eventId, "delete report into a locked report", {
        deleted: report.letter,
        into: reports.find((r) => r.taskId === target)?.letter ?? null,
        meetings: leaving.map((m) => m.meetingId),
      })
    }
    const dest = target
    const all = Object.fromEntries(
      // Every eligible meeting must be assigned (the RPC's rule): the leaving
      // ones — and any left unassigned by locked routing — go to `dest`.
      meetings
        .filter((m) => m.eligible)
        .map((m) => [m.meetingId, !m.reportTaskId || m.reportTaskId === reportTaskId ? dest : m.reportTaskId]),
    )
    const { error: mvErr } = await getSupabaseServer().rpc("feedback_report_set_assignments", {
      p_event: eventId,
      p_assignments: all,
    })
    if (mvErr) return fail(describeError(mvErr))
  }

  const { data: target, error } = await getSupabaseServer().rpc("feedback_report_delete", { p_report: reportTaskId })
  if (error) return fail(describeError(error))
  await recordAudit({
    action: "delete",
    entity: "tasks",
    recordId: reportTaskId,
    changes: { subject: report.subject, feedback_report_seq: report.seq, meetings_moved_to: String(target) },
    context: "/events · Delete feedback report",
  })
  revalidate()
  return ok()
}

/**
 * MARK FEEDBACK RECEIVED — the step that moves a report from FB Coming Soon
 * into the claimable pool on Feedback Reports. Sets the Feedback Received Date
 * (the field v_feedback_pipeline keys on) at Eastern midnight of `day`, plus the
 * legacy "Feedback Received" flag, exactly as the Tasks form does.
 *
 * GATE: requireCrmWriter (super user, not "View as") — the same permission that
 * sets the received date anywhere else today. Only an Open, in-scope
 * (dashboard-origin until cutover) Feedback task with no received date yet;
 * the UPDATE repeats those conditions and must touch exactly one row.
 */
export async function markFeedbackReceived(taskId: string, day: string): Promise<ActionResult> {
  const gate = await requireCrmWriter("marking feedback received")
  if (!gate.ok) return fail(gate.error)
  if (!isUuid(taskId)) return fail("Unknown task.")
  // Today and any past Eastern day are accepted; empty / impossible / future
  // refused (pure rule, unit-tested in lib/feedback-reports/policy.test.ts).
  const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date())
  const dayError = validateReceivedDay(day, todayET)
  if (dayError) return fail(dayError)

  const sb = getSupabaseServer()
  const { data: t, error } = await sb
    .from("tasks")
    .select("task_id, origin, state_label, bcs_task_subtype_label, crdfa_feedback_received_date, subject")
    .eq("task_id", taskId)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!t) return fail("That task no longer exists.")
  if (t.bcs_task_subtype_label !== "Feedback") return fail("Only a Feedback report can be marked received.")
  if (!isAutomationOrigin(t.origin as string | null)) {
    return fail("This report is managed in Dynamics until cutover.")
  }
  if (t.state_label !== "Open") return fail("This report is already closed.")
  if (t.crdfa_feedback_received_date) return fail("Feedback is already marked received for this report.")

  const receivedIso = easternLocalToIso(`${day}T00:00`)
  const now = new Date().toISOString()
  const { data: updated, error: upErr } = await sb
    .from("tasks")
    .update({
      crdfa_feedback_received_date: receivedIso,
      bcs_feedback_received: true,
      modified_on: now,
      modified_by_id: gate.userId,
      modified_by_name: gate.name,
    })
    .eq("task_id", taskId)
    .eq("state_label", "Open")
    .eq("bcs_task_subtype_label", "Feedback")
    .eq("origin", t.origin as string)
    .is("crdfa_feedback_received_date", null)
    .select("task_id")
  if (upErr) return fail(describeError(upErr))
  if (!updated || updated.length !== 1) {
    return fail("This report changed while you were looking at it — refresh and try again.")
  }

  await recordAudit({
    action: "update",
    entity: "tasks",
    recordId: taskId,
    changes: {
      crdfa_feedback_received_date: { from: null, to: receivedIso },
      bcs_feedback_received: { from: false, to: true },
    },
    context: "feedback-report:mark-received",
  })
  revalidate()
  return ok()
}

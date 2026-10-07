import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { ListTitleCard } from "@/components/page-masthead"
import { canAccessRoute } from "@/lib/access-control"
import { getEffectiveRole } from "@/lib/effective-identity"
import { getAllowedRoutes } from "@/lib/page-access"
import { getSupabaseServer } from "@/lib/supabase"
import { CARD_CLASS, STATUS_PILL_LIGHT, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import { isEligibleMeeting, reportLetter } from "@/lib/feedback-reports/policy"
import { getEffectiveIdentity } from "@/lib/effective-identity"
import { ComingSoonTable, type ComingSoonRow } from "./coming-soon-table"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "FB Coming Soon" }

const ROUTE = "/fb-coming-soon"

/**
 * Logistics → FB Coming Soon (WORK IN PROGRESS). The feedback-pipeline WORKING
 * HUB: Feedback reports still AWAITING FEEDBACK — Open Feedback tasks with no
 * Feedback Received Date — from BOTH origins:
 *   Dashboard — reports the event automation created (lib/feedback-reports).
 *   Dynamics  — Feedback tasks synced from the CRM (Dynamics events create
 *               their own; the automation never duplicates them).
 *
 * ACTIONS (dashboard rows only, super users, not in "View as" — all re-checked
 * server-side): Mark received (markFeedbackReceived) and Open event (the Events
 * drawer in place, with the Split panel and per-report Mark received). Dynamics
 * rows are view-only. Nothing here CLAIMS: claiming happens on Feedback Reports
 * once feedback is received, dashboard-origin only until cutover.
 * The auto-create automation stays dashboard-origin only (SQL switch
 * feedback_automation_includes_dynamics()).
 *
 * GATING: super-user only via ADMIN_ONLY_ROUTES (lib/access-control.ts) — the
 * one-line flag. proxy.ts enforces it; the re-check below is defence in depth.
 */
export default async function FbComingSoonPage() {
  const [role, identity] = await Promise.all([getEffectiveRole(), getEffectiveIdentity()])
  const allowed = await getAllowedRoutes(role)
  if (!canAccessRoute(role, ROUTE, allowed)) redirect(allowed[0] ?? "/no-access")

  const sb = getSupabaseServer()
  const [taskRes, mapRes] = await Promise.all([
    sb
      .from("tasks")
      .select(
        "task_id, origin, subject, bcs_account_id, bcs_account_name, bcs_event_id, bcs_event_name, regarding_id, regarding_name, regarding_type, scheduled_end, claimed_by_name, bcs_claimed_by_name, feedback_report_seq, is_test",
      )
      .eq("bcs_task_subtype_label", "Feedback")
      .eq("state_label", "Open")
      .is("crdfa_feedback_received_date", null)
      .order("scheduled_end", { ascending: true, nullsFirst: false })
      .limit(1000),
    sb.from("feedback_report_meetings").select("report_task_id"),
  ])

  type Row = {
    task_id: string
    origin: string | null
    subject: string | null
    bcs_account_id: string | null
    bcs_account_name: string | null
    bcs_event_id: string | null
    bcs_event_name: string | null
    regarding_id: string | null
    regarding_name: string | null
    regarding_type: string | null
    scheduled_end: string | null
    claimed_by_name: string | null
    bcs_claimed_by_name: string | null
    feedback_report_seq: number | null
    is_test: boolean | null
  }
  const allRows = (taskRes.data ?? []) as Row[]
  const setupMissing = !!taskRes.error && /feedback_report_seq|claimed_by_name/.test(taskRes.error.message)

  // The task's event — the same key the pipeline uses (event, else regarding).
  const eventOf = (r: Row) => r.bcs_event_id ?? (r.regarding_type === "bcs_event" ? r.regarding_id : null)

  // Meeting counts. A report with a meeting mapping (dashboard automation)
  // counts ITS meetings; any other task counts its event's non-cancelled,
  // active meetings — the only grouping a Dynamics task has.
  const mapped = new Map<string, number>()
  for (const m of (mapRes.data ?? []) as { report_task_id: string }[]) {
    mapped.set(m.report_task_id, (mapped.get(m.report_task_id) ?? 0) + 1)
  }
  // Every event on the page: its eligible-meeting count AND its status/stage,
  // which drive the event-level filters below.
  const eventIds = [...new Set(allRows.map(eventOf).filter(Boolean) as string[])]
  const perEvent = new Map<string, number>()
  const eventInfo = new Map<string, { state: string | null; stage: string | null }>()
  for (let i = 0; i < eventIds.length; i += 150) {
    const chunk = eventIds.slice(i, i + 150)
    const [mRes, eRes] = await Promise.all([
      sb.from("meetings").select("event_id, meeting_status_label, state_label").in("event_id", chunk).limit(5000),
      sb.from("events").select("event_id, state_label, event_state_label").in("event_id", chunk),
    ])
    for (const m of (mRes.data ?? []) as { event_id: string; meeting_status_label: string | null; state_label: string | null }[]) {
      if (isEligibleMeeting(m.meeting_status_label, m.state_label)) {
        perEvent.set(m.event_id, (perEvent.get(m.event_id) ?? 0) + 1)
      }
    }
    for (const e of (eRes.data ?? []) as { event_id: string; state_label: string | null; event_state_label: string | null }[]) {
      eventInfo.set(e.event_id, { state: e.state_label, stage: e.event_state_label })
    }
  }

  // EVENT-LEVEL FILTERS (both origins). A report is listed only when its event
  // is Active (events.state_label), is past Pre-Launch / Live Outreach
  // (events.event_state_label), and has at least one meeting (non-cancelled,
  // active — the same count as the Meetings column at event level). A task
  // with no linked event can't pass, so it is left out.
  const EXCLUDED_STAGES = new Set(["Pre-Launch", "Live Outreach"])
  const rows = allRows.filter((r) => {
    const ev = eventOf(r)
    if (!ev) return false
    const info = eventInfo.get(ev)
    if (!info || info.state !== "Active") return false
    if (info.stage && EXCLUDED_STAGES.has(info.stage)) return false
    return (perEvent.get(ev) ?? 0) > 0
  })
  const hiddenCount = allRows.length - rows.length
  const meetingCount = (r: Row) => {
    if (mapped.has(r.task_id)) return mapped.get(r.task_id) ?? 0
    const ev = eventOf(r)
    return ev ? (perEvent.get(ev) ?? 0) : null
  }

  const dashboardCount = rows.filter((r) => r.origin === "dashboard").length
  const dynamicsCount = rows.length - dashboardCount
  // Serialisable rows for the interactive table.
  const items: ComingSoonRow[] = rows.map((r) => ({
    taskId: r.task_id,
    isDynamics: r.origin !== "dashboard",
    owner: r.claimed_by_name ?? r.bcs_claimed_by_name,
    clientId: r.bcs_account_id,
    clientName: r.bcs_account_name,
    isTest: r.is_test === true,
    eventId: eventOf(r),
    eventName: r.bcs_event_name ?? r.regarding_name ?? r.subject,
    report: r.feedback_report_seq ? "Report " + reportLetter(r.feedback_report_seq) : null,
    due: r.scheduled_end,
    meetings: meetingCount(r),
  }))

  return (
    <PageShell title="FB Coming Soon" hideHeader canvas>
      <div
        className={CARD_CLASS + " mb-4 px-4 py-3 text-sm"}
        style={{ background: STATUS_PILL_LIGHT.watch.bg, color: STATUS_PILL_LIGHT.watch.text }}
      >
        <strong>Work in progress</strong> — this page is under active development and may change.
        <div className="mt-1">
          Excludes events that are inactive, in pre-launch, or in live outreach, and events with no meetings.
        </div>
      </div>

      <div className="mb-4">
        <ListTitleCard
          compact
          eyebrow="Logistics"
          title="FB Coming Soon"
          subtitle={`Feedback reports waiting on feedback — ${rows.length} shown (${dashboardCount} dashboard, ${dynamicsCount} Dynamics); ${hiddenCount} hidden by the event filters.`}
        />
      </div>

      {/* How the page works, stated where people will look for a Claim button. */}
      <div className={CARD_CLASS + " mb-4 px-4 py-3 text-[13px]"} style={{ color: TEXT_MUTED }}>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>
            <span style={{ color: TEXT_PRIMARY }}>Move reports along here:</span> <em>Mark received</em> sends a report
            to <Link href="/feedback-manager" className="underline">Feedback Reports</Link>, where it can be claimed.{" "}
            <em>Open event</em> shows the event, its feedback reports and meetings — split a report and mark the new
            one received without leaving this page.
          </li>
          <li>
            <span style={{ color: TEXT_PRIMARY }}>Nothing can be claimed from this page.</span>
          </li>
          <li>
            <span style={{ color: TEXT_PRIMARY }}>Dynamics rows are managed in Dynamics</span> — view-only until
            cutover (no mark received, split or claim).
          </li>
          <li>
            Dashboard rows are the reports created automatically for dashboard events; Dynamics events already create
            their own feedback task, so none is duplicated.
          </li>
        </ul>
      </div>

      {setupMissing ? (
        <div className={CARD_CLASS + " px-4 py-6 text-sm"} style={{ color: TEXT_MUTED }}>
          Run <code>sql/patches/2026-10-07_feedback_claims.sql</code> and{" "}
          <code>sql/patches/2026-10-07b_feedback_report_automation.sql</code> in Supabase to switch this page on.
        </div>
      ) : taskRes.error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load feedback reports — {taskRes.error.message}
        </div>
      ) : rows.length === 0 ? (
        <div className={CARD_CLASS + " px-4 py-8 text-center text-sm"} style={{ color: TEXT_MUTED }}>
          {hiddenCount > 0
            ? `No feedback reports to show — ${hiddenCount} waiting on feedback are hidden by the event filters.`
            : "No feedback reports are waiting on feedback."}
        </div>
      ) : (
        <ComingSoonTable rows={items} readOnly={identity.impersonated} />
      )}
    </PageShell>
  )
}

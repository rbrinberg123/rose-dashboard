/**
 * THE AUTOMATIONS REGISTRY — the single source of truth for every automation
 * in the IQ dashboard: scheduled jobs (Vercel Cron), database triggers, and
 * the event-driven feedback-report automations. Rendered on Admin →
 * Automations (app/admin/automations).
 *
 * ── RULE ───────────────────────────────────────────────────────────────────
 * Adding an automation means adding an entry here, in the same change. An
 * automation that is not in this list does not officially exist. Planned
 * entries double as the roadmap.
 *
 * Pure data, no I/O — registry.test.ts checks the shape (unique ids, every
 * Active entry names where it lives, Planned entries name no code).
 * See content/docs/06-automations.md.
 */

export type AutomationKind = "Scheduled job" | "Database trigger" | "Event-driven"
export type AutomationStatus = "Active" | "Planned"
export type AutomationApplicability =
  /** Acts on dashboard-origin records only today; extends to Dynamics-origin at cutover. */
  | "Dashboard now · Dynamics at cutover"
  /** Works on Dynamics data (the mirror) — the sync side. */
  | "Dynamics data"
  /** Not origin-specific: applies to every row it touches. */
  | "All records"
  /** App / admin housekeeping, not CRM records. */
  | "App housekeeping"

export type Automation = {
  id: string
  name: string
  kind: AutomationKind
  /** What fires it. */
  trigger: string
  /** What it does. */
  effect: string
  /** Who / which records it acts on, and its guards. */
  scope: string
  applicability: AutomationApplicability
  status: AutomationStatus
  /** Where it lives (route, file, SQL patch). Empty for Planned. */
  where: string[]
  notes?: string
}

export const AUTOMATIONS: readonly Automation[] = [
  // ---------------------------------------------------------------- feedback
  {
    id: "feedback-report-auto-create",
    name: "Auto-create feedback report on event creation",
    kind: "Event-driven",
    trigger: "A new event is created (database AFTER INSERT on events).",
    effect:
      "Creates Feedback report A for the event — a Feedback task, Open, unclaimed (owner “System”), no feedback received — and maps the event's non-cancelled meetings to it. Due = last meeting date + 10 days.",
    scope:
      "origin = 'dashboard' events only (cutover switch feedback_automation_includes_dynamics() = false). Idempotent: never a second auto-created report per event. Inherits the event's test flag.",
    applicability: "Dashboard now · Dynamics at cutover",
    status: "Active",
    where: [
      "sql/patches/2026-10-07b_feedback_report_automation.sql — trg_events_auto_feedback_report, feedback_report_create",
    ],
    notes: "Shows on Logistics → FB Coming Soon until feedback is received; then on Feedback Reports, claimable.",
  },
  {
    id: "feedback-report-meeting-routing",
    name: "Feedback report meeting routing + due date",
    kind: "Event-driven",
    trigger: "A meeting is added, moved to another event, re-dated, cancelled / reinstated, deactivated or deleted (trigger on meetings); and every Split / reassign / delete.",
    effect:
      "Keeps each meeting in exactly one of its event's reports: new or reinstated meetings go to the LATEST report (flagged “auto-added” once the event is split); cancelled / inactive meetings drop out. Recomputes each open report's due date = its last meeting date + 10 days (empty with no dated meeting).",
    scope: "Meetings of events that have feedback reports (dashboard-origin today).",
    applicability: "Dashboard now · Dynamics at cutover",
    status: "Active",
    where: [
      "sql/patches/2026-10-07b_feedback_report_automation.sql — trg_meetings_feedback_routing, feedback_report_recompute_due",
      "app/events/feedback-report-actions.ts (Split panel in the event drawer)",
    ],
  },
  {
    id: "feedback-report-close-review",
    name: "Close feedback report → create Pending Review task",
    kind: "Event-driven",
    trigger: "A Feedback task changes to Completed (Close on Feedback Reports, or Tasks → Edit).",
    effect:
      "Creates “Feedback Report Pending Review – <event>” (sub-type Feedback Report Sent, Open, due close date + 2 days), linked to that exact report, so the report moves to Pending Review.",
    scope: "origin = 'dashboard' Feedback tasks. One review task per report, ever — re-closing does nothing; reopening leaves it as is.",
    applicability: "Dashboard now · Dynamics at cutover",
    status: "Active",
    where: [
      "sql/patches/2026-10-07b_feedback_report_automation.sql — trg_tasks_feedback_close_review; v_feedback_pipeline pairs by tasks.review_of_task_id",
    ],
  },
  {
    id: "feedback-report-ready-detection",
    name: "Feedback-report-ready detection",
    kind: "Event-driven",
    trigger: "Meeting-level feedback is complete for every meeting in a report.",
    effect: "Marks the report's Feedback Received Date automatically, moving it from FB Coming Soon to Feedback Reports (claimable).",
    scope: "Dashboard-origin feedback reports.",
    applicability: "Dashboard now · Dynamics at cutover",
    status: "Planned",
    where: [],
    notes: "Today feedback received is set by hand on the Tasks page.",
  },
  {
    id: "feedback-reminders",
    name: "Feedback reminders",
    kind: "Scheduled job",
    trigger: "Scheduled — wording and cadence to be decided.",
    effect: "Nudges report owners (and unclaimed-report watchers) as a feedback report approaches or passes its due date.",
    scope: "Open feedback reports.",
    applicability: "Dashboard now · Dynamics at cutover",
    status: "Planned",
    where: [],
  },

  // ---------------------------------------------------------- sync + AI jobs
  {
    id: "dynamics-sync",
    name: "Dynamics sync",
    kind: "Scheduled job",
    trigger: "Vercel Cron every 10 min, 11:00–22:00 UTC, Mon–Fri; plus Admin → Sync “Run now”.",
    effect: "Pulls 9 CRM entities from Dynamics into the mirror tables (incremental upsert by Dynamics id).",
    scope: "Dynamics-origin rows only — never inserts over or edits a dashboard-origin row.",
    applicability: "Dynamics data",
    status: "Active",
    where: ["app/api/sync-dynamics/route.ts", "lib/sync/run.ts", "app/admin/sync/actions.ts"],
  },
  {
    id: "deletion-reconcile",
    name: "Deletion reconciliation sweep",
    kind: "Scheduled job",
    trigger: "Vercel Cron daily 05:00 UTC; plus manual run on Admin → Reconciliation.",
    effect: "Finds mirror rows deleted in Dynamics and queues them for review; approving deletes them.",
    scope: "origin = 'dynamics' rows only (dashboard rows are fenced out).",
    applicability: "Dynamics data",
    status: "Active",
    where: ["app/api/reconcile-dynamics/route.ts", "lib/sync/reconcile.ts", "app/admin/reconciliation/actions.ts"],
  },
  {
    id: "ai-client-summaries",
    name: "AI client summaries refresh",
    kind: "Scheduled job",
    trigger: "Vercel Cron daily 08:00 UTC; plus Admin “Refresh all AI summaries” and npm run refresh-summaries.",
    effect: "Regenerates the AI client summary for every active client (money-free).",
    scope: "Active clients.",
    applicability: "All records",
    status: "Active",
    where: ["app/api/client-summary/refresh-all/route.ts", "lib/client-summary-refresh.ts"],
  },
  {
    id: "ai-client-health",
    name: "AI Client Health ratings",
    kind: "Scheduled job",
    trigger: "Vercel Cron Mondays 09:00 UTC, with watchdog runs 09:30 / 10:30 / 11:30 UTC.",
    effect: "Re-rates every active client's retention risk in self-chaining batches; human overrides are kept.",
    scope: "Active clients. Results super-user only.",
    applicability: "All records",
    status: "Active",
    where: ["app/api/client-health/refresh/route.ts", "lib/client-health-runs.ts"],
  },

  // ------------------------------------------------------------------ emails
  {
    id: "email-live-outreach",
    name: "Live Outreach digest email",
    kind: "Scheduled job",
    trigger: "Vercel Cron 11:30 + 12:30 UTC, Mon–Fri (DST-safe pair; sends once per day).",
    effect: "Emails the Live Outreach digest from dashboards@.",
    scope: "Once-per-day ledger: cron_send_log job live_outreach_digest.",
    applicability: "All records",
    status: "Active",
    where: ["app/api/live-outreach/send-email/route.ts"],
  },
  {
    id: "email-outstanding-feedback",
    name: "Outstanding Feedback digest email",
    kind: "Scheduled job",
    trigger: "Vercel Cron Mon 12:15 + 13:15 UTC; Tue–Fri 12:45 + 13:45 UTC (sends once per day).",
    effect: "Emails the outstanding-feedback digest.",
    scope: "cron_send_log job feedback_digest.",
    applicability: "All records",
    status: "Active",
    where: ["app/api/feedback/send-email/route.ts"],
  },
  {
    id: "email-week-ahead",
    name: "Week Ahead digest email",
    kind: "Scheduled job",
    trigger: "Vercel Cron Fridays 19:45 + 20:45 UTC (sends once).",
    effect: "Emails the coming week's schedule.",
    scope: "cron_send_log job week_ahead_digest.",
    applicability: "All records",
    status: "Active",
    where: ["app/api/week-ahead/send-email/route.ts"],
  },
  {
    id: "email-time-off",
    name: "Time Off digest email",
    kind: "Scheduled job",
    trigger: "Vercel Cron Mondays 12:00 + 13:00 UTC (sends once).",
    effect: "Emails the week's time off.",
    scope: "cron_send_log job time_off_digest.",
    applicability: "All records",
    status: "Active",
    where: ["app/api/time-off/send-email/route.ts"],
  },

  // -------------------------------------------------------- database triggers
  {
    id: "account-team-projection",
    name: "Account team → client lookups",
    kind: "Database trigger",
    trigger: "Any insert / update / delete on account_team_members (Admin → Account Teams).",
    effect: "Copies each team role onto the client's own account-team lookups, so every page sees the team.",
    scope: "origin = 'dashboard' clients only; Dynamics clients keep their CRM lookups.",
    applicability: "Dashboard now · Dynamics at cutover",
    status: "Active",
    where: ["sql/patches/2026-10-02b_account_team_dashboard_clients.sql — account_team_members_project"],
  },
  {
    id: "origin-lock",
    name: "Origin lock",
    kind: "Database trigger",
    trigger: "Before every update on the 8 writable mirror tables.",
    effect: "Forces a row's origin to stay what it was — a sync can't turn a dashboard row into a Dynamics row, or back.",
    scope: "accounts, contacts, contracts, events, meetings, tasks, touchpoints, client_notes.",
    applicability: "All records",
    status: "Active",
    where: ["sql/patches/2026-09-23_origin_ownership_fence.sql — lock_origin()"],
  },
  {
    id: "synced-at-stamp",
    name: "Synced-at stamp",
    kind: "Database trigger",
    trigger: "Before insert / update on the mirror tables.",
    effect: "Stamps _synced_at = now(), which drives sync freshness and the deletion sweep.",
    scope: "Skips dashboard-origin rows (they are not synced).",
    applicability: "Dynamics data",
    status: "Active",
    where: ["sql/patches/2026-09-23_origin_ownership_fence.sql — touch_synced_at()"],
  },
  {
    id: "audit-append-only",
    name: "Audit log is append-only",
    kind: "Database trigger",
    trigger: "Any update or delete on audit_log.",
    effect: "Refuses it — the audit trail can only grow.",
    scope: "audit_log.",
    applicability: "App housekeeping",
    status: "Active",
    where: ["sql/patches/2026-09-15c_audit_log.sql — audit_log_is_append_only"],
  },
  {
    id: "user-roles-metadata",
    name: "User-role row normalising",
    kind: "Database trigger",
    trigger: "Insert / update on the legacy user_roles table.",
    effect: "Lower-cases the email and stamps updated_at.",
    scope: "user_roles (the live role source is now user_role_grants).",
    applicability: "App housekeeping",
    status: "Active",
    where: ["sql/17_user_roles.sql — trg_user_roles_set_metadata"],
  },
]

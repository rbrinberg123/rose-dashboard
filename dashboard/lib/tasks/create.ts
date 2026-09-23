/**
 * Shared definitions for "Add New Task" — a dashboard-authored record in
 * public.tasks (swept nightly). Used by app/tasks/new-task-dialog.tsx and
 * createTask in app/tasks/actions.ts; kept out of the "use server" file.
 *
 * Option sets are the Dynamics values in use, read from the mirror 2026-09-23.
 * See content/docs/22-cutover-ownership-boundary.md.
 */

/** Whether the form's "Test record" toggle starts ON. TEST PHASE: true. */
export const NEW_TASK_TEST_DEFAULT = true

/** bcs_tasktype → its bcs_tasksubtype choices (the pairs that occur live). */
export const TASK_TYPE_OPTIONS = [
  {
    code: 755860003,
    label: "Outreach",
    subtypes: [
      { code: 755860014, label: "Marketing Memo" },
      { code: 755860017, label: "Feedback" },
      { code: 755860016, label: "Targeting" },
      { code: 755860028, label: "Feedback Report Sent" },
      { code: 755860029, label: "Schedule Upload" },
      { code: 755860000, label: "Data Upload" },
      { code: 755860027, label: "Shareholder Report Received" },
      { code: 755860019, label: "Meeting" },
      { code: 755860023, label: "General" },
    ],
  },
  {
    code: 755860002,
    label: "Advisory",
    subtypes: [
      { code: 755860005, label: "Ad hoc" },
      { code: 755860007, label: "Earnings" },
      { code: 755860008, label: "Presentation" },
      { code: 755860006, label: "Call" },
      { code: 755860010, label: "Messaging / Strategy" },
      { code: 755860011, label: "Reporting (Custom)" },
      { code: 755860012, label: "Reporting (Standard)" },
      { code: 755860026, label: "Investor Day" },
      { code: 755860013, label: "Special Project" },
      { code: 755860009, label: "Collateral (other)" },
    ],
  },
  {
    code: 755860001,
    label: "Onboarding",
    subtypes: [
      { code: 755860003, label: "Initial Call" },
      { code: 755860025, label: "General" },
    ],
  },
  { code: 755860004, label: "Internal", subtypes: [{ code: 755860025, label: "General" }] },
  { code: 755860005, label: "Reminder", subtypes: [{ code: 755860030, label: "General" }] },
] as const

/** Rose's own priority (bcs_taskpriority). The stock Dynamics priority is always "Normal". */
export const TASK_PRIORITY_OPTIONS = [
  { code: 755860002, label: "High" },
  { code: 755860001, label: "Medium" },
] as const

/** statecode / statuscode pairs in use. */
export const TASK_STATUS_OPTIONS = [
  { key: "not_started", state: 0, stateLabel: "Open", status: 2, statusLabel: "Not Started" },
  { key: "in_progress", state: 0, stateLabel: "Open", status: 3, statusLabel: "In Progress" },
  { key: "completed", state: 1, stateLabel: "Completed", status: 5, statusLabel: "Completed" },
  { key: "canceled", state: 2, stateLabel: "Canceled", status: 6, statusLabel: "Canceled" },
] as const

/** bcs_outreachtaskstatus — the values in use (2026-09-23). */
export const TASK_OUTREACH_STATUS_OPTIONS = [
  { code: 755860000, label: "Drafting" },
  { code: 755860002, label: "Draft Complete" },
  { code: 755860003, label: "Editorial Review" },
  { code: 755860005, label: "Pending Review" },
  { code: 755860004, label: "Finalizing" },
  { code: 755860006, label: "Awaiting Feedback" },
] as const

export type NewTaskInput = {
  /** accounts.account_id — REQUIRED (bcs_account on every Dynamics task). */
  clientAccountId: string | null
  subject: string
  description?: string
  typeCode: number
  subtypeCode: number
  /** TASK_PRIORITY_OPTIONS code, or null for none. */
  priorityCode: number | null
  statusKey: (typeof TASK_STATUS_OPTIONS)[number]["key"]
  /** YYYY-MM-DD, Eastern — stored as scheduled_end (the "due date"). */
  dueDate?: string
  /** "client" = regarding the account; else an events.event_id of that client. */
  regarding: "client" | string
  /** users.user_id */
  ownerId: string | null

  // ---- the rest of the drawer's editable fields ("form = drawer") ----
  /** bcs_event — one of the client's events; implied when Regarding is an event. */
  eventId?: string | null
  /** 0–100, blank = none. */
  percentComplete?: string
  /** YYYY-MM-DD (Eastern) */
  scheduledStart?: string
  actualStart?: string
  actualEnd?: string
  /** users.user_id */
  claimedById?: string | null
  currentAssignmentId?: string | null
  outreachStatusCode?: number | null
  drafting: boolean
  draftComplete: boolean
  reviewComplete: boolean
  processed: boolean
  /** LEGACY bcs_feedback_received flag — info only; the pipeline ignores it. */
  feedbackReceived: boolean
  /**
   * crdfa_feedback_received_date (YYYY-MM-DD, Eastern) — THE field that puts a
   * Feedback task into v_feedback_pipeline's Open bucket (with Status = Open).
   */
  feedbackReceivedDate?: string
  notified: boolean
  isTest: boolean
}

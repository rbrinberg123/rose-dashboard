/**
 * The task-record drawer's data shape and its FIELD DEFINITIONS.
 *
 * Same contract as lib/events/record.ts and lib/meeting-record.ts: every section
 * of the drawer renders from the `TASK_SECTIONS` list below —
 * `{ label, sourceKey, type }` — rather than hand-written JSX per field, and the
 * table's column catalog is DERIVED from the same list (lib/tasks/spec.ts) so
 * the two can never drift.
 *
 * ── EDIT-READY BY DESIGN, NOT EDITABLE ─────────────────────────────────────
 * Nothing here is writable in this pass: the pane renders each field read-only,
 * there is no form state and no write-back. The indirection is what makes
 * turning the drawer into a real editor a LOCALIZED change — swap the read-only
 * renderer for an input keyed off `type`, add form state, add a save action. The
 * section layout, labels and ordering do not move.
 *
 * Do NOT add editing without the dashboard actually becoming the system of
 * record. Today Dynamics is, and everything in this app is read-only.
 *
 * ── SOURCING NOTES ─────────────────────────────────────────────────────────
 * PRIORITY is the Rose field first, the stock one as fallback — the stock
 * `priority_label` is 'Normal' on all 3,920 live rows, so the literal
 * "priority_label, falling back to bcs_task_priority_label" would be a constant
 * column. Full reasoning in sql/patches/2026-09-11_admin_tasks.sql.
 *
 * ACTUAL START is 0% populated on live data. Kept because it is a field the
 * brief asked for; it will fill in if the CRM starts writing it.
 */

/** One task, flattened for display. Keys are the field definitions' sourceKeys. */
export type TaskRecord = {
  task_id: string
  /** Drives the Client link; null when the task carries no account. */
  client_account_id: string | null

  // Header
  subject: string | null
  task_type_label: string | null
  task_subtype_label: string | null
  status_label: string | null
  state_label: string | null

  // Task
  description: string | null
  priority_label: string | null
  percent_complete: number | null
  due_date: string | null
  scheduled_start: string | null
  actual_start: string | null
  actual_end: string | null
  created_on: string | null
  modified_on: string | null

  // Regarding & links
  regarding_name: string | null
  regarding_type: string | null
  regarding_type_label: string | null
  client_account_name: string | null
  client_ticker: string | null
  event_id: string | null
  event_name: string | null

  // People
  owner_name: string | null
  owner_id: string | null
  created_by_name: string | null
  modified_by_name: string | null
  claimed_by_name: string | null
  current_assignment_name: string | null

  // Workflow
  outreach_status_label: string | null
  drafting: boolean | null
  draft_complete: boolean | null
  review_complete: boolean | null
  processed: boolean | null
  feedback_received: boolean | null
  notified: boolean | null

  // Catalog-only raw priority columns (see the sourcing note above)
  priority_stock_label: string | null
  priority_rose_label: string | null
}

/**
 * How a field is rendered — and, later, what input it would become:
 *   text   plain value            -> text input / select
 *   date   timestamp, Eastern     -> date picker
 *   person one or more people     -> user picker (renders avatar + full name)
 *   toggle Yes/No boolean         -> switch
 *   notes  long free text         -> textarea (always full-width)
 *   link   a URL or a record link -> text input plus the link
 */
export type TaskFieldType = "text" | "date" | "person" | "toggle" | "notes" | "link"

export type TaskFieldDef = {
  label: string
  sourceKey: keyof TaskRecord
  type: TaskFieldType
}

export type TaskSectionDef = {
  key: string
  title: string
  fields: TaskFieldDef[]
}

/**
 * The drawer's sections, in order — Task, Regarding & Links, People, Workflow.
 *
 * `percent_complete` is declared `text` rather than a number type: the drawer
 * paints it as a plain value, and the FILTER type is overridden to `number` in
 * lib/tasks/spec.ts so the operator list stays integer-safe. Same split the
 * Events spec uses for `of_slots`.
 */
export const TASK_SECTIONS: TaskSectionDef[] = [
  {
    key: "task",
    title: "Task",
    fields: [
      { label: "Subject", sourceKey: "subject", type: "text" },
      { label: "Description", sourceKey: "description", type: "notes" },
      { label: "Task Type", sourceKey: "task_type_label", type: "text" },
      { label: "Sub-type", sourceKey: "task_subtype_label", type: "text" },
      { label: "Priority", sourceKey: "priority_label", type: "text" },
      { label: "Status", sourceKey: "status_label", type: "text" },
      { label: "State", sourceKey: "state_label", type: "text" },
      { label: "% Complete", sourceKey: "percent_complete", type: "text" },
      { label: "Due", sourceKey: "due_date", type: "date" },
      { label: "Scheduled Start", sourceKey: "scheduled_start", type: "date" },
      { label: "Actual Start", sourceKey: "actual_start", type: "date" },
      { label: "Actual End", sourceKey: "actual_end", type: "date" },
      { label: "Created On", sourceKey: "created_on", type: "date" },
      { label: "Modified On", sourceKey: "modified_on", type: "date" },
    ],
  },
  {
    key: "regarding",
    title: "Regarding & Links",
    fields: [
      { label: "Regarding", sourceKey: "regarding_name", type: "text" },
      { label: "Regarding Type", sourceKey: "regarding_type_label", type: "text" },
      { label: "Client", sourceKey: "client_account_name", type: "link" },
      { label: "Event", sourceKey: "event_name", type: "text" },
    ],
  },
  {
    key: "people",
    title: "People",
    fields: [
      { label: "Owner", sourceKey: "owner_name", type: "person" },
      { label: "Created By", sourceKey: "created_by_name", type: "person" },
      { label: "Modified By", sourceKey: "modified_by_name", type: "person" },
      { label: "Claimed By", sourceKey: "claimed_by_name", type: "person" },
      { label: "Current Assignment", sourceKey: "current_assignment_name", type: "person" },
    ],
  },
  {
    key: "workflow",
    title: "Workflow",
    fields: [
      { label: "Outreach Task Status", sourceKey: "outreach_status_label", type: "text" },
      { label: "Drafting", sourceKey: "drafting", type: "toggle" },
      { label: "Draft Complete", sourceKey: "draft_complete", type: "toggle" },
      { label: "Review Complete", sourceKey: "review_complete", type: "toggle" },
      { label: "Processed", sourceKey: "processed", type: "toggle" },
      { label: "Feedback Received", sourceKey: "feedback_received", type: "toggle" },
      { label: "Notified", sourceKey: "notified", type: "toggle" },
    ],
  },
]

/**
 * The header strip above the sections: Task Type · Sub-type, then Status.
 * The Subject is the headline itself and is rendered by the pane, not from here.
 */
export const TASK_HEADER_FIELDS: TaskFieldDef[] = [
  { label: "Task Type", sourceKey: "task_type_label", type: "text" },
  { label: "Sub-type", sourceKey: "task_subtype_label", type: "text" },
  { label: "Status", sourceKey: "status_label", type: "text" },
]

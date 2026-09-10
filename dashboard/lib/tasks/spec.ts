/**
 * The Tasks entity: its column catalog, its built-in views, and the EntitySpec
 * that binds them to the shared table machinery in lib/table-views/.
 *
 * ── ONE LIST, NOT TWO ──────────────────────────────────────────────────────
 * The catalog is DERIVED from `TASK_SECTIONS` in lib/tasks/record.ts — the same
 * field definitions the record drawer renders — so labels, types and ordering
 * come from one place, and adding a field to the drawer adds it to the column
 * picker automatically. What lives here is only what the drawer does not need:
 * which view column backs each field, how wide it renders, how it is painted,
 * and which band it groups under.
 *
 * Third entity on this machinery, after Meetings and Events. Nothing about
 * filtering, paging, saved views or authorisation is written again here.
 */

import type { ColumnDef, EntitySpec, FieldType, ViewSort } from "@/lib/table-views/types"
import { BUILTIN_PREFIX, type BuiltinView } from "@/lib/table-views/types"
import { TASK_SECTIONS, type TaskRecord } from "./record"

/** How a tasks cell is painted. Mirrors the events renderer vocabulary. */
export type TaskRenderer =
  | "text"
  | "date"
  | "ticker" // client symbol, linked to client detail, full name on hover
  | "owner" // the Owner cell — see the OWNER note below
  | "people" // initials-circle avatars for a known person
  | "statusPill" // coloured pill carrying the task status
  | "subject" // the task subject — clicking it opens the drawer
  | "regarding" // the regarding name with a small type label under it
  | "number" // right-aligned tabular figure
  | "bool" // Yes / No / em dash

export type TaskColumnDef = ColumnDef & { renderer: TaskRenderer }

/**
 * The bands above the column headers, in picker order. A band is a run of
 * ADJACENT columns, so the default column order below is what actually decides
 * where the rules fall; these are the labels those runs get.
 */
export const TASK_COLUMN_GROUPS = [
  "Client",
  "Task",
  "Classification",
  "Schedule",
  "People",
  "Workflow",
  "System",
] as const
export type TaskColumnGroup = (typeof TASK_COLUMN_GROUPS)[number]

/**
 * Per-field display facts, keyed by the drawer's `sourceKey`.
 *
 * `column` is the name on v_admin_tasks_all. Most match the drawer key exactly
 * because public.tasks is already a flat mirror — unlike meetings, nothing here
 * has to be dug out of jsonb.
 */
const SOURCE: Partial<
  Record<
    keyof TaskRecord,
    {
      column: string
      width: string
      renderer: TaskRenderer
      group: TaskColumnGroup
      /**
       * Override the FILTER type the drawer field declares. The drawer's own
       * `TaskFieldType` says how to PAINT a value; this says which operators the
       * filter row may offer. They agree everywhere except percent_complete,
       * which the drawer shows as plain text but must not be filtered with
       * ilike (integer ~~* unknown is error 42883, which blanks the page).
       */
      type?: FieldType
      compact?: boolean
      header?: string
      title?: string
    }
  >
> = {
  // ---- Task ----
  subject: {
    column: "subject",
    width: "300px",
    renderer: "subject",
    group: "Task",
    header: "Subject",
    title: "Click to open the task record",
  },
  description: {
    column: "description",
    width: "260px",
    renderer: "text",
    group: "Task",
    header: "Description",
  },
  task_type_label: {
    column: "task_type_label",
    width: "104px",
    renderer: "text",
    group: "Classification",
    header: "Task Type",
    title: "Outreach / Advisory / Onboarding / Internal / Reminder",
  },
  task_subtype_label: {
    column: "task_subtype_label",
    width: "150px",
    renderer: "text",
    group: "Classification",
    header: "Sub-type",
  },
  priority_label: {
    column: "priority_label",
    width: "84px",
    renderer: "text",
    group: "Classification",
    header: "Priority",
    title:
      "The Rose priority (High / Medium) where set, otherwise the stock Dynamics priority (Normal)",
  },
  status_label: {
    column: "status_label",
    width: "112px",
    renderer: "statusPill",
    group: "Classification",
    header: "Status",
    title: "Not Started / In Progress / Completed / Canceled",
  },
  state_label: {
    column: "state_label",
    width: "92px",
    renderer: "text",
    group: "Classification",
    header: "State",
    title: "Open / Completed / Canceled — the coarse state behind Status",
  },
  percent_complete: {
    column: "percent_complete",
    width: "76px",
    renderer: "number",
    group: "Schedule",
    type: "number",
    header: "% Done",
    title: "Percent Complete",
  },
  due_date: {
    column: "due_date",
    width: "104px",
    renderer: "date",
    group: "Schedule",
    header: "Due Date",
    title: "Scheduled End — what the CRM treats as the due date",
  },
  scheduled_start: {
    column: "scheduled_start",
    width: "112px",
    renderer: "date",
    group: "Schedule",
    header: "Sched Start",
  },
  actual_start: {
    column: "actual_start",
    width: "112px",
    renderer: "date",
    group: "Schedule",
    header: "Actual Start",
    title: "Empty across all live rows today — the CRM does not write it",
  },
  actual_end: {
    column: "actual_end",
    width: "112px",
    renderer: "date",
    group: "Schedule",
    header: "Actual End",
  },
  created_on: { column: "created_on", width: "112px", renderer: "date", group: "System", header: "Created" },
  modified_on: { column: "modified_on", width: "112px", renderer: "date", group: "System", header: "Modified" },

  // ---- Regarding & links ----
  regarding_name: {
    column: "regarding_name",
    width: "230px",
    renderer: "regarding",
    group: "Task",
    header: "Regarding",
    title: "What the task is about, with the record type beneath it",
  },
  regarding_type_label: {
    column: "regarding_type_label",
    width: "94px",
    renderer: "text",
    group: "Task",
    header: "Reg. Type",
    title: "Event / Client / Project / Contact",
  },
  client_account_name: {
    // Holds the ticker and links to the client's detail page, exactly as the
    // Events table's Client column does — same renderer, same destination.
    column: "client_account_name",
    width: "104px",
    renderer: "ticker",
    group: "Client",
    header: "Client",
    title: "Client ticker — full name on hover. Links to the client's detail page",
  },
  event_name: {
    column: "event_name",
    width: "220px",
    renderer: "text",
    group: "Task",
    header: "Event",
    title: "The marketing event this task hangs off, when it has one",
  },

  // ---- People ----
  owner_name: {
    column: "owner_name",
    width: "84px",
    renderer: "owner",
    group: "People",
    header: "Owner",
    title: "Task owner — initials, full name on hover",
  },
  created_by_name: {
    column: "created_by_name",
    width: "92px",
    renderer: "owner",
    group: "People",
    header: "Created By",
  },
  modified_by_name: {
    column: "modified_by_name",
    width: "96px",
    renderer: "owner",
    group: "People",
    header: "Modified By",
  },
  claimed_by_name: {
    column: "claimed_by_name",
    width: "96px",
    renderer: "owner",
    group: "People",
    header: "Claimed By",
    title: "Sparse — 9% of live tasks",
  },
  current_assignment_name: {
    column: "current_assignment_name",
    width: "104px",
    renderer: "owner",
    group: "People",
    header: "Assigned To",
    title: "Current Assignment — 41% of live tasks",
  },

  // ---- Workflow ----
  outreach_status_label: {
    column: "outreach_status_label",
    width: "126px",
    renderer: "text",
    group: "Workflow",
    header: "Outreach Status",
  },
  drafting: { column: "drafting", width: "72px", renderer: "bool", group: "Workflow", compact: true },
  draft_complete: {
    column: "draft_complete",
    width: "78px",
    renderer: "bool",
    group: "Workflow",
    header: "Drafted",
    title: "Draft Complete",
    compact: true,
  },
  review_complete: {
    column: "review_complete",
    width: "74px",
    renderer: "bool",
    group: "Workflow",
    header: "Reviewed",
    title: "Review Complete",
    compact: true,
  },
  processed: { column: "processed", width: "80px", renderer: "bool", group: "Workflow", compact: true },
  feedback_received: {
    column: "feedback_received",
    width: "74px",
    renderer: "bool",
    group: "Workflow",
    header: "FB Rec'd",
    title: "Feedback Received",
    compact: true,
  },
  notified: { column: "notified", width: "72px", renderer: "bool", group: "Workflow", compact: true },
}

/**
 * Columns the LIST has that the drawer does not show as its own FIELD.
 *
 * The two raw priority columns are here so a saved view can filter either one
 * directly — the displayed `priority_label` is a COALESCE of them (see the
 * sourcing note in lib/tasks/record.ts), and someone auditing priorities needs
 * to be able to reach the underlying values.
 */
const LIST_ONLY: TaskColumnDef[] = [
  {
    key: "priority_rose_label",
    label: "Priority (Rose field)",
    header: "Priority (Rose)",
    section: "Classification",
    type: "text",
    width: "110px",
    renderer: "text",
    title: "bcs_task_priority_label as stored — High / Medium, null on 47% of rows",
  },
  {
    key: "priority_stock_label",
    label: "Priority (Dynamics field)",
    header: "Priority (stock)",
    section: "Classification",
    type: "text",
    width: "118px",
    renderer: "text",
    title: "priority_label as stored — 'Normal' on every live row",
  },
  {
    key: "regarding_type",
    label: "Regarding Type (raw)",
    section: "Task",
    type: "text",
    width: "110px",
    renderer: "text",
    title: "The raw Dataverse entity name, e.g. bcs_event",
  },
  {
    key: "client_ticker",
    label: "Ticker (raw)",
    section: "Client",
    type: "text",
    width: "90px",
    renderer: "text",
  },
]

/** Fields shown in the drawer HEADER, which are also offerable as columns. */
const HEADER_COLUMNS: { key: keyof TaskRecord; label: string }[] = []

/** The full catalog, in drawer order, then the list-only extras. */
export const TASK_CATALOG: TaskColumnDef[] = [
  ...TASK_SECTIONS.flatMap((section) =>
    section.fields.flatMap((f) => {
      const src = SOURCE[f.sourceKey]
      if (!src) return []
      return [
        {
          key: src.column,
          label: f.label,
          header: src.header,
          title: src.title,
          section: src.group,
          type: src.type ?? f.type,
          width: src.width,
          renderer: src.renderer,
          compact: src.compact,
        } satisfies TaskColumnDef,
      ]
    }),
  ),
  ...HEADER_COLUMNS.flatMap((h) => {
    const src = SOURCE[h.key]
    if (!src) return []
    return [
      {
        key: src.column,
        label: h.label,
        header: src.header,
        title: src.title,
        section: src.group,
        type: "text",
        width: src.width,
        renderer: src.renderer,
        compact: src.compact,
      } satisfies TaskColumnDef,
    ]
  }),
  ...LIST_ONLY,
]

const BY_KEY = new Map(TASK_CATALOG.map((c) => [c.key, c]))

export function getTaskColumn(key: string): TaskColumnDef | undefined {
  return BY_KEY.get(key)
}

/** Catalog grouped for the picker — one heading per group, in group order. */
export function taskCatalogBySection(): { section: string; columns: TaskColumnDef[] }[] {
  return TASK_COLUMN_GROUPS.map((g) => ({
    section: g as string,
    columns: TASK_CATALOG.filter((c) => c.section === g),
  })).filter((g) => g.columns.length > 0)
}

/**
 * The default nine columns, in the order the brief specifies:
 *   Client · Subject · Regarding · Task Type · Sub-type · Priority · Due Date ·
 *   Owner · Status
 *
 * Everything else in the catalog is available-but-hidden, so a saved view can
 * add Event, Created, Modified, Claimed By, Outreach Status or % Complete
 * without a code change.
 */
export const TASK_DEFAULT_COLUMNS: string[] = [
  "client_account_name",
  "subject",
  "regarding_name",
  "task_type_label",
  "task_subtype_label",
  "priority_label",
  "due_date",
  "owner_name",
  "status_label",
]

/** Always fetched: the row identity and the ids the table needs for links. */
export const TASK_ALWAYS_SELECT = [
  "task_id",
  "client_account_id",
  "client_ticker",
  "regarding_type_label",
] as const

/**
 * Soonest due first — and this is where Tasks deliberately differs from
 * Meetings and Events, which both open newest-first.
 *
 * Those two are historical logs: the interesting end is the recent past. A task
 * list is a WORKLIST, and its question is "what is due next", so the default
 * view sorts ASCENDING on the due date. `nullsFirst: false` in fetchRows puts
 * the five undated Open tasks at the bottom rather than the top.
 */
export const TASK_DEFAULT_SORT: ViewSort = { field: "due_date", dir: "asc" }

/**
 * The built-in system views — code, not rows, so they always exist and need no
 * seeding step.
 *
 * "Open tasks" is the fallback default: state_label = 'Open' is 530 of 3,920
 * live rows, which is what makes the page open on active work and open fast.
 * The index idx_tasks_state_due serves the filter and the sort together.
 */
export const TASK_BUILTIN_VIEWS: BuiltinView[] = [
  {
    id: `${BUILTIN_PREFIX}open`,
    name: "Open tasks",
    isFallbackDefault: true,
    config: {
      columns: TASK_DEFAULT_COLUMNS,
      filters: [{ field: "state_label", op: "eq", value: "Open" }],
      sort: TASK_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}outreach`,
    name: "Open — Outreach",
    config: {
      columns: TASK_DEFAULT_COLUMNS,
      filters: [
        { field: "state_label", op: "eq", value: "Open" },
        { field: "task_type_label", op: "eq", value: "Outreach" },
      ],
      sort: TASK_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}advisory`,
    name: "Open — Advisory",
    config: {
      columns: TASK_DEFAULT_COLUMNS,
      filters: [
        { field: "state_label", op: "eq", value: "Open" },
        { field: "task_type_label", op: "eq", value: "Advisory" },
      ],
      sort: TASK_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}completed`,
    name: "Completed",
    config: {
      columns: TASK_DEFAULT_COLUMNS,
      filters: [{ field: "state_label", op: "eq", value: "Completed" }],
      // Completed work reads newest-first, like the other two CRM tables.
      sort: { field: "due_date", dir: "desc" },
    },
  },
  {
    id: `${BUILTIN_PREFIX}all`,
    name: "All tasks",
    config: {
      columns: TASK_DEFAULT_COLUMNS,
      filters: [],
      sort: { field: "due_date", dir: "desc" },
    },
  },
]

/** The Tasks entity, bound to the shared machinery. */
export const TASKS_SPEC: EntitySpec = {
  key: "tasks",
  viewName: "v_admin_tasks_all",
  idColumn: "task_id",
  alwaysSelect: TASK_ALWAYS_SELECT,
  getColumn: getTaskColumn,
  catalog: TASK_CATALOG,
  defaultSort: TASK_DEFAULT_SORT,
  builtins: TASK_BUILTIN_VIEWS,
  savedViewsTable: "task_saved_views",
  optionsView: "v_admin_tasks_filter_options",
}

/**
 * Is this owner value a PERSON we can draw initials for, or an opaque code?
 *
 * `owner_name` on live data is a mix of three things across its 22 distinct
 * values, and only 5 of the owner ids resolve to a public.users row:
 *
 *   "Katie Murphy"      a real person        -> initials circle, globally
 *                                              disambiguated (KMu / KMi)
 *   "JS", "YL", "MB"    already-abbreviated  -> the code itself in the circle.
 *                       staff codes             initialsOf("JS") would render
 *                                              just "J", which is wrong.
 *   "CRM",              a queue, not a       -> shown as-is; a queue is not a
 *   "Feedback Reports"  person                  person and gets no avatar.
 *
 * The rule: a value containing a space is treated as a name (the shared avatar
 * component handles it); anything else is a short code shown verbatim. That
 * leaves "Feedback Reports" reading as a two-word name — it takes an "FR"
 * circle. Harmless, and the alternative is hardcoding a queue list that would go
 * stale the moment the CRM adds another.
 */
export function isPersonName(value: string | null | undefined): boolean {
  return !!value && value.trim().includes(" ")
}

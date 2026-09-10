/**
 * The Events entity: its column catalog, its built-in views, and the EntitySpec
 * that binds them to the shared table machinery in lib/table-views/.
 *
 * ── ONE LIST, NOT TWO ──────────────────────────────────────────────────────
 * The catalog is DERIVED from `EVENT_SECTIONS` in lib/events/record.ts — the
 * same field definitions the record drawer renders — so labels, types and
 * ordering come from one place, and adding a field to the drawer adds it to the
 * column picker automatically. What lives here is only what the drawer does not
 * need: which view column backs each field, how wide it renders, how it is
 * painted, and which band it groups under.
 */

import type { ColumnDef, EntitySpec, FieldType, ViewSort } from "@/lib/table-views/types"
import { BUILTIN_PREFIX, type BuiltinView } from "@/lib/table-views/types"
import { EVENT_SECTIONS, type EventRecord } from "./record"

/** How an events cell is painted. Mirrors the meetings renderer vocabulary. */
export type EventRenderer =
  | "text"
  | "date"
  | "ticker" // client symbol, linked to client detail, full name on hover
  | "people" // initials-circle avatars
  | "statePill" // coloured pill carrying the full event state
  | "url" // an external link, shown as a short label
  | "title" // the event title — clicking it opens the drawer
  | "number" // right-aligned tabular figure; negatives tinted (overbooking)
  | "bool" // Yes / No / em dash

export type EventColumnDef = ColumnDef & { renderer: EventRenderer }

/**
 * The bands above the column headers, in picker order.
 *
 * "Event" holds ONE column — the title — because the title now LEADS the table
 * as the row's identity, and everything describing the event follows after
 * Client. A band is a run of ADJACENT columns, so leaving the title in the same
 * group as Dates/Location/State would print "EVENT" twice with "CLIENT" wedged
 * between them, which reads as a bug rather than as a grouping. Splitting the
 * name off from its attributes is what keeps every band contiguous and labelled.
 */
export const EVENT_COLUMN_GROUPS = [
  "Event",
  "Event Details",
  "Client",
  // Capacity: how full the event is. The same three numbers the drawer's stat
  // row shows, so the table and the drawer cannot disagree.
  "Meetings",
  "People",
  "Planning",
  "System",
] as const
export type EventColumnGroup = (typeof EVENT_COLUMN_GROUPS)[number]

/**
 * Per-field display facts, keyed by the drawer's `sourceKey`.
 *
 * `column` is the name on v_admin_events_all. Most match the drawer key exactly
 * because public.events is already a flat mirror — unlike meetings, nothing here
 * has to be dug out of jsonb.
 */
const SOURCE: Partial<
  Record<
    keyof EventRecord,
    {
      column: string
      width: string
      renderer: EventRenderer
      group: EventColumnGroup
      /**
       * Override the FILTER type the drawer field declares. The drawer's own
       * `EventFieldType` says how to PAINT a value; this says which operators
       * the filter row may offer. They agree everywhere except the integer
       * columns, which the drawer shows as plain text but must not be filtered
       * with ilike.
       */
      type?: FieldType
      compact?: boolean
      header?: string
      title?: string
    }
  >
> = {
  // ---- General ----
  client_account_name: {
    // Holds the ticker PLUS the right-aligned account-team circles (four 24px
    // circles overlapping by 8 = 72px; four is the common case, 65 of the 141
    // accounts behind live events, with 67 more showing three).
    //
    // 132px is MEASURED in Geist 13px/500, not guessed, and sits on a cliff:
    // it leaves 38px for the ticker, which fits all but ARCAD, AKRBP and
    // TRAXIONA — 24 of 968 rows (2.5%), and 2 of the 144 in the default view.
    // 128px would save 4px more but truncate 159 rows (16.4%); 160px truncates
    // nothing but is 28px wider for the sake of three tickers. Those three
    // ellipsize, with the full client name on the cell's hover title.
    column: "client_account_name",
    width: "132px",
    renderer: "ticker",
    group: "Client",
    header: "Client",
    title: "Client ticker — full name on hover. Links to the client's detail page",
  },
  event_location: { column: "event_location", width: "150px", renderer: "text", group: "Event Details" },
  tbc: { column: "tbc", width: "58px", renderer: "bool", group: "Event Details", compact: true, title: "To be confirmed" },
  event_dates: {
    column: "event_dates",
    width: "120px",
    renderer: "text",
    group: "Event Details",
    header: "Dates",
    title: "Event dates as entered in the CRM — free text, e.g. \"10/2 & 10/3\"",
  },
  account_manager_name: {
    column: "account_manager_name",
    width: "110px",
    renderer: "people",
    group: "People",
    header: "Acct Mgr",
    title: "Account Manager — initials, full name on hover",
  },
  logistics_coordinator_name: {
    column: "logistics_coordinator_name",
    width: "100px",
    renderer: "people",
    group: "People",
    header: "Logistics",
    title: "Logistics Coordinator — initials, full name on hover",
  },
  feedback_team_name: {
    column: "feedback_team_name",
    width: "110px",
    renderer: "text",
    group: "People",
    header: "FB Team",
  },
  feedback_report_name: {
    column: "feedback_report_name",
    width: "100px",
    renderer: "people",
    group: "People",
    header: "FB Report",
    title: "Feedback Report person — initials, full name on hover",
  },
  leads_labels: {
    column: "leads_labels",
    width: "90px",
    renderer: "text",
    group: "People",
    header: "Lead(s)",
  },
  team: { column: "team", width: "62px", renderer: "bool", group: "Event Details", compact: true },
  event_notes: { column: "event_notes", width: "240px", renderer: "text", group: "Event Details" },
  meetings_start: {
    column: "meetings_start",
    width: "130px",
    renderer: "date",
    group: "Event Details",
    header: "Mtgs Start",
  },
  meetings_end: {
    column: "meetings_end",
    width: "130px",
    renderer: "date",
    group: "Event Details",
    header: "Mtgs End",
  },

  // ---- Planning ----
  event_parameters: { column: "event_parameters", width: "180px", renderer: "text", group: "Planning" },
  // Banded with the other two capacity figures rather than with Planning: they
  // are read together, and a band is a run of ADJACENT columns.
  of_slots: {
    column: "of_slots",
    width: "70px",
    renderer: "number",
    group: "Meetings",
    type: "number",
    header: "Slots",
    title: "# of Slots — the event's meeting capacity",
  },
  urgency_label: { column: "urgency_label", width: "90px", renderer: "text", group: "Planning", header: "Urgency" },
  launch_week: { column: "launch_week", width: "130px", renderer: "date", group: "Planning" },
  memo_date: { column: "memo_date", width: "130px", renderer: "date", group: "Planning" },
  last_data_upload: { column: "last_data_upload", width: "130px", renderer: "date", group: "Planning", header: "Data Upload" },
  shareholder_report_received_date: {
    column: "shareholder_report_received_date",
    width: "130px",
    renderer: "date",
    group: "Planning",
    header: "SH Report",
    title: "Shareholder Report Received — empty across all live rows today",
  },
  targeting_not_required: {
    column: "targeting_not_required",
    width: "74px",
    renderer: "bool",
    group: "Planning",
    header: "No Tgt",
    title: "Targeting Not Required",
    compact: true,
  },
  memo_not_required: {
    column: "memo_not_required",
    width: "80px",
    renderer: "bool",
    group: "Planning",
    header: "No Memo",
    title: "Memo Not Required",
    compact: true,
  },
  targeting_date: { column: "targeting_date", width: "130px", renderer: "date", group: "Planning", header: "Tgt Date" },
  targeting_url: {
    column: "targeting_url",
    width: "90px",
    renderer: "url",
    group: "Planning",
    header: "Targeting",
    title: "Targeting URL — opens the SharePoint document",
  },
  profile_link: {
    column: "profile_link",
    width: "80px",
    renderer: "url",
    group: "Planning",
    header: "Profile",
    title: "Profile Link — opens the SharePoint document",
  },
  targeting_notes: { column: "targeting_notes", width: "200px", renderer: "text", group: "Planning", header: "Tgt Notes" },
  launch: { column: "launch", width: "68px", renderer: "bool", group: "Planning", compact: true },
  outreach_complete: {
    column: "outreach_complete",
    width: "80px",
    renderer: "bool",
    group: "Planning",
    header: "Outreach",
    title: "Outreach Complete",
    compact: true,
  },

  // ---- Header fields, also offerable as columns ----
  event_title: {
    column: "event_title",
    width: "260px",
    renderer: "title",
    group: "Event",
    header: "Event Title",
    title: "Click to open the event record",
  },
  event_state_label: {
    column: "event_state_label",
    width: "128px",
    renderer: "statePill",
    group: "Event Details",
    header: "Event State",
  },
  marketing_state_label: {
    column: "marketing_state_label",
    width: "112px",
    renderer: "text",
    group: "Event Details",
    header: "Mktg State",
  },
  user_team_lead: {
    column: "user_team_lead",
    width: "150px",
    renderer: "text",
    group: "People",
    header: "User/Team Lead",
  },
}

/**
 * Columns the LIST has that the drawer does not show as a FIELD.
 *
 * The two capacity figures live here rather than in EVENT_SECTIONS because the
 * drawer renders them as a stat row, not as label/value fields — but they are
 * ordinary columns as far as the table, the picker, sorting and the export are
 * concerned. They existed on the view and in the drawer for a while WITHOUT
 * being registered here, which is exactly why they never appeared in the table:
 * `selectListFor` only requests keys the catalog knows.
 */
const LIST_ONLY: EventColumnDef[] = [
  {
    key: "confirmed_meetings",
    label: "Meetings",
    section: "Meetings",
    type: "number",
    width: "86px",
    renderer: "number",
    title: "Confirmed meetings on this event — the same count Portfolio's Open Slots uses",
  },
  {
    key: "slots_remaining",
    label: "Slots Remaining",
    header: "Remaining",
    section: "Meetings",
    type: "number",
    width: "96px",
    renderer: "number",
    title:
      "Slots minus confirmed meetings. Blank when the event has no slot count; negative means overbooked",
  },
  {
    key: "client_ticker",
    label: "Ticker (raw)",
    section: "Client",
    type: "text",
    width: "90px",
    renderer: "text",
  },
  {
    key: "state_label",
    label: "State (active/inactive)",
    section: "System",
    type: "text",
    width: "90px",
    renderer: "text",
  },
  { key: "created_on", label: "Created On", section: "System", type: "date", width: "130px", renderer: "date" },
  { key: "modified_on", label: "Modified On", section: "System", type: "date", width: "130px", renderer: "date" },
]

/** Fields shown in the drawer HEADER, which are also offerable as columns. */
const HEADER_COLUMNS: { key: keyof EventRecord; label: string }[] = [
  { key: "event_title", label: "Event Title" },
  { key: "event_state_label", label: "Event State" },
  { key: "marketing_state_label", label: "Marketing State" },
  { key: "user_team_lead", label: "User/Team Lead" },
]

/** The full catalog, in drawer order, then the list-only extras. */
export const EVENT_CATALOG: EventColumnDef[] = [
  ...EVENT_SECTIONS.flatMap((section) =>
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
        } satisfies EventColumnDef,
      ]
    }),
  ),
  // The header fields are columns too, but do not live in a drawer SECTION, so
  // they are added explicitly rather than walked out of EVENT_SECTIONS.
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
      } satisfies EventColumnDef,
    ]
  }),
  ...LIST_ONLY,
]

const BY_KEY = new Map(EVENT_CATALOG.map((c) => [c.key, c]))

export function getEventColumn(key: string): EventColumnDef | undefined {
  return BY_KEY.get(key)
}

/** Catalog grouped for the picker — one heading per group, in group order. */
export function eventCatalogBySection(): { section: string; columns: EventColumnDef[] }[] {
  return EVENT_COLUMN_GROUPS.map((g) => ({
    section: g as string,
    columns: EVENT_CATALOG.filter((c) => c.section === g),
  })).filter((g) => g.columns.length > 0)
}

/**
 * The seven columns from the CRM's "Current and Upcoming Marketing" view, in its
 * order. This is the default layout every built-in view uses.
 */
export const EVENT_DEFAULT_COLUMNS: string[] = [
  // Event Title LEADS. It is the row's identity and its handle — clicking it
  // opens the record — so it reads first, the way a name column should. The CRM
  // view puts it sixth; that is the one place this layout deliberately differs.
  "event_title",
  "client_account_name",
  "event_dates",
  "event_location",
  "event_state_label",
  // The capacity trio, together and adjacent so they form one "Meetings" band.
  "confirmed_meetings",
  "of_slots",
  "slots_remaining",
  "targeting_url",
  "user_team_lead",
]

/** Always fetched: the row identity and the ids the table needs for links. */
export const EVENT_ALWAYS_SELECT = ["event_id", "client_account_id", "client_ticker"] as const

/** Newest event first. `event_dates` is free text, so the real timestamp sorts. */
export const EVENT_DEFAULT_SORT: ViewSort = { field: "meetings_start", dir: "desc" }

/**
 * The built-in system views — code, not rows, so they always exist and need no
 * seeding step.
 *
 * "Current & Upcoming" is the fallback default, the parallel of Meetings opening
 * on Upcoming: an active event whose state is anything but Complete. That is 144
 * of 968 live rows, which is what makes the page open fast. The state list comes
 * from live data — Pre-Launch, Live Outreach, Meetings Ongoing, Schedule Closed,
 * Preparing Feedback, Pause, Complete — and "not Complete" is the one rule that
 * survives new states being added.
 */
export const EVENT_BUILTIN_VIEWS: BuiltinView[] = [
  {
    id: `${BUILTIN_PREFIX}current_upcoming`,
    name: "Current & Upcoming",
    isFallbackDefault: true,
    config: {
      columns: EVENT_DEFAULT_COLUMNS,
      filters: [
        { field: "state_label", op: "eq", value: "Active" },
        { field: "event_state_label", op: "neq", value: "Complete" },
      ],
      sort: EVENT_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}live_outreach`,
    name: "Live Outreach",
    config: {
      columns: EVENT_DEFAULT_COLUMNS,
      filters: [{ field: "event_state_label", op: "eq", value: "Live Outreach" }],
      sort: EVENT_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}pre_launch`,
    name: "Pre-Launch",
    config: {
      columns: EVENT_DEFAULT_COLUMNS,
      filters: [{ field: "event_state_label", op: "eq", value: "Pre-Launch" }],
      sort: EVENT_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}preparing_feedback`,
    name: "Preparing Feedback",
    config: {
      columns: EVENT_DEFAULT_COLUMNS,
      filters: [{ field: "event_state_label", op: "eq", value: "Preparing Feedback" }],
      sort: EVENT_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}all`,
    name: "All events",
    config: { columns: EVENT_DEFAULT_COLUMNS, filters: [], sort: EVENT_DEFAULT_SORT },
  },
]

/** The Events entity, bound to the shared machinery. */
export const EVENTS_SPEC: EntitySpec = {
  key: "events",
  viewName: "v_admin_events_all",
  idColumn: "event_id",
  alwaysSelect: EVENT_ALWAYS_SELECT,
  getColumn: getEventColumn,
  catalog: EVENT_CATALOG,
  defaultSort: EVENT_DEFAULT_SORT,
  builtins: EVENT_BUILTIN_VIEWS,
  savedViewsTable: "event_saved_views",
  optionsView: "v_admin_events_filter_options",
}

/**
 * The Notes entity: its column catalog, its built-in views, and the EntitySpec
 * that binds them to the shared table machinery in lib/table-views/.
 *
 * ── ONE LIST, NOT TWO ──────────────────────────────────────────────────────
 * The catalog is DERIVED from `NOTE_SECTIONS` in lib/notes/record.ts — the same
 * field definitions the record drawer renders — so labels, types and ordering
 * come from one place, and adding a field to the drawer adds it to the column
 * picker automatically. What lives here is only what the drawer does not need:
 * which view column backs each field, how wide it renders, how it is painted,
 * and which band it groups under.
 *
 * Fifth entity on this machinery, after Meetings, Events, Tasks and Touches.
 * Nothing about filtering, paging, saved views or authorisation is written again
 * here.
 */

import type { ColumnDef, EntitySpec, FieldType, ViewSort } from "@/lib/table-views/types"
import { BUILTIN_PREFIX, type BuiltinView } from "@/lib/table-views/types"
import { NOTE_SECTIONS, type NoteRecord } from "./record"

/** How a notes cell is painted. Mirrors the touchpoints renderer vocabulary. */
export type NoteRenderer =
  | "text"
  | "date"
  | "ticker" // client symbol, linked to client detail, full name on hover
  | "people" // initials-circle avatars for a known person
  | "statusPill" // coloured pill carrying the client-status assessment
  | "body" // the note body — truncated, hover for the full text, click to open
  | "bool" // Yes / No / em dash

export type NoteColumnDef = ColumnDef & { renderer: NoteRenderer }

/**
 * The bands above the column headers, in picker order. A band is a run of
 * ADJACENT columns, so the default column order below is what actually decides
 * where the rules fall; these are the labels those runs get.
 */
export const NOTE_COLUMN_GROUPS = [
  "Client",
  "Note",
  "Assessment",
  "Action",
  "People",
  "System",
] as const
export type NoteColumnGroup = (typeof NOTE_COLUMN_GROUPS)[number]

/**
 * Per-field display facts, keyed by the drawer's `sourceKey`.
 *
 * `column` is the name on v_admin_notes_all. Most match the drawer key exactly;
 * the exceptions are the view's renames (`name` → `review_cycle`) and the four
 * fields it digs out of `_raw` (`note_body`, `owner_name`, `created_by_name`,
 * `modified_by_name`).
 */
const SOURCE: Partial<
  Record<
    keyof NoteRecord,
    {
      column: string
      width: string
      renderer: NoteRenderer
      group: NoteColumnGroup
      /**
       * Override the FILTER type the drawer field declares. The drawer's own
       * `NoteFieldType` says how to PAINT a value; this says which operators the
       * filter row may offer.
       */
      type?: FieldType
      compact?: boolean
      header?: string
      title?: string
    }
  >
> = {
  // ---- Client ----
  client_account_name: {
    // Holds the ticker and links to the client's detail page, exactly as the
    // other CRM tables do — same renderer, same destination.
    column: "client_account_name",
    width: "104px",
    renderer: "ticker",
    group: "Client",
    header: "Client",
    title: "Client ticker — full name on hover. Links to the client's detail page",
  },

  // ---- Note ----
  note_date: {
    column: "note_date",
    width: "104px",
    renderer: "date",
    group: "Note",
    header: "Date",
    title: "The review date. 96% populated — the 25 undated rows are empty shells",
  },
  note_body: {
    column: "note_body",
    width: "420px",
    renderer: "body",
    group: "Note",
    header: "Note",
    title:
      "The review body. Truncated here — hover for the full text, or click the " +
      "row to read it with its line breaks in the drawer",
  },
  review_cycle: {
    column: "review_cycle",
    width: "170px",
    renderer: "text",
    group: "Note",
    header: "Review Cycle",
    title: "Which monthly review this note belongs to, e.g. 'Client Review - June 2026'",
  },

  // ---- Assessment ----
  status_text: {
    column: "status_text",
    width: "104px",
    renderer: "statusPill",
    group: "Assessment",
    header: "Status",
    title:
      "Stable / At Risk / New Client / Lost / Strong / Pause. A free-text Rose " +
      "field, trimmed in the view — the raw column stores 'Stable' and 'Stable\\n' " +
      "as two different values",
  },
  primary_risk_driver: {
    column: "primary_risk_driver",
    width: "210px",
    renderer: "text",
    group: "Assessment",
    header: "Risk Driver",
    title: "Primary Risk Driver — 20 distinct values after trimming. Empty on 54% of rows",
  },

  // ---- Action ----
  action_step: {
    column: "action_step",
    width: "300px",
    renderer: "text",
    group: "Action",
    header: "Action Step",
    title: "What was agreed. Only 29% of notes carry one",
  },
  action_owner: {
    column: "action_owner",
    width: "92px",
    renderer: "text",
    group: "Action",
    header: "Action Owner",
    title: "Staff INITIALS, sometimes several ('LW/RB'). Not a resolvable person record",
  },
  action_deadline: {
    column: "action_deadline",
    width: "104px",
    renderer: "date",
    group: "Action",
    header: "Action Due",
    title: "19% populated. Two rows carry obvious 1931 typos from the CRM",
  },

  // ---- People ----
  owner_name: {
    column: "owner_name",
    width: "88px",
    renderer: "people",
    group: "People",
    header: "Owner",
    title:
      "The note's author — a real person here, unlike Touches. Sourced from _raw: " +
      "the mirror keeps owner_id but never flattened the name",
  },
  created_by_name: {
    column: "created_by_name",
    width: "92px",
    renderer: "people",
    group: "People",
    header: "Created By",
    title: "The same two people as Owner on every live row. Sourced from _raw",
  },
  modified_by_name: {
    column: "modified_by_name",
    width: "96px",
    renderer: "people",
    group: "People",
    header: "Modified By",
    title: "Grace Andonian or 'CRM Administration'. Sourced from _raw",
  },

  // ---- System ----
  created_on: {
    column: "created_on",
    width: "112px",
    renderer: "date",
    group: "System",
    header: "Created",
  },
  modified_on: {
    column: "modified_on",
    width: "112px",
    renderer: "date",
    group: "System",
    header: "Modified",
  },
  notes_text: {
    column: "notes_text",
    width: "300px",
    renderer: "text",
    group: "System",
    header: "Note (raw)",
    title:
      "The flattened notes_text column as stored, with its line breaks collapsed. " +
      "Differs from the Note column on 435 of 693 rows — kept for comparison",
  },
}

/**
 * Columns the LIST has that the drawer does not show as its own FIELD.
 *
 * The two constant state columns are here so nobody goes looking for them, and
 * `is_recent` because it is the rolling window the Recent view is built on —
 * someone auditing why a row is or is not in it needs to be able to see it.
 */
const LIST_ONLY: NoteColumnDef[] = [
  {
    key: "is_recent",
    label: "Last 12 Months",
    header: "Recent",
    section: "System",
    type: "toggle",
    width: "78px",
    renderer: "bool",
    compact: true,
    title:
      "Computed in the view as note_date >= today - 12 months. True on 668 of 693 " +
      "rows today — the whole archive is only seven months old, so what this " +
      "actually excludes is the 25 undated empty shells",
  },
  {
    key: "state_label",
    label: "State (Dynamics)",
    header: "State",
    section: "System",
    type: "text",
    width: "88px",
    renderer: "text",
    title: "'Active' on every one of the 693 live rows — a constant, not a signal",
  },
  {
    key: "status_label",
    label: "Status (Dynamics)",
    header: "Sys Status",
    section: "System",
    type: "text",
    width: "94px",
    renderer: "text",
    title:
      "'Active' on every live row. The status that carries meaning is the " +
      "Status column, which is the free-text Rose field",
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
const HEADER_COLUMNS: { key: keyof NoteRecord; label: string }[] = []

/** The full catalog, in drawer order, then the list-only extras. */
export const NOTE_CATALOG: NoteColumnDef[] = [
  ...NOTE_SECTIONS.flatMap((section) =>
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
        } satisfies NoteColumnDef,
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
      } satisfies NoteColumnDef,
    ]
  }),
  ...LIST_ONLY,
]

const BY_KEY = new Map(NOTE_CATALOG.map((c) => [c.key, c]))

export function getNoteColumn(key: string): NoteColumnDef | undefined {
  return BY_KEY.get(key)
}

/** Catalog grouped for the picker — one heading per group, in group order. */
export function noteCatalogBySection(): { section: string; columns: NoteColumnDef[] }[] {
  return NOTE_COLUMN_GROUPS.map((g) => ({
    section: g as string,
    columns: NOTE_CATALOG.filter((c) => c.section === g),
  })).filter((g) => g.columns.length > 0)
}

/**
 * The default seven columns, as the brief specifies:
 *   Client · Date · Note · Status · Risk Driver · Action Step · Owner
 *
 * The order is also what decides the header BANDS, which must be runs of
 * adjacent columns: Client | Note (Date, Note) | Assessment (Status, Risk
 * Driver) | Action (Action Step) | People (Owner).
 *
 * Everything else in the catalog is available-but-hidden: Review Cycle, Action
 * Owner, Action Due, Created By, Modified By, Created, Modified, the flattened
 * Note (raw), the two constant Dynamics state columns, Last 12 Months and the
 * raw ticker.
 */
export const NOTE_DEFAULT_COLUMNS: string[] = [
  "client_account_name",
  "note_date",
  "note_body",
  "status_text",
  "primary_risk_driver",
  "action_step",
  "owner_name",
]

/**
 * Always fetched: the row identity, the ids the table needs for links, and
 * is_test for the TEST badge. Each key is skipped when the view lacks it, so the
 * list still loads before sql/patches/2026-09-23c_notes_dashboard_writes.sql runs.
 */
export const NOTE_ALWAYS_SELECT = ["note_id", "client_account_id", "client_ticker", "is_test"] as const

/**
 * Newest first. Notes are a historical LOG — a monthly review series — so the
 * interesting end is the most recent cycle, the same as Meetings, Events and
 * Touches and unlike Tasks' worklist.
 *
 * `nullsFirst: false` in fetchRows puts the 25 undated shells at the bottom of
 * "All notes" rather than the top.
 */
export const NOTE_DEFAULT_SORT: ViewSort = { field: "note_date", dir: "desc" }

/**
 * The built-in system views — code, not rows, so they always exist and need no
 * seeding step.
 *
 * ── WHY "RECENT NOTES" IS THE DEFAULT, AND WHAT IT ACTUALLY DOES ───────────
 * The brief asked for a recent-notes default and left the window to the data.
 * The data is seven months old: note_date spans 2026-02-04 to 2026-09-11, so
 * EVERY dated note is inside a 12-month window and the filter excludes nothing
 * on date grounds today.
 *
 * It is still the right default, for a reason that has nothing to do with
 * recency: 25 of the 693 rows are EMPTY SHELLS — no date, no client, no body, no
 * review cycle — incomplete records sitting in the CRM. Filtering on the date
 * drops exactly those 25 and nothing else, so the default view opens on 668 rows
 * of real content. "All notes" is one click away for anyone who wants the shells
 * too.
 *
 * When the archive passes a year the filter starts doing its literal job as
 * well, with no code change — `is_recent` is computed in the view and
 * re-evaluated on every query rather than frozen into a saved filter. (The
 * shared filter grammar has no relative-date token; see the note in
 * lib/touchpoints/spec.ts for the full reasoning.)
 */
export const NOTE_BUILTIN_VIEWS: BuiltinView[] = [
  {
    id: `${BUILTIN_PREFIX}recent`,
    name: "Recent notes",
    isFallbackDefault: true,
    config: {
      columns: NOTE_DEFAULT_COLUMNS,
      filters: [{ field: "is_recent", op: "isTrue" }],
      sort: NOTE_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}at_risk`,
    name: "At Risk",
    config: {
      columns: NOTE_DEFAULT_COLUMNS,
      // `startsWith` rather than `eq`, so the two "At Risk." typo rows are
      // caught alongside the 110 clean ones. See the trap note in the patch.
      filters: [{ field: "status_text", op: "startsWith", value: "At Risk" }],
      sort: NOTE_DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}open_actions`,
    name: "Open actions",
    config: {
      // An action step with a due date is the part of a note somebody still owes
      // something on. Action Owner and Action Due earn their columns here.
      columns: [
        "client_account_name",
        "note_date",
        "action_step",
        "action_owner",
        "action_deadline",
        "status_text",
        "owner_name",
      ],
      filters: [{ field: "action_step", op: "isNotEmpty" }],
      sort: { field: "action_deadline", dir: "asc" },
    },
  },
  {
    id: `${BUILTIN_PREFIX}all`,
    name: "All notes",
    config: {
      columns: NOTE_DEFAULT_COLUMNS,
      filters: [],
      sort: NOTE_DEFAULT_SORT,
    },
  },
]

/** The Notes entity, bound to the shared machinery. */
export const NOTES_SPEC: EntitySpec = {
  key: "notes",
  viewName: "v_admin_notes_all",
  idColumn: "note_id",
  alwaysSelect: NOTE_ALWAYS_SELECT,
  getColumn: getNoteColumn,
  catalog: NOTE_CATALOG,
  defaultSort: NOTE_DEFAULT_SORT,
  builtins: NOTE_BUILTIN_VIEWS,
  savedViewsTable: "note_saved_views",
  optionsView: "v_admin_notes_filter_options",
}

/**
 * Is this value a PERSON we can draw initials for?
 *
 * Every people value on this entity is a real full name — owner and created_by
 * are Grace Andonian and Robert Brinberg on all 693 rows, and modified_by adds
 * only "CRM Administration", which takes a harmless "CA" circle.
 *
 * NOT used for `action_owner`, which is initials ("BM", "LW/RB") and is painted
 * as plain text — running "LW/RB" through an initials renderer would produce
 * nonsense.
 *
 * The same space test the other pages use, so a single-token value that appears
 * later is shown verbatim rather than rendered as one misleading letter.
 */
export function isPersonName(value: string | null | undefined): boolean {
  return !!value && value.trim().includes(" ")
}

/**
 * Client-status pill colours for `status_text`.
 *
 * Exported from the spec rather than the pane because both the table and the
 * drawer paint it, and it is the one field on this entity where the colour
 * carries the meaning: this is the firm's own read on the relationship.
 *
 * `startsWith` on "at risk" catches the two "At Risk." typo rows.
 */
export function noteStatusKey(status: string | null | undefined): string {
  return (status ?? "").trim().toLowerCase()
}

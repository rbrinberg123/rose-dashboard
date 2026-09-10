/**
 * The Meetings table's COLUMN CATALOG — every column "Edit columns" can offer.
 *
 * ── ONE LIST, NOT TWO ──────────────────────────────────────────────────────
 * The catalog is DERIVED from `MEETING_SECTIONS` in lib/meeting-record.ts — the
 * same field definitions the record drawer renders. Labels, types, section
 * grouping and ordering all come from there, so adding a field to the drawer
 * adds it to the column picker automatically and the two can never drift.
 *
 * What lives here instead is the part the drawer does not need: which column on
 * `v_admin_meetings_all` backs each field, how wide it renders, and how it is
 * painted. That is the `SOURCE` map below, keyed by the drawer's own
 * `sourceKey` — so the mapping is a lookup against one list, not a second copy
 * of it.
 *
 * A field in MEETING_SECTIONS with no SOURCE entry is simply not offerable as a
 * column (today: none — `is_live` is a section predicate, not a field).
 */

import { MEETING_SECTIONS, type MeetingFieldType, type MeetingRecord } from "@/lib/meeting-record"

/**
 * The TABLE's column groups — the bands above the column headers, and the
 * headings in the "Edit columns" picker.
 *
 * ── WHY THESE ARE NOT THE DRAWER'S SECTIONS ────────────────────────────────
 * Labels, types and ordering still come from MEETING_SECTIONS (the record
 * drawer's own field list) — that part is still one list, not two. But the
 * GROUPING is the table's own, because the two surfaces are answering different
 * questions. The drawer reads top to bottom as one record, so "Overview" holding
 * the meeting, the client and the counterparty together is fine there. The table
 * is scanned across, so those three want to be visibly separate bands.
 *
 * Concretely, the drawer's "Overview" splits three ways here — meeting-level
 * facts to `Meeting`, the client to `Client`, the institution and investor to
 * `Counterparty` — and its "Planning" and "Feedback" merge into one `Workflow`.
 *
 * Order here is the order the picker lists them in.
 */
export const COLUMN_GROUPS = [
  /** Facts about the meeting itself: when, what kind, where, what state. */
  "Meeting",
  /** The Rose client whose meeting this is. */
  "Client",
  /** Who they met — the institution and the individual investor. */
  "Counterparty",
  /** The Rose staff attached to the meeting. */
  "Representatives",
  /** How the meeting moves through the process: calendar, profile, feedback. */
  "Workflow",
  /** In-person logistics — null on virtual meetings. */
  "Logistics · Live meetings",
  /** Audit columns. */
  "System",
] as const

export type ColumnGroup = (typeof COLUMN_GROUPS)[number]

/** How a column is painted in the table body. */
export type ColumnRenderer =
  | "text" // truncated text, full value on hover
  | "date" // condensed Eastern date-time
  | "ticker" // client symbol, linked, full name on hover
  | "people" // initials-circle avatars
  | "statusPill" // coloured pill, full status word inside
  | "bdaMark" // three-state FB-in-BDA icon
  | "checkMark" // check when populated
  | "bool" // Yes / No / em dash

export type MeetingColumnDef = {
  /** Stable id — this is the column name on `v_admin_meetings_all`, and what a
   *  saved view stores. Renaming one breaks every saved view that names it. */
  key: string
  /** The drawer's own label — what the column PICKER shows. */
  label: string
  /**
   * The label the TABLE HEADER shows, when it must be shorter than `label`.
   *
   * The table is auto-layout, so a column can never render narrower than its
   * header text: "Meeting Status" at 12px needs ~125px, "Status" needs ~70px.
   * These are what let the compact columns actually be compact. The picker still
   * shows the full `label`, so nothing becomes harder to find.
   */
  header?: string
  /** Header tooltip — spells out an abbreviated column's real meaning. */
  title?: string
  /** The table's own band/heading for this column — see COLUMN_GROUPS. NOT the
   *  drawer's section title, which groups the same fields differently. */
  section: ColumnGroup
  /** The drawer's field type — drives the default operator set in the filter builder. */
  type: MeetingFieldType
  width: string
  renderer: ColumnRenderer
  /** Centre + tighter padding: for columns painting a mark, not a sentence. */
  compact?: boolean
  /**
   * Only on the view once sql/patches/2026-09-09_admin_meetings_view_columns.sql
   * has been run. The picker greys these out until then rather than letting a
   * view be saved that would fail to query.
   */
  needsViewPatch?: boolean
  /**
   * ── EXTENSION POINT: related-table (1-1) columns ────────────────────────
   * NOT BUILT YET (see the docs' "Planned: related-table columns"). When a
   * column should come from a table joined 1-1 to the meeting — the account's
   * sector, the event's stage — declare it here instead of adding another view
   * column, and teach lib/meetings/query.ts to emit the PostgREST embed
   * (`accounts!inner(sector)`) plus a flattener for the nested result.
   *
   * Everything else already tolerates it: the catalog is keyed by `key`, saved
   * views store `key` strings, and the picker groups on `section`. Nothing
   * below assumes a column is a plain top-level field EXCEPT the query builder.
   */
  related?: { table: string; foreignKey: string; column: string }
}

/**
 * Per-field display facts, keyed by the drawer's `sourceKey`.
 *
 * `column` is the name on v_admin_meetings_all, which differs from the drawer's
 * key often enough that the mapping has to be explicit (the drawer calls it
 * `date_time`, the view calls it `meeting_date`).
 */
const SOURCE: Partial<
  Record<
    keyof MeetingRecord,
    {
      column: string
      width: string
      renderer: ColumnRenderer
      compact?: boolean
      needsViewPatch?: boolean
      header?: string
      title?: string
      /** The table band this column sits in. Required: the drawer's section
       *  title is deliberately NOT used as a fallback, so adding a field to the
       *  drawer forces a decision about where it belongs in the table. */
      group: ColumnGroup
    }
  >
> = {
  // ---- Overview ----
  date_time: {
    group: "Meeting",
    column: "meeting_date",
    width: "130px",
    renderer: "date",
    header: "Date",
    title: "Meeting date and time, Eastern",
  },
  // Full word, not the single letter it briefly was: "Live" / "Virtual" reads at
  // a glance and costs only 62px, against 110px before the tightening pass — so
  // the column stays narrow without making anyone decode it. 62px is the
  // measured floor (the "Type" header needs 59px, "Virtual" 55px).
  meeting_type: {
    group: "Meeting",
    column: "meeting_type_label",
    width: "62px",
    renderer: "text",
    header: "Type",
    title: "Meeting Type — Live or Virtual",
  },
  // Full word in a coloured pill, not the bare dot it briefly was. The colour
  // still makes the 4% of rows that are not Confirmed jump out of a long scroll,
  // but the word is readable without hovering. 90px is the measured floor (the
  // widest pill, "Confirmed", needs 86px) — still well under the original 125px.
  status: {
    group: "Meeting",
    column: "meeting_status_label",
    width: "90px",
    renderer: "statusPill",
    header: "Status",
    title: "Meeting Status",
  },
  investor: { column: "investor_name", width: "180px", renderer: "text", group: "Counterparty" },
  client: {
    group: "Client",
    column: "client_account_name",
    width: "92px",
    renderer: "ticker",
    header: "Client",
    // Sorting and the keyword box work off the FULL name, which every row has —
    // the ticker does not, and sorting a mostly-null column would look broken.
    title:
      "Client ticker — full name on hover. Links to the client's detail page. Sorted by full client name",
  },
  institution: { column: "institution_name", width: "200px", renderer: "text", group: "Counterparty" },
  city: { column: "city_name", width: "120px", renderer: "text", needsViewPatch: true, group: "Meeting" },
  state_region: { column: "state_region_name", width: "120px", renderer: "text", needsViewPatch: true, group: "Meeting" },
  group_meeting: { column: "group_meeting", width: "70px", renderer: "bool", compact: true, needsViewPatch: true, group: "Meeting" },
  hosted_in_hq: { column: "hosted_in_hq", width: "70px", renderer: "bool", compact: true, needsViewPatch: true, group: "Meeting" },
  general_notes: { column: "general_notes", width: "240px", renderer: "text", needsViewPatch: true, group: "Meeting" },

  // ---- Representatives ----
  // 94px, not 88: "Booked By" needs 93px of header at 12px Geist, so the old
  // 88px was never actually honoured.
  booked_by: { column: "booker_name", width: "94px", renderer: "people", title: "Initials — full name on hover", group: "Representatives" },
  on_behalf_of: {
    group: "Representatives",
    column: "on_behalf_of",
    width: "60px",
    renderer: "people",
    header: "OBO",
    title: "On Behalf Of — initials, full name on hover",
  },
  hosts: {
    group: "Representatives",
    column: "host_names",
    width: "76px",
    renderer: "people",
    header: "Host",
    title: "All hosts on the meeting — initials, full name on hover",
  },
  feedback_assignee: {
    group: "Representatives",
    column: "feedback_name",
    width: "88px",
    renderer: "people",
    title: "Feedback assignee (bcs_feedback) — initials, full name on hover",
  },
  client_booked: { column: "client_booked", width: "76px", renderer: "bool", compact: true, needsViewPatch: true, group: "Representatives" },
  host_notes: { column: "host_notes_label", width: "240px", renderer: "text", needsViewPatch: true, group: "Representatives" },

  // ---- Planning ----
  calendar: {
    group: "Workflow",
    column: "calendar_label",
    width: "96px",
    renderer: "text",
    title: "Calendar stage — truncated, full value on hover",
  },
  profile: { column: "profile_label", width: "120px", renderer: "text", needsViewPatch: true, group: "Workflow" },

  // ---- Feedback ----
  fb_in_bda: {
    group: "Workflow",
    column: "feedback_bda_label",
    width: "62px",
    renderer: "bdaMark",
    compact: true,
    header: "BDA",
    title:
      "FB in BDA — ✓ all in, ⃠ closed with no feedback, ◷ awaiting additional. Full value on hover",
  },
  fb_received: {
    group: "Workflow",
    column: "fb_received",
    width: "66px",
    renderer: "checkMark",
    compact: true,
    header: "Rec'd",
    title: "FB Rec'd — ✓ when the CRM carries a value. Full value on hover",
  },
  feedback_notes: { column: "feedback_notes", width: "240px", renderer: "text", needsViewPatch: true, group: "Workflow" },

  // ---- Logistics ----
  sent: { column: "sent", width: "60px", renderer: "bool", compact: true, needsViewPatch: true, group: "Logistics · Live meetings" },
  confirm: { column: "confirm", width: "72px", renderer: "bool", compact: true, needsViewPatch: true, group: "Logistics · Live meetings" },
  driver: { column: "driver", width: "64px", renderer: "bool", compact: true, needsViewPatch: true, group: "Logistics · Live meetings" },
  food_order: { column: "food_order", width: "120px", renderer: "text", needsViewPatch: true, group: "Logistics · Live meetings" },
  logistics_notes: { column: "logistics_notes", width: "240px", renderer: "text", needsViewPatch: true, group: "Logistics · Live meetings" },

  // ---- System ----
  modified_by: { column: "modified_by_name", width: "110px", renderer: "people", needsViewPatch: true, group: "System" },
  modified_on: { column: "modified_on", width: "130px", renderer: "date", needsViewPatch: true, group: "System" },
  created_by: { column: "created_by_name", width: "110px", renderer: "people", needsViewPatch: true, group: "System" },
  created_on: { column: "created_on", width: "130px", renderer: "date", needsViewPatch: true, group: "System" },
}

/**
 * Columns the LIST has but the drawer does not show as a field.
 *
 * Event is one of the original 14 CRM columns and has no drawer equivalent;
 * Ticker is the raw symbol, offered separately from the Client column that
 * renders it. They used to sit in a catch-all "List" band; they now take the
 * group they actually belong to, which is what removes "List" as a heading.
 */
const LIST_ONLY: MeetingColumnDef[] = [
  {
    key: "event_name",
    label: "Event",
    // A marketing event belongs to the client, and the event name leads with
    // the client's own ticker — so it bands with Client, not on its own.
    section: "Client",
    type: "text",
    width: "220px",
    renderer: "text",
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
    // Whether the RECORD is active or deactivated — a fact about the meeting
    // row, not about either party.
    section: "Meeting",
    type: "text",
    width: "90px",
    renderer: "text",
  },
]

/** The full catalog, in drawer order, then the list-only extras. */
export const COLUMN_CATALOG: MeetingColumnDef[] = [
  ...MEETING_SECTIONS.flatMap((section) =>
    section.fields.flatMap((f) => {
      const src = SOURCE[f.sourceKey]
      if (!src) return []
      return [
        {
          key: src.column,
          label: f.label,
          header: src.header,
          title: src.title,
          // The TABLE's group, not `section.title` — see COLUMN_GROUPS.
          section: src.group,
          type: f.type,
          width: src.width,
          renderer: src.renderer,
          compact: src.compact,
          needsViewPatch: src.needsViewPatch,
        } satisfies MeetingColumnDef,
      ]
    }),
  ),
  ...LIST_ONLY,
]

const BY_KEY = new Map(COLUMN_CATALOG.map((c) => [c.key, c]))

export function getColumn(key: string): MeetingColumnDef | undefined {
  return BY_KEY.get(key)
}

export function isKnownColumn(key: string): boolean {
  return BY_KEY.has(key)
}

/**
 * The columns the original 14-column table showed, in its order. This is the
 * built-in default layout every built-in system view uses, so the page looks
 * exactly as it did before saved views existed until someone changes it.
 */
export const DEFAULT_COLUMNS: string[] = [
  "meeting_type_label",
  "meeting_status_label",
  "meeting_date",
  "client_account_name",
  "event_name",
  "institution_name",
  "investor_name",
  "host_names",
  "feedback_name",
  "booker_name",
  "on_behalf_of",
  "calendar_label",
  "feedback_bda_label",
  "fb_received",
]

/**
 * Always fetched, whatever the view asks for: the row identity and the two ids
 * the table needs to render links and open the drawer. Never shown as columns.
 */
export const ALWAYS_SELECT = ["meeting_id", "client_account_id", "client_ticker"] as const

/**
 * Header bands for a given column list — one band per run of consecutive
 * columns sharing a section.
 *
 * The table used to hard-code four bands over fourteen fixed columns. With a
 * user-chosen column set the bands have to be derived, and deriving them from
 * the catalog's own sections is what keeps the grouping meaningful: reorder
 * columns so Overview and Feedback interleave and you simply get more, narrower
 * bands rather than a wrong label.
 */
export function bandsFor(keys: string[]): { key: string; label: string; colSpan: number }[] {
  const out: { key: string; label: string; colSpan: number }[] = []
  keys.forEach((k, i) => {
    const section = getColumn(k)?.section ?? "Other"
    const last = out[out.length - 1]
    if (last && last.label === section) last.colSpan += 1
    // The key must be unique even when the same section appears twice.
    else out.push({ key: `${section}-${i}`, label: section, colSpan: 1 })
  })
  return out
}

/** Column indices at which a band starts — where the vertical dividers go. */
export function bandStarts(keys: string[]): Set<number> {
  const starts = new Set<number>()
  let cursor = 0
  for (const b of bandsFor(keys)) {
    // Index 0 needs no divider: there is nothing to its left to divide from.
    if (cursor > 0) starts.add(cursor)
    cursor += b.colSpan
  }
  return starts
}

/**
 * Catalog grouped for the PICKER — one heading per group, in COLUMN_GROUPS
 * order, with catalog order preserved inside each.
 *
 * Grouped globally rather than by consecutive runs, unlike `bandsFor`. The two
 * differ on purpose: a table band must be CONTIGUOUS (it spans adjacent columns,
 * so a group split across the row is genuinely two bands), whereas the picker is
 * a list and should show each group exactly once. Since the drawer's field order
 * interleaves groups — Investor sits between Status and Client — a
 * consecutive-run grouping would print "Meeting" and "Counterparty" twice each.
 */
export function catalogBySection(): { section: ColumnGroup; columns: MeetingColumnDef[] }[] {
  return COLUMN_GROUPS.map((group) => ({
    section: group,
    columns: COLUMN_CATALOG.filter((c) => c.section === group),
  })).filter((g) => g.columns.length > 0)
}

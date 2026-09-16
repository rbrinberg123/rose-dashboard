/**
 * The note-record drawer's data shape and its FIELD DEFINITIONS.
 *
 * Same contract as lib/touchpoints/record.ts, lib/tasks/record.ts,
 * lib/events/record.ts and lib/meeting-record.ts: every section of the drawer
 * renders from the `NOTE_SECTIONS` list below — `{ label, sourceKey, type }` —
 * rather than hand-written JSX per field, and the table's column catalog is
 * DERIVED from the same list (lib/notes/spec.ts) so the two can never drift.
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
 * ── WHAT A NOTE IS ─────────────────────────────────────────────────────────
 * public.client_notes mirrors the Dynamics `bcs_clientnote` entity: a monthly
 * client-review record, one per client per cycle. 693 live rows, note_date
 * 2026-02-04 .. 2026-09-11 — the whole archive is about seven months old.
 *
 * ── SOURCING NOTES (the full measurements are in the patch) ────────────────
 * THE BODY COMES FROM `_raw`. The mirror flattens `bcs_notestext` into
 * notes_text, but Dynamics also carries `bcs_notes` — the same note with its
 * LINE BREAKS INTACT. notes_text has them collapsed, so a note reads as a
 * run-on paragraph with arbitrary wraps; the two differ on 435 of 693 rows.
 * `note_body` is bcs_notes falling back to notes_text, and the drawer renders it
 * with whitespace preserved. The raw `notes_text` is kept as its own field so the
 * difference is visible rather than hidden.
 *
 * OWNER IS A REAL PERSON — unlike Touches, where owner is a per-account team.
 * `_ownerid_value@...lookuplogicalname` is "systemuser" on every row and the
 * owner is the note's author: Grace Andonian (364) and Robert Brinberg (329).
 * But the mapper never flattened the NAME, and the two owner ids do not resolve
 * against public.users, so owner_name, created_by_name and modified_by_name are
 * all dug out of `_raw` by the view.
 *
 * STATUS AND RISK DRIVER ARE TRIMMED. Both are typed with a trailing newline
 * about half the time, so the raw columns hold "Stable" and "Stable\n" as
 * separate values (13 and 32 distinct raw; 8 and 21 after btrim). The view
 * trims both. "At Risk." survives as distinct from "At Risk" — a real typo in
 * two rows, not whitespace, and left alone.
 *
 * ACTION OWNER IS INITIALS, not a person record: "BM", "LW/RB", "BS/AC/RB".
 * 25 distinct codes across the 136 rows that carry one. It is shown verbatim —
 * there is nothing to resolve it against.
 *
 * CONSTANTS: state_label and status_label are both "Active" on all 693 rows.
 * The status that carries meaning is `status_text`, a free-text Rose field.
 */

/** One note, flattened for display. Keys are the field definitions' sourceKeys. */
export type NoteRecord = {
  note_id: string
  /** Drives the Client link; null on the 25 empty shells. */
  client_account_id: string | null

  // The note
  review_cycle: string | null
  note_date: string | null
  note_body: string | null
  notes_text: string | null

  // Assessment
  status_text: string | null
  primary_risk_driver: string | null

  // Action
  action_step: string | null
  action_owner: string | null
  action_deadline: string | null

  // Client
  client_account_name: string | null
  client_ticker: string | null

  // People
  owner_name: string | null
  owner_id: string | null
  created_by_name: string | null
  modified_by_name: string | null

  // System
  state_label: string | null
  status_label: string | null
  created_on: string | null
  modified_on: string | null
  is_recent: boolean | null
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
export type NoteFieldType = "text" | "date" | "person" | "toggle" | "notes" | "link"

export type NoteFieldDef = {
  label: string
  sourceKey: keyof NoteRecord
  type: NoteFieldType
}

export type NoteSectionDef = {
  key: string
  title: string
  fields: NoteFieldDef[]
}

/**
 * The drawer's sections, in order — Note, Assessment, Action, Client, People,
 * System.
 *
 * `note_body` and `notes_text` are both declared `notes`, which makes them
 * full-width and whitespace-preserving. That is the entire reason the body is
 * sourced from `_raw`: rendered this way, bcs_notes shows the "Status: … /
 * Overall Sentiment: … / Primary Risk Driver: … / Key Points:" structure the
 * author actually typed, and notes_text does not.
 */
export const NOTE_SECTIONS: NoteSectionDef[] = [
  {
    key: "note",
    title: "Note",
    fields: [
      { label: "Review Cycle", sourceKey: "review_cycle", type: "text" },
      { label: "Date", sourceKey: "note_date", type: "date" },
      { label: "Note", sourceKey: "note_body", type: "notes" },
    ],
  },
  {
    key: "assessment",
    title: "Assessment",
    fields: [
      { label: "Status", sourceKey: "status_text", type: "text" },
      { label: "Primary Risk Driver", sourceKey: "primary_risk_driver", type: "text" },
    ],
  },
  {
    key: "action",
    title: "Action",
    fields: [
      { label: "Action Step", sourceKey: "action_step", type: "notes" },
      // Initials, sometimes several — nothing to resolve them against.
      { label: "Action Owner", sourceKey: "action_owner", type: "text" },
      { label: "Action Due", sourceKey: "action_deadline", type: "date" },
    ],
  },
  {
    key: "client",
    title: "Client",
    fields: [{ label: "Client", sourceKey: "client_account_name", type: "link" }],
  },
  {
    key: "people",
    title: "People",
    fields: [
      { label: "Owner", sourceKey: "owner_name", type: "person" },
      { label: "Created By", sourceKey: "created_by_name", type: "person" },
      { label: "Modified By", sourceKey: "modified_by_name", type: "person" },
    ],
  },
  {
    key: "system",
    title: "System",
    fields: [
      { label: "Created On", sourceKey: "created_on", type: "date" },
      { label: "Modified On", sourceKey: "modified_on", type: "date" },
      // The flattened column as stored — kept so the difference against the
      // _raw-sourced body above is visible rather than hidden. See the header.
      { label: "Note (flattened source)", sourceKey: "notes_text", type: "notes" },
    ],
  },
]

/**
 * The header strip above the sections: Review Cycle, then Status.
 * The Client is the headline itself and is rendered by the pane, not from here.
 */
export const NOTE_HEADER_FIELDS: NoteFieldDef[] = [
  { label: "Review Cycle", sourceKey: "review_cycle", type: "text" },
  { label: "Status", sourceKey: "status_text", type: "text" },
]

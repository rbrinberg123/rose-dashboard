import * as React from "react"
import { format, parseISO } from "date-fns"
import {
  NOTE_STATUS_PILL as NOTE_STATUS_STYLES,
  NOTE_STATUS_PILL_FALLBACK as NOTE_STATUS_FALLBACK,
} from "@/lib/design"

/**
 * CLIENT STATUS (latest note) — the shared pill and its colour key.
 *
 * Extracted verbatim from the Client Portfolio table so every page showing a
 * client's status shows the SAME pill, the same five values and the same
 * colours. The palette itself lives one level further out, in lib/design.ts
 * (`NOTE_STATUS_PILL`), which the Client Statistics "Clients by Status" donut
 * also reads — so pill, key and chart cannot drift.
 *
 * Source field: `v_client_portfolio.note_status`, dated by `note_status_date`.
 * At Risk = urgent red, Lost = muted gray, Stable/Strong = healthy green,
 * New Client = navy tint; an unrecognised value falls back to gray so a new
 * status surfaces rather than vanishing.
 */

/** Sort + filter order, most-urgent first. Drives the severity sort, the filter
 *  dropdown and the legend, so "At Risk" always surfaces at the top / front. */
export const NOTE_STATUS_ORDER = [
  "At Risk",
  "Lost",
  "New Client",
  "Stable",
  "Strong",
] as const

/** Severity rank by status, for sorting. Unknown values sort last. */
export const NOTE_STATUS_RANK: Record<string, number> = Object.fromEntries(
  NOTE_STATUS_ORDER.map((s, i) => [s, i]),
)

function safeParseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = parseISO(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * The status pill. `date` is optional and only feeds the hover title — pass the
 * row's `note_status_date` where you have it so the pill can say how current the
 * status is. A client with no note on record renders an em dash, not an empty
 * pill.
 */
export function NoteStatusPill({
  status,
  date,
}: {
  status: string | null | undefined
  date?: string | null | undefined
}) {
  if (!status) return <span className="text-muted-foreground">—</span>
  const style = NOTE_STATUS_STYLES[status] ?? NOTE_STATUS_FALLBACK
  const d = safeParseDate(date)
  const title = d ? `${status} — as of ${format(d, "MM/dd/yy")}` : status
  return (
    <span
      title={title}
      // Styling hook only — lets a page's print CSS reach the pill without
      // guessing at column positions. Inert on screen.
      data-status-pill=""
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: style.bg, color: style.fg }}
    >
      {status}
    </span>
  )
}

/**
 * The colour key that lets someone read the pills. Deliberately tiny (9px) and
 * inline — it sits in a page's helper-text row, not as a block of its own.
 * `label` is overridable only so a page can name the column it explains.
 */
export function NoteStatusLegend({
  label = "Status (latest note):",
}: {
  label?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold text-foreground">{label}</span>
      {NOTE_STATUS_ORDER.map((s) => {
        const style = NOTE_STATUS_STYLES[s]
        return (
          <span
            key={s}
            style={{
              backgroundColor: style.bg,
              color: style.fg,
              padding: "1px 6px",
              borderRadius: "10px",
              fontSize: "9px",
              fontWeight: 500,
            }}
          >
            {s}
          </span>
        )
      })}
    </div>
  )
}

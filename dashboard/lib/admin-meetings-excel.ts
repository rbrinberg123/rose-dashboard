import type { AdminMeetingRow } from "@/lib/types"
import { ymd } from "@/lib/client-todo-excel"
import { getColumn, type MeetingColumnDef } from "@/lib/meetings/columns"

/**
 * The Meetings sheet mirrors the ACTIVE SAVED VIEW: its columns, in its order,
 * over the rows on screen.
 *
 * ── THE SHEET KEEPS FULL, HUMAN-READABLE VALUES ────────────────────────────
 * None of the screen's compaction reaches the export. The table paints a ticker,
 * a coloured pill, an icon; the sheet writes the full client NAME, the plain
 * word "Confirmed" with no tint, the real "Closed - All in" rather than a check.
 * That is deliberate: the compaction exists to fit a screen, and a spreadsheet
 * has no such constraint — someone filtering or pivoting this needs the words.
 *
 * The only transformation is TYPE, not wording: dates go in as real Dates so
 * Excel sorts them natively, and booleans as "Yes"/"No" rather than TRUE/FALSE.
 *
 * Two columns are always present regardless of the view, because they answer the
 * first two questions anyone asks of a CRM dump and neither is guessable from
 * the rest: the full client name and the row's State (is this deactivated?).
 */

/** Rendered label for a column in the sheet header. */
function headerFor(col: MeetingColumnDef): string {
  // The sheet uses the drawer's full label, never the table's abbreviated one —
  // "On Behalf Of", not "OBO".
  return col.label
}

/** One cell value: full text, a real Date, or a Yes/No word. */
function valueFor(col: MeetingColumnDef, row: AdminMeetingRow): string | Date | null {
  const raw = (row as unknown as Record<string, unknown>)[col.key]
  if (raw === null || raw === undefined || raw === "") return null
  if (typeof raw === "boolean") return raw ? "Yes" : "No"
  if (col.type === "date" || col.renderer === "date") {
    const d = new Date(String(raw))
    return Number.isNaN(d.getTime()) ? String(raw) : d
  }
  return String(raw)
}

/** Sensible column width for a header, since the catalog's px widths are screen units. */
function sheetWidth(col: MeetingColumnDef): number {
  if (col.type === "date" || col.renderer === "date") return 20
  if (col.type === "notes") return 40
  if (col.type === "person") return 22
  return Math.min(36, Math.max(12, col.label.length + 6))
}

/**
 * Download the CURRENT VIEW as .xlsx.
 *
 * `rows` is what the table is showing (the view's server-side filter plus the
 * keyword box, in the active sort order), and `columns` is the view's resolved
 * column list — so the sheet and the screen can never disagree about which
 * columns or which rows.
 *
 * Missing values are left BLANK rather than "—" or "None", so a gap in the CRM
 * reads as a gap in the sheet.
 *
 * ExcelJS is imported lazily so its weight only loads when someone exports —
 * same shape as lib/client-todo-excel.ts and lib/pipeline-excel.ts.
 */
export async function exportAdminMeetings(
  rows: AdminMeetingRow[],
  columns: MeetingColumnDef[],
): Promise<void> {
  const wb = await buildAdminMeetingsWorkbook(rows, columns)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `crm-meetings_${ymd(new Date())}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * The columns the sheet always carries, appended if the view does not already
 * show them. See the header note: the full client name and State.
 */
const ALWAYS_IN_SHEET = ["client_account_name", "state_label"] as const

function sheetColumns(columns: MeetingColumnDef[]): MeetingColumnDef[] {
  const out = [...columns]
  const present = new Set(out.map((c) => c.key))
  for (const key of ALWAYS_IN_SHEET) {
    if (present.has(key)) continue
    const col = getColumn(key)
    if (col) out.push(col)
  }
  return out
}

/** The workbook itself, split from the download so it can be exercised without a DOM. */
export async function buildAdminMeetingsWorkbook(
  rows: AdminMeetingRow[],
  columns: MeetingColumnDef[],
) {
  const mod = await import("exceljs")
  const ExcelJS = (mod as { default?: typeof import("exceljs") }).default ?? mod

  const cols = sheetColumns(columns)

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Meetings")

  ws.columns = cols.map((c) => ({ header: headerFor(c), key: c.key, width: sheetWidth(c) }))

  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: "FFFFFFFF" } }
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E2858" } }
  head.alignment = { vertical: "middle" }

  for (const r of rows) {
    ws.addRow(cols.map((c) => valueFor(c, r)))
  }

  // Excel's own date formatting on whichever columns are dates — the position is
  // no longer fixed, so it is derived rather than hard-coded to column 3.
  cols.forEach((c, i) => {
    if (c.type === "date" || c.renderer === "date") {
      ws.getColumn(i + 1).numFmt = "yyyy-mm-dd hh:mm"
    }
  })

  // A filter bar over the whole used range, so a large sheet is usable the
  // moment it opens.
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  ws.views = [{ state: "frozen", ySplit: 1 }]

  return wb
}

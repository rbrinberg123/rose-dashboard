import type { ColumnDef } from "./types"

/**
 * Excel export for the CRM admin tables — SHARED by Meetings and Events.
 *
 * The sheet mirrors the ACTIVE SAVED VIEW: its columns, in its order, over the
 * rows on screen.
 *
 * ── THE SHEET KEEPS FULL, HUMAN-READABLE VALUES ────────────────────────────
 * None of the screen's compaction reaches the export. The table paints a ticker,
 * a coloured pill, an icon; the sheet writes the full client NAME, the plain
 * word with no tint, the real underlying value rather than a mark. That is
 * deliberate: the compaction exists to fit a screen, and a spreadsheet has no
 * such constraint — someone filtering or pivoting this needs the words.
 *
 * The only transformation is TYPE, not wording: dates go in as real Dates so
 * Excel sorts them natively, and booleans as "Yes"/"No" rather than TRUE/FALSE.
 *
 * ExcelJS is imported lazily so its weight only loads when someone exports.
 */

type Row = Record<string, unknown>

/** Rendered label for a column in the sheet header — never the abbreviation. */
function headerFor(col: ColumnDef): string {
  return col.label
}

/** One cell value: full text, a real Date, or a Yes/No word. */
function valueFor(col: ColumnDef, row: Row): string | number | Date | null {
  const raw = row[col.key]
  if (raw === null || raw === undefined || raw === "") return null
  if (typeof raw === "boolean") return raw ? "Yes" : "No"
  if (typeof raw === "number") return raw
  if (col.type === "date") {
    const d = new Date(String(raw))
    return Number.isNaN(d.getTime()) ? String(raw) : d
  }
  return String(raw)
}

/** Sensible width, since the catalog's px widths are screen units. */
function sheetWidth(col: ColumnDef): number {
  if (col.type === "date") return 20
  if (col.type === "notes") return 40
  if (col.type === "person") return 22
  return Math.min(36, Math.max(12, col.label.length + 6))
}

export type ExcelExportOptions = {
  /** Worksheet name, e.g. "Meetings". */
  sheetName: string
  /** Download filename stem, e.g. "crm-meetings". */
  fileStem: string
  /**
   * Columns always present regardless of the view, appended if the view does not
   * already show them — the questions everyone asks of a CRM dump that are not
   * guessable from the rest.
   */
  alwaysInclude?: string[]
  /** Resolve one of those keys against the entity's catalog. */
  getColumn?: (key: string) => ColumnDef | undefined
}

function sheetColumns(columns: ColumnDef[], opts: ExcelExportOptions): ColumnDef[] {
  const out = [...columns]
  const present = new Set(out.map((c) => c.key))
  for (const key of opts.alwaysInclude ?? []) {
    if (present.has(key)) continue
    const col = opts.getColumn?.(key)
    if (col) out.push(col)
  }
  return out
}

/** `YYYY-MM-DD` for the filename. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** The workbook itself, split from the download so it can be exercised without a DOM. */
export async function buildWorkbook(
  rows: Row[],
  columns: ColumnDef[],
  opts: ExcelExportOptions,
) {
  const mod = await import("exceljs")
  const ExcelJS = (mod as { default?: typeof import("exceljs") }).default ?? mod

  const cols = sheetColumns(columns, opts)

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(opts.sheetName)

  ws.columns = cols.map((c) => ({ header: headerFor(c), key: c.key, width: sheetWidth(c) }))

  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: "FFFFFFFF" } }
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E2858" } }
  head.alignment = { vertical: "middle" }

  for (const r of rows) {
    ws.addRow(cols.map((c) => valueFor(c, r)))
  }

  // Excel's own date formatting on whichever columns are dates — derived, since
  // the position is not fixed once the view chooses its own columns.
  cols.forEach((c, i) => {
    if (c.type === "date") ws.getColumn(i + 1).numFmt = "yyyy-mm-dd hh:mm"
  })

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  ws.views = [{ state: "frozen", ySplit: 1 }]

  return wb
}

/**
 * Download the current view as .xlsx.
 *
 * Missing values are left BLANK rather than "—" or "None", so a gap in the CRM
 * reads as a gap in the sheet.
 */
export async function exportToExcel(
  rows: Row[],
  columns: ColumnDef[],
  opts: ExcelExportOptions,
): Promise<void> {
  const wb = await buildWorkbook(rows, columns, opts)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${opts.fileStem}_${ymd(new Date())}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

import type { AdminMeetingRow } from "@/lib/types"
import { ymd } from "@/lib/client-todo-excel"

/**
 * The 14 CRM columns in the page's order, plus `State` — which the page does not
 * render but the export carries, because "is this row deactivated?" is the first
 * question anyone asks of a 10k-row dump.
 *
 * Kept beside the table's own column list rather than derived from it: the sheet
 * is a deliberate artefact, and a column added to the screen should be a decision
 * to add here too, not an automatic consequence.
 */
const COLUMNS: { header: string; width: number; get: (r: AdminMeetingRow) => string | Date | null }[] = [
  { header: "Meeting Type", width: 14, get: (r) => r.meeting_type_label },
  { header: "Meeting Status", width: 16, get: (r) => r.meeting_status_label },
  { header: "Date", width: 20, get: (r) => (r.meeting_date ? new Date(r.meeting_date) : null) },
  { header: "Client", width: 30, get: (r) => r.client_account_name },
  { header: "Event", width: 34, get: (r) => r.event_name },
  { header: "Institution", width: 30, get: (r) => r.institution_name },
  { header: "Investor", width: 26, get: (r) => r.investor_name },
  { header: "Host", width: 24, get: (r) => r.host_names },
  { header: "Feedback", width: 20, get: (r) => r.feedback_name },
  { header: "Booked By", width: 20, get: (r) => r.booker_name },
  { header: "On Behalf Of", width: 20, get: (r) => r.on_behalf_of },
  { header: "Calendar", width: 18, get: (r) => r.calendar_label },
  { header: "FB in BDA", width: 14, get: (r) => r.feedback_bda_label },
  { header: "FB Rec'd", width: 14, get: (r) => r.fb_received },
  { header: "State", width: 12, get: (r) => r.state_label },
]

/**
 * Download the CURRENT VIEW as .xlsx — `rows` is what the table is showing
 * (keyword filter applied, in the active sort order), not the whole dataset.
 *
 * Dates are written as real Dates so Excel sorts and filters them natively;
 * everything else goes in as text. Missing values are left BLANK rather than
 * "—" or "None", so a gap in the CRM reads as a gap in the sheet.
 *
 * ExcelJS is imported lazily so its weight only loads when someone exports —
 * same shape as lib/client-todo-excel.ts and lib/pipeline-excel.ts.
 */
export async function exportAdminMeetings(rows: AdminMeetingRow[]): Promise<void> {
  const wb = await buildAdminMeetingsWorkbook(rows)
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

/** The workbook itself, split from the download so it can be exercised without a DOM. */
export async function buildAdminMeetingsWorkbook(rows: AdminMeetingRow[]) {
  const mod = await import("exceljs")
  const ExcelJS = (mod as { default?: typeof import("exceljs") }).default ?? mod

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Meetings")

  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.header, width: c.width }))

  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: "FFFFFFFF" } }
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E2858" } }
  head.alignment = { vertical: "middle" }

  for (const r of rows) {
    ws.addRow(COLUMNS.map((c) => c.get(r) ?? null))
  }

  // Excel's own date formatting for the Date column (3rd), and a filter bar over
  // the whole used range so a 10k-row sheet is usable the moment it opens.
  ws.getColumn(3).numFmt = "yyyy-mm-dd hh:mm"
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } }
  ws.views = [{ state: "frozen", ySplit: 1 }]

  return wb
}

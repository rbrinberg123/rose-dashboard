import type { ClientTodoTableRow } from "@/lib/types"
import {
  baseTicker,
  dayToDate,
  formatDaySpan,
  stripTickerPrefix,
} from "@/lib/client-todo-format"

// Local YYYY-MM-DD for the filename (today's date), so repeated exports don't
// overwrite each other. Same helper as lib/pipeline-excel.ts. Exported so the
// To-Do List's PDF export names its file off the same function — the two
// downloads stay `client-todo-list_<same date>.{xlsx,pdf}`.
export function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Build and download an .xlsx of the To-Do List rows exactly as they appear on
 * screen — `rows` is the CURRENT VIEW (search + Client Manager filter applied,
 * in the active sort order), not the whole table.
 *
 * SCOPING: nothing is fetched here. The rows handed in are the ones already
 * rendered, which the server loader filtered through `resolveClientScope` (and
 * re-filtered through `visibleTodoRows`), so the export can only ever contain
 * clients the viewer is authorised to see.
 *
 * Cells are flattened to real types where a real type exists — counts as
 * numbers, the two touchpoint dates as Dates — so the sheet sorts and filters
 * natively in Excel. Missing values are left BLANK rather than 0 or "None", so
 * "unknown" never reads as "zero" in a spreadsheet.
 *
 * ExcelJS is imported lazily so its weight only loads when someone exports.
 * Mirrors lib/pipeline-excel.ts throughout.
 */
export async function exportClientTodoList(rows: ClientTodoTableRow[]): Promise<void> {
  const wb = await buildClientTodoWorkbook(rows)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `client-todo-list_${ymd(new Date())}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * The workbook itself, split out from the download so the sheet's shape and cell
 * types can be exercised without a DOM.
 */
export async function buildClientTodoWorkbook(rows: ClientTodoTableRow[]) {
  const mod = await import("exceljs")
  const ExcelJS = (mod as { default?: typeof import("exceljs") }).default ?? mod

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("To-Do List")

  const DATE_FMT = "mmm d, yyyy"
  ws.columns = [
    { header: "Ticker", key: "ticker", width: 12 },
    { header: "Meetings YTD", key: "ytd", width: 14 },
    { header: "Meetings L12M", key: "l12m", width: 15 },
    { header: "Last Touch (CRM)", key: "lastTouch", width: 18, style: { numFmt: DATE_FMT } },
    { header: "Last Data Upload", key: "lastUpload", width: 18, style: { numFmt: DATE_FMT } },
    { header: "Current & Upcoming Event", key: "eventName", width: 42 },
    { header: "Event Status", key: "eventStatus", width: 18 },
    { header: "Event Date", key: "eventDate", width: 22 },
    { header: "Event Meetings", key: "eventMeetings", width: 15 },
    { header: "Open Slots", key: "openSlots", width: 12 },
    { header: "Open Reports", key: "openReports", width: 14 },
    { header: "Open Collections", key: "openCollections", width: 16 },
    { header: "Notes", key: "notes", width: 60 },
  ]

  for (const r of rows) {
    const hasEvent = Boolean(r.next_event_id)
    ws.addRow({
      ticker: r.ticker_symbol ? baseTicker(r.ticker_symbol) : "",
      ytd: r.meetings_ytd,
      l12m: r.meetings_l12m,
      // null (never touched / never uploaded) leaves the cell empty.
      lastTouch: dayToDate(r.last_touch_date),
      lastUpload: dayToDate(r.last_data_upload_date),
      // Same ticker-prefix strip the table shows.
      eventName: r.next_event_name
        ? stripTickerPrefix(r.next_event_name, r.ticker_symbol)
        : "",
      eventStatus: r.next_event_state_label ?? "",
      // A window, not a single day, so this stays the displayed text span —
      // there is no single date that would be correct for a multi-day event.
      eventDate: hasEvent ? formatDaySpan(r.next_event_start, r.next_event_end) : "",
      eventMeetings: hasEvent ? r.next_event_confirmed_meetings : null,
      // null = the event has no slot capacity set, which is NOT the same as 0.
      openSlots: hasEvent ? r.next_event_open_slots : null,
      openReports: r.open_reports,
      openCollections: r.open_collections,
      notes: r.note ?? "",
    })
  }

  // Bold, frozen header row so it stays visible while scrolling and sorting.
  const header = ws.getRow(1)
  header.font = { bold: true }
  ws.views = [{ state: "frozen", ySplit: 1 }]
  // Excel's own filter dropdowns across the header, so the sheet is immediately
  // sortable/filterable on the real-typed columns.
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } }

  return wb
}

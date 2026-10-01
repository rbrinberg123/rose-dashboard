import { HEALTH_RATING_LABEL, isHealthRating } from "@/lib/client-health-prompt"
import { ymd } from "@/lib/client-todo-excel"

/** One on-screen Client Health row, as the export needs it. */
export type HealthExportRow = {
  client_name: string
  note: string | null
  rating: string | null
  overridden: boolean
  ai_generated_at: string | null
}

/**
 * Download an .xlsx of the Client Health rows exactly as shown (filter + search
 * applied, A→Z). Same lazy-ExcelJS pattern as lib/client-todo-excel.ts. The
 * rows come from the super-user-gated page, so nothing is fetched here.
 */
export async function exportClientHealth(rows: HealthExportRow[]): Promise<void> {
  const mod = await import("exceljs")
  const ExcelJS = (mod as { default?: typeof import("exceljs") }).default ?? mod

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Client Health")
  ws.columns = [
    { header: "Client", key: "client", width: 36 },
    { header: "Note", key: "note", width: 90 },
    { header: "Rating", key: "rating", width: 24 },
    { header: "Overridden", key: "overridden", width: 12 },
    { header: "AI Generated", key: "generated", width: 18, style: { numFmt: "mmm d, yyyy" } },
  ]
  for (const r of rows) {
    ws.addRow({
      client: r.client_name,
      note: r.note ?? "",
      rating: r.rating && isHealthRating(r.rating) ? HEALTH_RATING_LABEL[r.rating] : "",
      overridden: r.overridden ? "Yes" : "No",
      generated: r.ai_generated_at ? new Date(r.ai_generated_at) : null,
    })
  }
  ws.getColumn("note").alignment = { wrapText: true, vertical: "top" }
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: "frozen", ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `client-health_${ymd(new Date())}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

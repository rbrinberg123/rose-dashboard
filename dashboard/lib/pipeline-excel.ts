import type { Pipeline30dRow } from "@/lib/types"
import type { HostPick } from "@/lib/host-suggestion"

// Visible "Type" pill wording, mirrored from the Upcoming Meetings table so the
// exported Type column matches exactly what's on screen.
function isCallType(label: string | null): boolean {
  if (!label) return false
  return /call|phone|dial/i.test(label)
}
function typeLabel(row: Pipeline30dRow): string {
  if (row.is_in_person === true) return "In-person"
  if (isCallType(row.meeting_type_label)) return "Call"
  return "Virtual"
}

// Local YYYY-MM-DD for the filename (today's date), so repeated exports don't
// overwrite each other.
function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// Turn one meeting's host analysis into the two export cells: the suggested host
// and a human-readable reason. The analysis (`pick`) already enforces the
// exclusions — OOO hosts are dropped entirely and Remote hosts are dropped for
// in-person meetings — so `candidates[0]` is always a valid suggestion.
//
// Reason = availability · prior-hosting relationship, with the engine's "usual
// host was skipped" note appended when it fired. Empty for rows that already
// have a host (no `pick` is passed for those).
function suggestionCells(pick: HostPick | undefined): { host: string; reason: string } {
  if (!pick) return { host: "", reason: "" }
  const def = pick.candidates[0]
  if (!def) {
    // Nothing suggestable: either no host has ever hosted this client/institution,
    // or every prior host is excluded that day (out of office / remote for a live).
    const reason = pick.noPrior
      ? "No prior host on record for this client or institution"
      : pick.bumpNote ?? "All prior hosts are unavailable that day"
    return { host: "", reason }
  }
  const parts = [def.free ? "Available" : "Busy at this time"]
  if (def.rationale) parts.push(def.rationale)
  let reason = parts.join(" · ")
  if (pick.bumpNote) reason += ` · ${pick.bumpNote}`
  return { host: def.name, reason }
}

// Build and download an .xlsx of the given rows (already filtered + sorted to the
// current view). Columns mirror the on-screen table. ExcelJS is imported lazily
// so its weight only loads when the user actually exports.
//
// Note on dates: the table shows the meeting's stored wall-clock digits (read as
// UTC), and ExcelJS converts a Date via its UTC epoch with no timezone shift, so
// passing `new Date(meeting_date)` yields an Excel date matching the screen.
export async function exportUpcomingMeetings(
  rows: Pipeline30dRow[],
  picks: Map<string, HostPick>,
): Promise<void> {
  const mod = await import("exceljs")
  const ExcelJS = (mod as { default?: typeof import("exceljs") }).default ?? mod

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Upcoming Meetings")

  // Header text, key, width (Excel column units) and format — in table order,
  // with Suggested Host / Suggestion Reason appended after the Host column.
  ws.columns = [
    { header: "When", key: "when", width: 22, style: { numFmt: "mmm d, yyyy h:mm AM/PM" } },
    { header: "Days", key: "days", width: 8 },
    { header: "Client", key: "client", width: 30 },
    { header: "Institution", key: "institution", width: 30 },
    { header: "Investor", key: "investor", width: 30 },
    { header: "Type", key: "type", width: 12 },
    { header: "Booker", key: "booker", width: 22 },
    { header: "Host", key: "host", width: 28 },
    { header: "Suggested Host", key: "suggestedHost", width: 22 },
    { header: "Suggestion Reason", key: "suggestionReason", width: 60 },
  ]

  for (const r of rows) {
    // Suggestion columns apply only to host-less rows; assigned rows leave them
    // blank (their host already shows in the Host column). `picks` only holds
    // analyses for unassigned meetings, so assigned rows resolve to blanks.
    const { host: suggestedHost, reason: suggestionReason } = suggestionCells(
      r.host_id ? undefined : picks.get(r.meeting_id),
    )
    ws.addRow({
      when: new Date(r.meeting_date),
      days: r.days_until,
      client: r.client_account_name ?? "",
      institution: r.institution_name ?? "",
      investor: r.investor_text ?? "",
      type: typeLabel(r),
      booker: r.booker_name ?? "",
      // Suggested hosts on screen are placeholders that aren't saved, so the Host
      // column shows the real assigned host and marks host-less rows Unassigned;
      // the suggestion lives in the two dedicated columns below.
      host: r.host_name ?? "Unassigned",
      suggestedHost,
      suggestionReason,
    })
  }

  // Bold, frozen header row so it stays visible while scrolling and sorting.
  const header = ws.getRow(1)
  header.font = { bold: true }
  ws.views = [{ state: "frozen", ySplit: 1 }]

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `Upcoming_Meetings_${ymd(new Date())}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

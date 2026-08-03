// Builds the Outlook-safe HTML for the weekly "Time Off" digest.
//
// Same Outlook-safe rules as the other digests (Live Outreach / Week Ahead):
// fixed-width tables, inline styles only, web-safe Arial, no flexbox/grid, and a
// <td bgcolor> "pill" for every colored fill (Outlook's Word engine drops
// background-color from inline <span>). Pure — no DOM / React — so it runs
// identically on the server or in a test.
//
// Palette is lifted straight from the Time Off page (app/time-off/time-off-view.tsx):
//   OOO pill    = fill #D6EBD9, border #6FAE78, text #2E6B3A  (filled green)
//   Remote pill = white fill, 1.5px border #3D5599, text #34487F  (outlined blue)
//   navy #1E2858 · hairline #E5E8EC
//
// Returns a self-contained FRAGMENT (a wrapper <div> that sets the base font),
// NOT a full <html> document, so it drops straight into a Graph sendMail body.

import type { TimeOffEmailData, TimeOffDay, TimeOffMonthCell } from "./load"
import type { TimeOffRow } from "@/lib/types"

// ---- geometry --------------------------------------------------------------
const CONTAINER = 640
const MONTH_COL = 128 // 5 columns × 128 = 640
const MONTH_CELL_H = 96 // fixed month-cell height

// ---- palette (from the page) ----------------------------------------------
const NAVY = "#1E2858"
const INK = "#1A2233"
const MUTED = "#6B7280"
const FAINT = "#9AA1AD"
const HAIRLINE = "#E5E8EC"
const WHITE = "#FFFFFF"
const OOO = { fill: "#D6EBD9", border: "#6FAE78", text: "#2E6B3A" }
const REMOTE = { fill: "#FFFFFF", border: "#3D5599", text: "#34487F" }

function esc(s: unknown): string {
  if (s == null) return ""
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// ---- name / type formatting -----------------------------------------------
/** Strip credentials after a comma. "Scott Grossman, CFA" → "Scott Grossman". */
function cleanName(name: string): string {
  return name.split(",")[0].trim()
}

/** "Scott G." — first name + last initial (matches the page's Pill). Used in the
 *  header, today line, and the This Week card. */
function shortName(name: string): string {
  const parts = cleanName(name).split(/\s+/).filter(Boolean)
  if (parts.length === 0) return name
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

/** "S. Grossman" — first initial + last name. The compact form used in the dense
 *  month grid, where the surname disambiguates better than a last initial. */
function compactName(name: string): string {
  const parts = cleanName(name).split(/\s+/).filter(Boolean)
  if (parts.length === 0) return name
  if (parts.length === 1) return parts[0]
  return `${parts[0][0]}. ${parts[parts.length - 1]}`
}

// Short request-type suffix for the month-grid pills (e.g. "· Vac"). Remote
// entries carry no suffix — the outlined style already reads as "remote".
const TYPE_ABBREV: Record<string, string> = {
  Vacation: "Vac",
  Personal: "Pers",
  "Personal Day": "Pers",
  Sick: "Sick",
  "Sick Leave": "Sick",
  "Sick Day": "Sick",
  Bereavement: "Ber",
  Conference: "Conf",
  Jury: "Jury",
  "Jury Duty": "Jury",
  Holiday: "Hol",
  Parental: "Par",
  "Parental Leave": "Par",
  Maternity: "Mat",
  Paternity: "Pat",
}
function typeAbbrev(e: TimeOffRow): string {
  if (e.time_off_type === "Remote") return ""
  const label = e.request_type_label?.trim()
  if (!label) return ""
  return TYPE_ABBREV[label] ?? (label.length <= 4 ? label : `${label.slice(0, 4)}`)
}

// ---- pills -----------------------------------------------------------------
/**
 * A bordered name pill via <td bgcolor> + inline border. Outlook keeps the fill
 * (bgcolor attr) and the text color (span color); it squares the corners and can
 * thin the border, so OOO stays legible on its green fill and Remote stays legible
 * as navy-blue text on white even if the outline drops.
 */
function pill(e: TimeOffRow, label: string): string {
  const s = e.time_off_type === "Remote" ? REMOTE : OOO
  const bw = e.time_off_type === "Remote" ? "1.5px" : "1px"
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr><td bgcolor="${s.fill}" style="background-color:${s.fill};border:${bw} solid ${s.border};border-radius:4px;padding:1px 6px;font-size:11px;line-height:1.35;font-weight:bold;white-space:nowrap;color:${s.text};"><span style="color:${s.text};">${esc(label)}</span></td></tr></table>`
}

/** A horizontal row of name pills (shortName), flowing left→right on one line —
 *  each pill is a <td> so it flows right in Outlook. Em-dash when empty. */
function pillRow(entries: TimeOffRow[]): string {
  if (entries.length === 0) {
    return `<span style="color:${FAINT};font-size:12px;">&mdash;</span>`
  }
  const cells = entries
    .map((e) => `<td valign="middle" style="vertical-align:middle;padding:0 5px 0 0;">${pill(e, shortName(e.person))}</td>`)
    .join("")
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr>${cells}</tr></table>`
}

// ---- header ----------------------------------------------------------------
function legendPill(s: { fill: string; border: string; text: string }, bw: string, label: string): string {
  return `<td valign="middle" style="vertical-align:middle;padding:0 14px 0 0;">
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr>
      <td valign="middle" style="vertical-align:middle;padding:0 6px 0 0;"><table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr><td bgcolor="${s.fill}" width="20" height="12" style="width:20px;height:12px;background-color:${s.fill};border:${bw} solid ${s.border};border-radius:3px;font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td>
      <td valign="middle" style="vertical-align:middle;font-size:11px;"><span style="color:${MUTED};">${esc(label)}</span></td>
    </tr></table>
  </td>`
}

function header(d: TimeOffEmailData): string {
  const summary = `${d.outThisWeek} out this week &middot; ${d.oooThisWeek} OOO &middot; ${d.remoteThisWeek} remote`
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
    <tr><td style="padding:0 0 2px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.08em;"><span style="color:${FAINT};">Weekly &middot; Team</span></td></tr>
    <tr><td style="padding:0 0 4px 0;font-size:22px;font-weight:bold;line-height:1.2;"><span style="color:${INK};">Time Off &mdash; Week of ${esc(d.mondayLabel)}</span></td></tr>
    <tr><td style="padding:0 0 10px 0;font-size:13px;"><span style="color:${MUTED};">${summary}</span></td></tr>
    <tr><td style="padding:0 0 14px 0;">
      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr>
        ${legendPill(OOO, "1px", "OOO")}
        ${legendPill(REMOTE, "1.5px", "Remote")}
      </tr></table>
    </td></tr>
  </table>`
}

// ---- This Week card (navy left accent strip) -------------------------------
function weekDayRow(day: TimeOffDay, isLast: boolean): string {
  const border = isLast ? "" : `border-bottom:1px solid ${HAIRLINE};`
  return `<tr>
    <td width="60" valign="top" style="width:60px;vertical-align:top;padding:6px 8px 6px 0;${border}font-size:12px;font-weight:bold;white-space:nowrap;"><span style="color:${MUTED};">${esc(day.label)}</span></td>
    <td valign="top" style="vertical-align:top;padding:6px 0;${border}">${pillRow(day.entries)}</td>
  </tr>`
}

function thisWeekCard(d: TimeOffEmailData): string {
  const n = d.todayEntries.length
  const weekRows = d.weekDays.map((day, i) => weekDayRow(day, i === d.weekDays.length - 1)).join("")
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin:0;">
    <tr>
      <td width="5" bgcolor="${NAVY}" style="width:5px;background-color:${NAVY};font-size:1px;line-height:1px;">&nbsp;</td>
      <td valign="top" bgcolor="${WHITE}" style="vertical-align:top;background-color:${WHITE};border:1px solid ${HAIRLINE};border-left:0;padding:14px 16px;">
        <!-- Out today -->
        <div style="font-size:14px;font-weight:bold;padding:0 0 8px 0;"><span style="color:${NAVY};">${n}</span> <span style="color:${INK};">${n === 1 ? "person" : "people"} out or remote today</span> <span style="color:${FAINT};font-weight:normal;">&middot; ${esc(d.todayLabel)}</span></div>
        <div>${pillRow(d.todayEntries)}</div>
        <!-- Divider -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin:12px 0;"><tr><td bgcolor="${HAIRLINE}" height="1" style="height:1px;line-height:1px;font-size:1px;background-color:${HAIRLINE};">&nbsp;</td></tr></table>
        <!-- Week of … -->
        <div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;padding:0 0 8px 0;"><span style="color:${FAINT};">Week of ${esc(d.mondayLabel)}</span></div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;border-collapse:collapse;">${weekRows}</table>
      </td>
    </tr>
  </table>`
}

// ---- Full month grid -------------------------------------------------------
/** Compact stacked pill "S. Grossman · Vac" for a month cell. */
function monthPill(e: TimeOffRow): string {
  const s = e.time_off_type === "Remote" ? REMOTE : OOO
  const bw = e.time_off_type === "Remote" ? "1.5px" : "1px"
  const suffix = typeAbbrev(e)
  const label = suffix ? `${compactName(e.person)} &middot; ${esc(suffix)}` : esc(compactName(e.person))
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin:0 0 2px 0;"><tr><td bgcolor="${s.fill}" style="background-color:${s.fill};border:${bw} solid ${s.border};border-radius:3px;padding:0 4px;font-size:10px;line-height:1.4;font-weight:bold;white-space:nowrap;color:${s.text};"><span style="color:${s.text};">${label}</span></td></tr></table>`
}

function monthCell(cell: TimeOffMonthCell, isLastCol: boolean): string {
  const rightBorder = isLastCol ? "" : `border-right:1px solid ${HAIRLINE};`
  const bg = cell.isToday ? "#F2F4FB" : cell.inMonth ? WHITE : "#F7F8FA"
  const numColor = cell.inMonth ? INK : "#C7CCD4"
  const pills = cell.entries.map(monthPill).join("")
  return `<td width="${MONTH_COL}" height="${MONTH_CELL_H}" valign="top" bgcolor="${bg}" style="width:${MONTH_COL}px;height:${MONTH_CELL_H}px;vertical-align:top;background-color:${bg};border-bottom:1px solid ${HAIRLINE};${rightBorder}padding:4px 5px;overflow:hidden;">
    <div style="text-align:right;font-size:11px;font-weight:bold;padding:0 0 3px 0;"><span style="color:${numColor};">${cell.day}</span></div>
    ${pills}
  </td>`
}

function monthGrid(d: TimeOffEmailData): string {
  const headCells = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    .map(
      (w, i) =>
        `<td width="${MONTH_COL}" bgcolor="${NAVY}" style="width:${MONTH_COL}px;background-color:${NAVY};padding:5px 0;text-align:center;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;${i === 4 ? "" : `border-right:1px solid ${NAVY};`}"><span style="color:${WHITE};">${w}</span></td>`,
    )
    .join("")
  const bodyRows = d.monthWeeks
    .map((week) => `<tr>${week.map((c, i) => monthCell(c, i === 4)).join("")}</tr>`)
    .join("")
  // Title sits ABOVE the grid (not inside it) so the fixed-layout table's first
  // row is the 5-column navy header — that's what pins the column widths.
  return `<div style="padding:0 0 8px 0;font-size:16px;font-weight:bold;line-height:1.2;"><span style="color:${INK};">${esc(d.monthLabel)}</span></div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;table-layout:fixed;border:1px solid ${HAIRLINE};">
    <tr>${headCells}</tr>
    ${bodyRows}
  </table>`
}

// A fixed-width (CONTAINER) column that holds the This Week card and the month
// grid in the SAME inset, so both sections share identical left/right edges. The
// middle row is the section separator: vertical space, a thin dark-gray hairline
// (drawn as a 1px <td bgcolor> — the Outlook-reliable rule) inset to the content
// width, then more space. Order: This Week → space → line → space → month grid.
const DIVIDER_LINE = "#8A94A3"
function sectionColumn(inner: string): string {
  return `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">${inner}</table>`
}

/** The rich-HTML fragment for the Time Off digest email. */
export function buildTimeOffEmailHtml(d: TimeOffEmailData): string {
  const body = sectionColumn(`
    <tr><td style="padding:0;">${header(d)}</td></tr>
    <tr><td style="padding:0;">${thisWeekCard(d)}</td></tr>
    <tr><td height="20" style="height:20px;line-height:20px;font-size:1px;">&nbsp;</td></tr>
    <tr><td bgcolor="${DIVIDER_LINE}" height="1" style="height:1px;line-height:1px;font-size:1px;background-color:${DIVIDER_LINE};">&nbsp;</td></tr>
    <tr><td height="20" style="height:20px;line-height:20px;font-size:1px;">&nbsp;</td></tr>
    <tr><td style="padding:0;">${monthGrid(d)}</td></tr>`)
  return `<div style="font-family:Arial,Helvetica,sans-serif;background-color:${WHITE};color:${INK};padding:4px;">
${body}
</div>`
}

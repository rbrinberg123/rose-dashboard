// Builds the Outlook-safe email HTML for the weekly "Week Ahead" meetings digest.
//
// Formatting copies the Outstanding Feedback digest (app/feedback/feedback-email-html.ts):
// a PURE WHITE background (no grey band), rows separated only by hairlines (NO
// zebra), grey uppercase column headers (MUTED #9AA1AD over a hairline), and each
// TABLE section titled with a dark-navy count badge floated right (the feedback
// "N Outstanding" treatment). Same Outlook-safe rules as the other digests:
// fixed-width tables, inline styles only, web-safe Arial/Helvetica, no flexbox/
// grid, and the <td bgcolor> "pill" technique for EVERY colored fill (Outlook's
// Word engine drops background-color from inline <span>). Pure — no DOM / React.
//
// Row height is pinned: every data <td> sets line-height:1.2 and an exact padding
// (email clients inflate rows when these are left to defaults), and both data
// tables use table-layout:fixed so the declared column widths hold and cell
// padding stays inside them.
//
// The one colored surface is the AMBER (#FAEEDA / #854F0B) "in the office" card at
// the top; in-office days are otherwise flagged with amber accents.
//
// Returns a self-contained FRAGMENT (a wrapper <div> that sets the base font),
// NOT a full <html> document, so it drops straight into a Graph sendMail body.

import type { WeekAheadData, WeekAheadDay, WeekAheadMeeting } from "./load"

// ---- geometry --------------------------------------------------------------
const CONTAINER = 880

// All Upcoming Meetings — 7 columns, fixed widths summing to CONTAINER. Time is
// deliberately wide so "10:00 AM" sits comfortably; the width is reclaimed from
// the (hard-truncated) Institution and Investor columns.
const MCOLS = {
  date: 56,
  time: 84,
  client: 66,
  institution: 290,
  investor: 150,
  type: 84,
  host: 150,
} as const

// Hard-truncation limits (chars). Outlook ignores text-overflow:ellipsis, so we
// truncate in code and append "…"; nowrap is the belt-and-suspenders.
const T = {
  institution: 40,
  investor: 16,
  host: 14,
} as const

// ---- palette ---------------------------------------------------------------
const NAVY = "#1E2858"
const INK = "#1A2233"
const MUTED = "#9AA1AD"
const SUBTLE = "#6B7280"
const HAIRLINE = "#E5E8EC" // column-header + section hairlines
const ROW_LINE = "#EEF1F5" // within-day row separator (lighter)
const DAY_SEP = "#97A6BC" // between-day-group separator: 1px, darker than ROW_LINE
const BOX_BORDER = "#E7EBF1" // week-grid day-box border
const WHITE = "#FFFFFF"
const AMBER = { bg: "#FAEEDA", text: "#854F0B", border: "#EAD9B4" }
const LIVE = { bg: "#E9F3EC", text: "#2E6B45" }
const VIRTUAL = { bg: "#EEF2FB", text: "#1E2858" }
const HYBRID = { bg: "#F3ECFB", text: "#6B3FA0" }

function esc(s: unknown): string {
  if (s == null) return ""
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// Truncate to n chars with a trailing ellipsis; full text lives in the cell title=.
function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}

// Colored fill via <td bgcolor> inside a tiny nested table — the only
// Outlook-reliable way to keep a background color. NB Outlook squares off
// border-radius, but the color + text survive. Place inside a <td>.
function pill(bg: string, fg: string, label: string, radius = 9, padding = "1px 8px", align = ""): string {
  const alignAttr = align ? ` align="${align}"` : ""
  return `<table${alignAttr} cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr><td bgcolor="${bg}" style="background-color:${bg};font-size:11px;line-height:1.2;font-weight:bold;padding:${padding};border-radius:${radius}px;white-space:nowrap;color:${fg};"><span style="color:${fg};">${label}</span></td></tr></table>`
}

/** Live/Virtual/Hybrid pill. */
function typePill(kind: "Live" | "Virtual" | "Hybrid"): string {
  const s = kind === "Live" ? LIVE : kind === "Virtual" ? VIRTUAL : HYBRID
  return pill(s.bg, s.text, kind, 6, "2px 8px")
}

/** Light, airy column header cell: small bold uppercase MUTED grey text over a
 *  1px hairline rule, no fill. Fixed padding + line-height so it never inflates. */
function th(width: number, label: string, align: "left" | "center" = "left"): string {
  return `<td width="${width}" align="${align}" style="width:${width}px;text-align:${align};padding:0 8px 4px 8px;line-height:1.2;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid ${HAIRLINE};"><span style="color:${MUTED};">${esc(label)}</span></td>`
}

/** Section header. With a count → bold navy title + dark-navy count badge floated
 *  right (feedback "N Outstanding" treatment). With count === null → title only. */
function sectionHeader(title: string, count: number | null = null, unit = ""): string {
  const right = count === null ? "" : `<td valign="middle" align="right" style="vertical-align:middle;text-align:right;white-space:nowrap;">${pill(NAVY, WHITE, `${count} ${unit}`, 9, "1px 9px", "right")}</td>`
  return `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;"><tr>
    <td valign="middle" style="vertical-align:middle;padding-right:8px;font-size:15px;line-height:1.2;font-weight:bold;"><span style="color:${NAVY};">${esc(title)}</span></td>
    ${right}
  </tr></table>`
}

// ---- In-office card (amber attention card) ---------------------------------
function officeBanner(days: WeekAheadDay[]): string {
  const officeDays = days.filter((d) => d.nyOffice)
  const inner = officeDays.length
    ? officeDays
        .map((d) => {
          const clients = d.nyTickers.length ? d.nyTickers.join(", ") : "TBD"
          const detail = `${d.nyCount} meeting${d.nyCount === 1 ? "" : "s"} in office`
          return `<tr>
            <td valign="top" style="vertical-align:top;padding:4px 12px 4px 0;line-height:1.2;white-space:nowrap;font-size:14px;font-weight:bold;"><span style="color:${AMBER.text};">${esc(d.weekdayShort)} ${esc(d.dateLabel)}</span></td>
            <td valign="top" style="vertical-align:top;padding:4px 12px 4px 0;line-height:1.2;font-size:14px;"><span style="color:${AMBER.text};">${esc(clients)}</span></td>
            <td valign="top" align="right" style="vertical-align:top;text-align:right;padding:4px 0;line-height:1.2;white-space:nowrap;font-size:12px;"><span style="color:${AMBER.text};">${esc(detail)}</span></td>
          </tr>`
        })
        .join("")
    : `<tr><td style="padding:3px 0;line-height:1.2;font-size:13px;"><span style="color:${AMBER.text};">No in-office meetings flagged this week.</span></td></tr>`

  // Clean amber block: fill + rounded corners, NO border. The gap below the card
  // is added via padding-top on the Week at a glance container (Outlook drops the
  // margin here), so no bottom margin is needed.
  return `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
    <tr><td bgcolor="${AMBER.bg}" style="background-color:${AMBER.bg};padding:14px 18px;border-radius:8px;">
      <div style="font-size:11px;line-height:1.2;font-weight:bold;text-transform:uppercase;letter-spacing:0.06em;padding-bottom:8px;"><span style="color:${AMBER.text};">📍 In the New York office next week</span></div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;">${inner}</table>
    </td></tr>
  </table>`
}

// ---- Week at a glance (bordered, equal-height day boxes; NO count badge) ----
function weekGrid(days: WeekAheadDay[]): string {
  const n = days.length
  const GAP = 13
  const CELL = Math.floor((CONTAINER - (n - 1) * GAP) / n)
  const spacer = `<td width="${GAP}" style="width:${GAP}px;font-size:0;line-height:0;">&nbsp;</td>`

  const box = (d: WeekAheadDay): string => {
    const border = d.nyOffice ? AMBER.border : BOX_BORDER
    const countText = d.count === 0 ? "No meetings" : `${d.count} mtg${d.count === 1 ? "" : "s"}`
    const tickers = d.tickers.length
      ? `<div style="font-size:12px;line-height:1.4;padding-top:5px;"><span style="color:${INK};">${esc(d.tickers.join(", "))}</span></div>`
      : `<div style="font-size:12px;line-height:1.4;padding-top:5px;"><span style="color:${MUTED};">—</span></div>`
    const nyMark = d.nyOffice
      ? `<div style="padding-top:7px;line-height:1.2;"><span style="color:${AMBER.text};font-size:11px;font-weight:bold;">📍 IN OFFICE</span></div>`
      : ""
    return `<td width="${CELL}" valign="top" bgcolor="${WHITE}" style="width:${CELL}px;vertical-align:top;background-color:${WHITE};border:1px solid ${border};border-radius:6px;padding:10px 12px;">
      <div style="font-size:13px;line-height:1.2;font-weight:bold;"><span style="color:${INK};">${esc(d.weekdayShort)}</span> <span style="color:${MUTED};font-weight:normal;font-size:11px;">${esc(d.dateLabel)}</span></div>
      <div style="font-size:12px;line-height:1.2;font-weight:bold;padding-top:6px;"><span style="color:${d.count === 0 ? MUTED : INK};">${countText}</span></div>
      ${tickers}
      ${nyMark}
    </td>`
  }

  const cells = days.map(box).join(spacer)
  // Real, Outlook-safe gap above this section: padding-top on the container <td>
  // (Outlook's Word engine drops margins and collapses empty spacer rows).
  return `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
    <tr><td style="padding-top:24px;">
      ${sectionHeader("Next Week at a Glance")}
      <table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:separate;border-spacing:0;font-family:Arial,Helvetica,sans-serif;">
        <tr>${cells}</tr>
      </table>
    </td></tr>
  </table>`
}

// ---- All Upcoming Meetings (one line per meeting, grouped by day) -----------
function meetingRow(m: WeekAheadMeeting, dateLabel: string, last: boolean): string {
  const sep = last ? "" : `border-bottom:1px solid ${ROW_LINE};`
  // Pinned tight rows: 3px vertical / 8px horizontal, fixed line-height.
  const cell = (extra: string) =>
    `padding:3px 8px;line-height:1.2;vertical-align:top;font-size:13px;white-space:nowrap;${sep}${extra}`
  const client = m.ticker ? esc(m.ticker) : m.clientName ? esc(trunc(m.clientName, 10)) : "—"
  const institution = m.institution ? esc(trunc(m.institution, T.institution)) : "—"
  const investor = m.investor ? esc(trunc(m.investor, T.investor)) : "—"
  const host = m.host ? esc(trunc(m.host, T.host)) : "—"
  const kind: "Live" | "Virtual" = m.isLive ? "Live" : "Virtual"
  // Pill + in-person flag on ONE line via a 2-cell nested table: typePill() is a
  // block-level <table>, so a trailing inline flag after it would wrap to a second
  // row. The nested cells (valign:middle) keep them side by side.
  const typeCell = m.isNyOffice
    ? `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr><td valign="middle" style="vertical-align:middle;">${typePill(kind)}</td><td valign="middle" style="vertical-align:middle;padding-left:4px;font-size:13px;line-height:1.2;font-weight:bold;color:${AMBER.text};">📍</td></tr></table>`
    : typePill(kind)
  return `<tr>
    <td style="${cell("font-weight:bold;color:" + NAVY + ";")}">${esc(dateLabel)}</td>
    <td style="${cell("color:" + INK + ";")}">${esc(m.timeLabel || "—")}</td>
    <td style="${cell("font-weight:bold;color:" + INK + ";")}" title="${esc(m.clientName)}">${client}</td>
    <td style="${cell("color:" + SUBTLE + ";overflow:hidden;")}" title="${esc(m.institution)}">${institution}</td>
    <td style="${cell("color:" + MUTED + ";overflow:hidden;")}" title="${esc(m.investor)}">${investor}</td>
    <td style="${cell("white-space:nowrap;")}">${typeCell}</td>
    <td style="${cell("color:" + SUBTLE + ";overflow:hidden;")}" title="${esc(m.host)}">${host}</td>
  </tr>`
}

function allMeetings(days: WeekAheadDay[], total: number): string {
  const populated = days.filter((d) => d.count > 0)
  if (populated.length === 0) {
    return `${sectionHeader("All Upcoming Meetings", 0, "meetings")}
      <div style="padding:16px 8px;line-height:1.2;font-size:13px;color:${SUBTLE};">No confirmed meetings scheduled for this week.</div>`
  }

  const headRow = `<tr>
    ${th(MCOLS.date, "Date")}
    ${th(MCOLS.time, "Time")}
    ${th(MCOLS.client, "Client")}
    ${th(MCOLS.institution, "Institution")}
    ${th(MCOLS.investor, "Investor")}
    ${th(MCOLS.type, "Type")}
    ${th(MCOLS.host, "Host")}
  </tr>`

  const groups = populated
    .map((d, gi) => {
      // Day sub-header = the first row of a new day. gi>0 gets a 1px separator
      // (same thickness as the within-day row hairlines, just darker) + extra top
      // padding (9px) for breathing room; gi 0 is snug.
      const topRule = gi > 0 ? `border-top:1px solid ${DAY_SEP};` : ""
      const pad = gi > 0 ? "9px 8px 3px 8px" : "3px 8px"
      // Pill in its OWN valign:middle cell (no leading &nbsp; text baseline, which
      // floats the nested pill table above the line). All three cells center.
      const nyCell = d.nyOffice
        ? `<td valign="middle" style="vertical-align:middle;line-height:1.2;padding-left:10px;">${pill(AMBER.bg, AMBER.text, "📍 In office", 9, "1px 7px")}</td>`
        : ""
      const band = `<tr><td colspan="7" style="padding:${pad};line-height:1.2;${topRule}">
        <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr>
          <td valign="middle" style="vertical-align:middle;line-height:1.2;font-size:13px;font-weight:bold;"><span style="color:${INK};">${esc(d.weekdayShort)}, ${esc(d.dateLabel)}</span></td>
          <td valign="middle" style="vertical-align:middle;line-height:1.2;padding-left:10px;font-size:11px;"><span style="color:${MUTED};">${d.count} meeting${d.count === 1 ? "" : "s"}</span></td>
          ${nyCell}
        </tr></table>
      </td></tr>`
      const rows = d.meetings.map((m, i) => meetingRow(m, d.dateLabel, i === d.meetings.length - 1)).join("")
      return band + rows
    })
    .join("")

  // Real, Outlook-safe gap above this section: padding-top on the container <td>
  // (Outlook's Word engine drops margins and collapses empty spacer rows).
  return `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
    <tr><td style="padding-top:40px;">
      ${sectionHeader("All Upcoming Meetings", total, total === 1 ? "meeting" : "meetings")}
      <table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;table-layout:fixed;font-family:Arial,Helvetica,sans-serif;">
        <thead>${headRow}</thead>
        <tbody>${groups}</tbody>
      </table>
    </td></tr>
  </table>`
}

/** The rich-HTML fragment for email/clipboard use.
 *  `sentLabel` e.g. "Friday, July 31, 2026" (the send day, US Eastern). */
export function buildWeekAheadEmailHtml(data: WeekAheadData): string {
  // Title date range = the Mon–Fri work week (matching the day grid), so the
  // Friday end date, not the calendar-week Sunday.
  const mondayLabel = data.days[0]?.dateLabel ?? ""
  const fridayLabel = data.days[data.days.length - 1]?.dateLabel ?? ""

  const header = `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin:0 0 22px 0;">
    <tr><td style="padding:0 0 14px 0;">
      <div style="font-size:11px;line-height:1.2;font-weight:bold;text-transform:uppercase;letter-spacing:0.10em;"><span style="color:${NAVY};">Week Ahead &middot; Corporate Access</span></div>
      <div style="font-size:22px;line-height:1.2;font-weight:bold;padding-top:3px;"><span style="color:${INK};">Upcoming Meetings &mdash; ${esc(mondayLabel)}&ndash;${esc(fridayLabel)}</span></div>
      <div style="font-size:13px;line-height:1.2;padding:5px 0 0 0;"><span style="color:${SUBTLE};">${data.totalMeetings} meeting${data.totalMeetings === 1 ? "" : "s"} &middot; ${data.totalClients} client${data.totalClients === 1 ? "" : "s"}</span></div>
    </td></tr>
  </table>`

  return `<div style="font-family:Arial,Helvetica,sans-serif;background-color:${WHITE};color:${INK};">
${header}
${officeBanner(data.days)}
${weekGrid(data.days)}
${allMeetings(data.days, data.totalMeetings)}
</div>`
}

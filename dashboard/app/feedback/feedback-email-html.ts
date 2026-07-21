// Builds the Outlook-safe email HTML for the Outstanding Feedback digest from the
// current v_feedback_outstanding rows. Same table-based, inline-styled approach
// as the Live Outreach email (app/live-outreach/email-html.ts): fixed-width
// tables, inline styles only, and the <td bgcolor> "pill" technique for any
// colored fill (Outlook's Word engine drops background-color from inline spans).
// Pure — no DOM / React — so it runs identically on the server or in the browser.
//
// Returns a self-contained FRAGMENT (a wrapper <div> that sets the base font),
// NOT a full <html> document, so it can be dropped straight into a Graph sendMail
// body or an offscreen element for clipboard copy.
//
// Mirrors the Feedback Collection page (app/feedback/feedback-view.tsx): same
// palette, same status/aging semantics, same summary KPIs — but grouped BY PERSON
// (host), persons A→Z, meetings oldest→newest within each person, and with every
// icon/emoji replaced by an Outlook-safe text pill.

import type { FeedbackOutstandingRow, FeedbackPipelineRow } from "@/lib/types"

// Fixed container + column geometry (px). Table-layout is fixed via explicit
// <td width> so columns line up down the whole email regardless of cell content.
const CONTAINER = 1040
const COLS = {
  date: 60,
  ticker: 64,
  institution: 380,
  investor: 320,
  status: 104,
  days: 112,
} as const

// Column geometry for the two Feedback Report Pipeline tables (top of the
// digest). Both report tables use these identical widths so they line up.
// Sum = CONTAINER (1040).
const PCOLS = {
  ticker: 64,
  event: 220,
  mtgDates: 128,
  age: 96,
  due: 96,
  taskDate: 108,
  am: 160,
  claimed: 168,
} as const

// Palette — mirrors feedback-view.tsx. Status buckets use LIGHT-fill / DARK-text
// pills (not white-on-color) so the label stays readable even where Outlook drops
// the <td bgcolor> fill entirely.
const NAVY = "#1E2858"
const INK = "#1A2233"
const MUTED = "#9AA1AD"
const SUBTLE = "#6B7280"
const CORAL = { text: "#993C1D", pillBg: "#FAECE7" } // no feedback
const AMBER = { text: "#854F0B", pillBg: "#FAEEDA" } // awaiting additional
const RED = { text: "#A32D2D", pillBg: "#FCEBEB" } // 30+ days stale / overdue
const GREEN = { text: "#0E7C56", pillBg: "#E7F5EE" } // fresh (< 4 days in stage)

// The one incomplete-but-started feedback state the view surfaces; every other
// row out of v_feedback_outstanding is the blank / no-feedback bucket.
const AWAITING = "Awaiting Additional"

const STALE_DAYS = 30 // red + "Stale" marker at/above this
const AGING_DAYS = 10 // coral at/above this (below is muted)

function esc(s: unknown): string {
  if (s == null) return ""
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// Truncate to n characters, using an ellipsis for the last slot. Returns s
// unchanged when it already fits. Applied to Institution / Investor so each cell
// stays on one line (the full text lives in the cell's title=).
function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}

// Show only the base ticker, dropping an exchange/country qualifier such as
// "NVCR US", "NVCR:US", "NVCR US Equity", or "NVCR-US". Share-class dots
// (e.g. "BRK.B") are intentionally preserved.
function baseTicker(t: string): string {
  return t.trim().split(/[\s:]/)[0].replace(/-[A-Za-z]{1,4}$/, "")
}

// Eastern-local meeting date as "Mon D, YYYY", matching the page. days_since is
// computed in America/New_York in the view, so format the date in the same zone
// (independent of the server/browser locale) so Date and Days always agree.
const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "numeric",
  day: "numeric",
  year: "2-digit",
})
function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return DATE_FMT.format(d)
}

// Eastern calendar day as an integer day-count (days since epoch), so due-date
// comparisons are done on the Eastern date, independent of server locale — the
// same zone the rest of the feedback logic uses.
const YMD_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})
function easternDayNumber(d: Date): number {
  const [y, m, dd] = YMD_FMT.format(d).split("-").map(Number)
  return Math.floor(Date.UTC(y, m - 1, dd) / 86400000)
}
// Whole Eastern-day gap from today to `iso` (negative = in the past). null when
// the date is missing/unparseable.
function daysUntilEastern(iso: string | null, todayNum: number): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return easternDayNumber(d) - todayNum
}

// Compact meeting-date range, e.g. "7/21/26–7/23/26" (single date when start ===
// end, or when only one end is present). "—" when neither is set.
function fmtDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "—"
  const s = fmtDate(start)
  const e = fmtDate(end)
  if (start && end) return s === e ? s : `${s}–${e}`
  return start ? s : e
}

function isAwaiting(r: FeedbackOutstandingRow): boolean {
  return r.feedback_status_label === AWAITING
}

// Colored fill via <td bgcolor> inside a tiny nested table — the only
// Outlook-reliable way to keep a background color. NB Outlook squares off
// border-radius (colored rectangle there; rounded elsewhere), but the color and
// text survive. Returns a single-cell table (block-level); place inside a <td>.
function pill(bg: string, fg: string, label: string, radius = 9, padding = "1px 7px"): string {
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr><td bgcolor="${bg}" style="background-color:${bg};font-size:11px;font-weight:bold;padding:${padding};border-radius:${radius}px;white-space:nowrap;color:${fg};"><span style="color:${fg};">${label}</span></td></tr></table>`
}

// One KPI cell for the summary row. Value color is set on a <span> (not the td)
// so it survives a browser-copy → Outlook paste.
function kpiCell(label: string, value: string, valueColor: string): string {
  return `<td width="20%" valign="top" style="width:20%;vertical-align:top;padding:2px 12px 2px 0;">
    <div style="font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;"><span style="color:${MUTED};">${esc(label)}</span></div>
    <div style="font-size:22px;font-weight:bold;line-height:1.2;padding-top:2px;"><span style="color:${valueColor};">${esc(value)}</span></div>
  </td>`
}

function statusCell(r: FeedbackOutstandingRow): string {
  return isAwaiting(r)
    ? pill(AMBER.pillBg, AMBER.text, "Awaiting", 9, "1px 8px")
    : pill(CORAL.pillBg, CORAL.text, "No feedback", 9, "1px 8px")
}

// Days-since cell: muted under 10, coral 10–29, bold red with a "Stale" text
// marker at 30+ (the Outlook-safe stand-in for the page's flame icon).
function daysCell(days: number): string {
  if (days >= STALE_DAYS) {
    return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin-left:auto;"><tr>
      <td valign="middle" style="vertical-align:middle;padding-right:5px;">${pill(RED.pillBg, RED.text, "Stale", 9, "1px 6px")}</td>
      <td valign="middle" style="vertical-align:middle;font-size:13px;font-weight:bold;"><span style="color:${RED.text};">${days}</span></td>
    </tr></table>`
  }
  // 10–29: coral. <10: muted. Both normal weight (only 30+ goes bold, above).
  const color = days >= AGING_DAYS ? CORAL.text : MUTED
  return `<span style="font-size:13px;color:${color};">${days}</span>`
}

type PersonGroup = {
  name: string
  items: FeedbackOutstandingRow[]
  stale: number
}

// Group rows by host (person), persons A→Z, meetings oldest→newest within each
// person. Sorting here makes the template correct on its own, independent of any
// DB-side ORDER BY (Stage 2 adds that as the primary guarantee).
function buildGroups(rows: FeedbackOutstandingRow[]): PersonGroup[] {
  const map = new Map<string, PersonGroup>()
  for (const r of rows) {
    const name = r.host_name || "Unknown host"
    let g = map.get(name)
    if (!g) {
      g = { name, items: [], stale: 0 }
      map.set(name, g)
    }
    g.items.push(r)
    if (r.days_since >= STALE_DAYS) g.stale++
  }
  const groups = Array.from(map.values())
  for (const g of groups) {
    g.items.sort((a, b) => {
      const ta = new Date(a.meeting_date).getTime()
      const tb = new Date(b.meeting_date).getTime()
      if (ta !== tb) return ta - tb // oldest meeting first
      return a.meeting_id.localeCompare(b.meeting_id)
    })
  }
  groups.sort((a, b) => a.name.localeCompare(b.name)) // person A→Z
  return groups
}

function meetingRow(r: FeedbackOutstandingRow, last: boolean): string {
  const sep = last ? "" : "border-bottom:1px solid #EFF1F5;"
  const cell = (extra: string) =>
    `padding:3px 10px 3px 0;vertical-align:top;font-size:13px;line-height:1.25;color:${INK};${sep}${extra}`
  // Ticker: the client's stock symbol (uppercased); fall back to a short slice
  // of the client name, then "—". The full client name always lives in title=.
  const ticker = r.client_ticker
    ? esc(baseTicker(r.client_ticker).toUpperCase())
    : r.client_account_name
      ? esc(trunc(r.client_account_name, 9))
      : "—"
  const institution = r.institution_name ? esc(trunc(r.institution_name, 50)) : "—"
  const investor = r.investor_text ? esc(trunc(r.investor_text, 42)) : "—"
  return `<tr>
    <td width="${COLS.date}" valign="top" style="${cell("white-space:nowrap;font-weight:bold;color:" + NAVY + ";")}">${esc(fmtDate(r.meeting_date))}</td>
    <td width="${COLS.ticker}" valign="top" style="${cell("white-space:nowrap;font-weight:bold;")}" title="${esc(r.client_account_name)}">${ticker}</td>
    <td width="${COLS.institution}" valign="top" style="${cell("white-space:nowrap;")}" title="${esc(r.institution_name)}">${institution}</td>
    <td width="${COLS.investor}" valign="top" style="${cell("white-space:nowrap;color:" + SUBTLE + ";")}" title="${esc(r.investor_text)}">${investor}</td>
    <td width="${COLS.status}" valign="top" style="${cell("")}">${statusCell(r)}</td>
    <td width="${COLS.days}" valign="top" align="right" style="${cell("text-align:right;")}">${daysCell(r.days_since)}</td>
  </tr>`
}

function personBlock(g: PersonGroup): string {
  const count = g.items.length
  // Header: person name on the left, total-outstanding badge pinned to the right.
  const countBadge = pill(INK, "#FFFFFF", `${count} Outstanding`, 9, "1px 8px")
  const header = `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin:0 0 6px 0;"><tr>
    <td valign="middle" style="vertical-align:middle;padding-right:8px;font-size:15px;font-weight:bold;"><span style="color:${NAVY};">${esc(g.name)}</span></td>
    <td valign="middle" align="right" style="vertical-align:middle;text-align:right;white-space:nowrap;">${countBadge}</td>
  </tr></table>`

  const headRow = `<tr>
    <td width="${COLS.date}" style="padding:0 10px 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">Date</td>
    <td width="${COLS.ticker}" style="padding:0 10px 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">Ticker</td>
    <td width="${COLS.institution}" style="padding:0 10px 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">Institution</td>
    <td width="${COLS.investor}" style="padding:0 10px 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">Investor</td>
    <td width="${COLS.status}" style="padding:0 10px 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">Status</td>
    <td width="${COLS.days}" align="right" style="padding:0 0 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};text-align:right;">Days</td>
  </tr>`

  const body = g.items.map((r, i) => meetingRow(r, i === g.items.length - 1)).join("")

  return `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;margin:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;">
    <tr><td colspan="6" bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:12px 14px 10px 14px;border-top:1px solid #E5E8EC;">
      ${header}
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;">
        <thead>${headRow}</thead>
        <tbody>${body}</tbody>
      </table>
    </td></tr>
  </table>`
}

type Summary = {
  total: number
  blank: number
  awaiting: number
  stale30: number
  oldest: number
  people: number
  clients: number
  institutions: number
}

function summarize(rows: FeedbackOutstandingRow[]): Summary {
  let blank = 0
  let awaiting = 0
  let stale30 = 0
  let oldest = 0
  const people = new Set<string>()
  const clients = new Set<string>()
  const institutions = new Set<string>()
  for (const r of rows) {
    if (isAwaiting(r)) awaiting++
    else blank++
    if (r.days_since >= STALE_DAYS) stale30++
    if (r.days_since > oldest) oldest = r.days_since
    people.add(r.host_id)
    if (r.client_account_id) clients.add(r.client_account_id)
    if (r.institution_name) institutions.add(r.institution_name)
  }
  return {
    total: rows.length,
    blank,
    awaiting,
    stale30,
    oldest,
    people: people.size,
    clients: clients.size,
    institutions: institutions.size,
  }
}

// ---- Feedback Report Pipeline sections (top of the digest) ------------------
// Two Outlook-safe tables built from v_feedback_pipeline rows, in the same
// style as the outstanding per-person blocks. Reuse pill/esc/trunc/baseTicker.

// Ticker for a pipeline row: base symbol uppercased, else a short client-name
// fallback, else "—". Full client name lives in the cell title=.
function pipelineTicker(r: FeedbackPipelineRow): string {
  return r.client_ticker
    ? esc(baseTicker(r.client_ticker).toUpperCase())
    : r.client_account_name
      ? esc(trunc(r.client_account_name, 9))
      : "—"
}

// Age/Waiting pill from days_in_stage: green < 4, amber 4–6, red 7+.
function ageCell(days: number | null): string {
  if (days == null) return `<span style="font-size:13px;color:${MUTED};">—</span>`
  const c = days >= 7 ? RED : days >= 4 ? AMBER : GREEN
  return pill(c.pillBg, c.text, `${days}d`, 9, "1px 7px")
}

// Due cell (matches the on-page DueCell): the due DATE lives inside the pill;
// the color carries the meaning — red when overdue (before today), amber when
// due within the next 3 days, otherwise plain muted text. "—" when no due date.
function dueCell(iso: string | null, todayNum: number): string {
  const du = daysUntilEastern(iso, todayNum)
  if (du == null) return `<span style="font-size:13px;color:${MUTED};">—</span>`
  if (du < 0) return pill(RED.pillBg, RED.text, fmtDate(iso), 9, "1px 7px")
  if (du <= 3) return pill(AMBER.pillBg, AMBER.text, fmtDate(iso), 9, "1px 7px")
  return `<span style="font-size:13px;color:${MUTED};">${esc(fmtDate(iso))}</span>`
}

// Claimed-by cell: the name, or an amber "Unclaimed" pill when empty.
function claimedCell(name: string | null): string {
  return name
    ? `<span style="font-size:13px;color:${INK};">${esc(trunc(name, 20))}</span>`
    : pill(AMBER.pillBg, AMBER.text, "Unclaimed", 9, "1px 7px")
}

function reportHeadRow(taskDateHeader: string): string {
  const th = (w: number, label: string) =>
    `<td width="${w}" style="padding:0 10px 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">${label}</td>`
  return `<tr>
    ${th(PCOLS.ticker, "Ticker")}
    ${th(PCOLS.event, "Event")}
    ${th(PCOLS.mtgDates, "Mtg Dates")}
    ${th(PCOLS.age, "Waiting")}
    ${th(PCOLS.due, "Due")}
    ${th(PCOLS.taskDate, esc(taskDateHeader))}
    ${th(PCOLS.am, "Client Mgr")}
    ${th(PCOLS.claimed, "Claimed By")}
  </tr>`
}

function reportRow(
  r: FeedbackPipelineRow,
  dateKey: "received_date" | "fb_closed_date",
  todayNum: number,
  last: boolean,
): string {
  const sep = last ? "" : "border-bottom:1px solid #EFF1F5;"
  const cell = (extra: string) =>
    `padding:3px 10px 3px 0;vertical-align:top;font-size:13px;line-height:1.25;color:${INK};${sep}${extra}`
  const event = r.event_name ? esc(trunc(r.event_name, 24)) : "—"
  const am = r.account_manager_name ? esc(trunc(r.account_manager_name, 20)) : "—"
  return `<tr>
    <td width="${PCOLS.ticker}" valign="top" style="${cell("white-space:nowrap;font-weight:bold;")}" title="${esc(r.client_account_name)}">${pipelineTicker(r)}</td>
    <td width="${PCOLS.event}" valign="top" style="${cell("white-space:nowrap;")}" title="${esc(r.event_name)}">${event}</td>
    <td width="${PCOLS.mtgDates}" valign="top" style="${cell("white-space:nowrap;font-size:12px;color:" + SUBTLE + ";")}">${esc(fmtDateRange(r.meeting_start, r.meeting_end))}</td>
    <td width="${PCOLS.age}" valign="top" style="${cell("")}">${ageCell(r.days_in_stage)}</td>
    <td width="${PCOLS.due}" valign="top" style="${cell("")}">${dueCell(r.due_date, todayNum)}</td>
    <td width="${PCOLS.taskDate}" valign="top" style="${cell("white-space:nowrap;")}">${esc(fmtDate(r[dateKey]))}</td>
    <td width="${PCOLS.am}" valign="top" style="${cell("white-space:nowrap;")}" title="${esc(r.account_manager_name)}">${am}</td>
    <td width="${PCOLS.claimed}" valign="top" style="${cell("white-space:nowrap;")}" title="${esc(r.claimed_by_name)}">${claimedCell(r.claimed_by_name)}</td>
  </tr>`
}

function reportSection(
  title: string,
  caption: string,
  rows: FeedbackPipelineRow[],
  taskDateHeader: string,
  dateKey: "received_date" | "fb_closed_date",
  todayNum: number,
): string {
  const countBadge = pill(INK, "#FFFFFF", `${rows.length} Outstanding`, 9, "1px 8px")
  const header = `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin:0 0 2px 0;"><tr>
    <td valign="middle" style="vertical-align:middle;padding-right:8px;font-size:15px;font-weight:bold;"><span style="color:${NAVY};">${esc(title)}</span></td>
    <td valign="middle" align="right" style="vertical-align:middle;text-align:right;white-space:nowrap;">${countBadge}</td>
  </tr></table>
  <div style="font-size:11px;padding:0 0 8px 0;"><span style="color:${SUBTLE};">${esc(caption)}</span></div>`
  const body = rows.length
    ? rows.map((r, i) => reportRow(r, dateKey, todayNum, i === rows.length - 1)).join("")
    : `<tr><td colspan="8" style="padding:10px 0;font-size:13px;color:${SUBTLE};">None right now.</td></tr>`
  return `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;margin:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;">
    <tr><td colspan="8" bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:12px 14px 10px 14px;border-top:1px solid #E5E8EC;">
      ${header}
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;">
        <thead>${reportHeadRow(taskDateHeader)}</thead>
        <tbody>${body}</tbody>
      </table>
    </td></tr>
  </table>`
}

// Compact key for the Due column only — a bare red/amber date isn't
// self-explanatory. Two swatch pills; the aging/"Waiting" colors stay unlabeled.
function dueKey(): string {
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin:6px 0 2px 0;"><tr>
    <td valign="middle" style="vertical-align:middle;padding-right:6px;">${pill(RED.pillBg, RED.text, "Overdue", 9, "1px 7px")}</td>
    <td valign="middle" style="vertical-align:middle;padding-right:10px;">${pill(AMBER.pillBg, AMBER.text, "Due soon", 9, "1px 7px")}</td>
    <td valign="middle" style="vertical-align:middle;font-size:11px;"><span style="color:${SUBTLE};">= due-date color on the Due column</span></td>
  </tr></table>`
}

// The full pipeline block: heading + the two report sections + a divider.
// Rendered ABOVE the unchanged Outstanding Feedback content.
function buildPipelineBlock(pipelineRows: FeedbackPipelineRow[], todayLabel: string): string {
  const todayNum = easternDayNumber(new Date())
  // Both sections: longest-waiting first (days_in_stage desc, nulls last).
  const byWaitingDesc = (a: FeedbackPipelineRow, b: FeedbackPipelineRow) =>
    (b.days_in_stage ?? -Infinity) - (a.days_in_stage ?? -Infinity)
  const pending = pipelineRows.filter((r) => r.category === "pending_review").sort(byWaitingDesc)
  const inProgress = pipelineRows.filter((r) => r.category === "in_progress").sort(byWaitingDesc)

  const heading = `<div style="font-size:22px;font-weight:bold;"><span style="color:${INK};">Feedback Report Pipeline &mdash; ${esc(todayLabel)}</span></div>
    <div style="font-size:13px;padding:4px 0 2px 0;"><span style="color:${SUBTLE};">Reports awaiting review and in progress.</span></div>
    ${dueKey()}`

  const sections =
    reportSection(
      "Feedback Reports Pending Review",
      "Waiting = days since the matched Feedback task closed. Sorted by longest waiting first.",
      pending,
      "Fb Closed",
      "fb_closed_date",
      todayNum,
    ) +
    "\n" +
    reportSection(
      "Feedback Reports In Progress",
      "Waiting = days since the feedback has been fully received. Sorted by longest waiting first.",
      inProgress,
      "FB Received",
      "received_date",
      todayNum,
    )

  return `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
  <tr><td style="padding:0 0 8px 0;">
    ${heading}
  </td></tr>
  <tr><td bgcolor="#F4F6F9" style="background-color:#F4F6F9;padding:0 0 2px 0;border-top:1px solid #888888;">
${sections}
  </td></tr>
</table>
<div style="height:2px;background-color:#1E2858;line-height:2px;font-size:0;margin:10px 0 16px 0;">&nbsp;</div>`
}

/** The rich-HTML fragment for email/clipboard use. `todayLabel` e.g. "July 21, 2026". */
export function buildFeedbackEmailHtml(
  rows: FeedbackOutstandingRow[],
  pipelineRows: FeedbackPipelineRow[],
  todayLabel: string,
): string {
  const s = summarize(rows)
  const groups = buildGroups(rows)

  const kpiRow = `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin:10px 0 6px 0;"><tr>
    ${kpiCell("Need feedback", String(s.total), INK)}
    ${kpiCell("No feedback", String(s.blank), CORAL.text)}
    ${kpiCell("Awaiting add'l", String(s.awaiting), AMBER.text)}
    ${kpiCell("30+ days", String(s.stale30), RED.text)}
    ${kpiCell("Oldest", `${s.oldest}d`, INK)}
  </tr></table>`

  const distinctLine = `<div style="font-size:12px;padding:2px 0 4px 0;"><span style="color:${SUBTLE};">Across ${s.people} ${s.people === 1 ? "person" : "people"} &middot; ${s.clients} ${s.clients === 1 ? "client" : "clients"} &middot; ${s.institutions} ${s.institutions === 1 ? "institution" : "institutions"}</span></div>`

  const legend = `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin:8px 0 14px 0;"><tr>
    <td valign="middle" style="vertical-align:middle;padding-right:6px;">${pill(RED.pillBg, RED.text, "Stale", 9, "1px 6px")}</td>
    <td valign="middle" style="vertical-align:middle;font-size:11px;"><span style="color:${SUBTLE};">= 30+ days since meeting</span></td>
  </tr></table>`

  const bodyBlocks = groups.length
    ? groups.map(personBlock).join("\n")
    : `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;"><tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:24px 14px;text-align:center;font-size:13px;color:${SUBTLE};border-top:1px solid #E5E8EC;">No outstanding feedback. Every concluded confirmed meeting has complete feedback.</td></tr></table>`

  return `<div style="font-family:Arial,Helvetica,sans-serif;background-color:#FFFFFF;color:${INK};">
${buildPipelineBlock(pipelineRows, todayLabel)}
<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
  <tr><td style="padding:0 0 4px 0;">
    <div style="font-size:22px;font-weight:bold;"><span style="color:${INK};">Outstanding Feedback &mdash; ${esc(todayLabel)}</span></div>
    <div style="font-size:13px;padding:4px 0 2px 0;"><span style="color:${SUBTLE};">Concluded meetings still missing complete feedback.</span></div>
    ${kpiRow}
    ${distinctLine}
    ${legend}
  </td></tr>
  <tr><td bgcolor="#F4F6F9" style="background-color:#F4F6F9;padding:0 0 2px 0;border-top:1px solid #888888;">
${bodyBlocks}
  </td></tr>
</table>
</div>`
}

/** A minimal text/plain version, used only as the clipboard's plain-text flavor. */
export function buildFeedbackEmailPlain(rows: FeedbackOutstandingRow[], todayLabel: string): string {
  const s = summarize(rows)
  const groups = buildGroups(rows)
  const lines: string[] = [
    `Outstanding Feedback - ${todayLabel}`,
    `Concluded meetings still missing complete feedback.`,
    "",
    `Need feedback ${s.total} | No feedback ${s.blank} | Awaiting add'l ${s.awaiting} | 30+ days ${s.stale30} | Oldest ${s.oldest}d`,
    `Across ${s.people} people · ${s.clients} clients · ${s.institutions} institutions`,
    "",
  ]
  for (const g of groups) {
    lines.push(`${g.name}  (${g.items.length} Outstanding)`)
    for (const r of g.items) {
      const ticker = r.client_ticker
        ? baseTicker(r.client_ticker).toUpperCase()
        : (r.client_account_name ?? "No client")
      const status = isAwaiting(r) ? "Awaiting" : "No feedback"
      const stale = r.days_since >= STALE_DAYS ? " · STALE" : ""
      lines.push(
        `  ${fmtDate(r.meeting_date)} · ${ticker} · ${r.institution_name ?? "—"} · ${r.investor_text ?? "—"} · ${status} · ${r.days_since}d${stale}`,
      )
    }
    lines.push("")
  }
  return lines.join("\n")
}

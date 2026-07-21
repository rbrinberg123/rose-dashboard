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

import type { FeedbackOutstandingRow } from "@/lib/types"

// Fixed container + column geometry (px). Table-layout is fixed via explicit
// <td width> so columns line up down the whole email regardless of cell content.
const CONTAINER = 1040
const COLS = {
  date: 96,
  client: 200,
  institution: 200,
  investor: 170,
  flags: 158,
  status: 104,
  days: 112,
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
const RED = { text: "#A32D2D", pillBg: "#FCEBEB" } // 30+ days stale
const TEAL = { text: "#146874", pillBg: "#E1F0F2" } // in-person
const BLUE = { text: "#2D4A8A", pillBg: "#EEF2FB" } // virtual
const PURPLE = { text: "#6B3FA0", pillBg: "#F3ECFB" } // group meeting

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

// Eastern-local meeting date as "Mon D, YYYY", matching the page. days_since is
// computed in America/New_York in the view, so format the date in the same zone
// (independent of the server/browser locale) so Date and Days always agree.
const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
})
function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return DATE_FMT.format(d)
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

// Flags cell: In-person / Virtual (always one) + Group (only when group_meeting).
// Text pills, not emoji — 📍🎥👥 render as blank boxes in Outlook. Laid out as two
// side-by-side <td> so the pills sit on one line.
function flagsCell(r: FeedbackOutstandingRow): string {
  const modePill = r.is_in_person
    ? pill(TEAL.pillBg, TEAL.text, "In-person", 9, "1px 7px")
    : pill(BLUE.pillBg, BLUE.text, "Virtual", 9, "1px 7px")
  const groupPill = r.group_meeting ? pill(PURPLE.pillBg, PURPLE.text, "Group", 9, "1px 7px") : ""
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr>
    <td valign="middle" style="vertical-align:middle;padding-right:${groupPill ? "5px" : "0"};">${modePill}</td>
    ${groupPill ? `<td valign="middle" style="vertical-align:middle;">${groupPill}</td>` : ""}
  </tr></table>`
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
    `padding:6px 10px 6px 0;vertical-align:top;font-size:13px;color:${INK};${sep}${extra}`
  const client = r.client_account_name ? esc(r.client_account_name) : "No client"
  const institution = r.institution_name ? esc(r.institution_name) : "—"
  const investor = r.investor_text ? esc(r.investor_text) : "—"
  return `<tr>
    <td width="${COLS.date}" valign="top" style="${cell("white-space:nowrap;font-weight:bold;color:" + NAVY + ";")}">${esc(fmtDate(r.meeting_date))}</td>
    <td width="${COLS.client}" valign="top" style="${cell("")}" title="${esc(r.client_account_name)}">${client}</td>
    <td width="${COLS.institution}" valign="top" style="${cell("")}" title="${esc(r.institution_name)}">${institution}</td>
    <td width="${COLS.investor}" valign="top" style="${cell("color:" + SUBTLE + ";")}" title="${esc(r.investor_text)}">${investor}</td>
    <td width="${COLS.flags}" valign="top" style="${cell("")}">${flagsCell(r)}</td>
    <td width="${COLS.status}" valign="top" style="${cell("")}">${statusCell(r)}</td>
    <td width="${COLS.days}" valign="top" align="right" style="${cell("text-align:right;")}">${daysCell(r.days_since)}</td>
  </tr>`
}

function personBlock(g: PersonGroup): string {
  const count = g.items.length
  // Header: name (navy bold) + total-count badge (dark fill, white text) + a
  // "N stale" pill when any of theirs are 30+ days.
  const countBadge = pill(INK, "#FFFFFF", String(count), 9, "1px 8px")
  const stalePill = g.stale > 0 ? pill(RED.pillBg, RED.text, `${g.stale} stale`, 9, "1px 8px") : ""
  const header = `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin:0 0 6px 0;"><tr>
    <td valign="middle" style="vertical-align:middle;padding-right:8px;font-size:15px;font-weight:bold;"><span style="color:${NAVY};">${esc(g.name)}</span></td>
    <td valign="middle" width="1" style="vertical-align:middle;padding-right:${stalePill ? "6px" : "0"};">${countBadge}</td>
    ${stalePill ? `<td valign="middle" width="1" style="vertical-align:middle;">${stalePill}</td>` : ""}
    <td>&nbsp;</td>
  </tr></table>`

  const headRow = `<tr>
    <td width="${COLS.date}" style="padding:0 10px 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">Date</td>
    <td width="${COLS.client}" style="padding:0 10px 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">Client</td>
    <td width="${COLS.institution}" style="padding:0 10px 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">Institution</td>
    <td width="${COLS.investor}" style="padding:0 10px 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">Investor</td>
    <td width="${COLS.flags}" style="padding:0 10px 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">Flags</td>
    <td width="${COLS.status}" style="padding:0 10px 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">Status</td>
    <td width="${COLS.days}" align="right" style="padding:0 0 4px 0;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};text-align:right;">Days</td>
  </tr>`

  const body = g.items.map((r, i) => meetingRow(r, i === g.items.length - 1)).join("")

  return `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;margin:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;">
    <tr><td colspan="7" bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:12px 14px 10px 14px;border-top:1px solid #E5E8EC;">
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

/** The rich-HTML fragment for email/clipboard use. `todayLabel` e.g. "July 21, 2026". */
export function buildFeedbackEmailHtml(rows: FeedbackOutstandingRow[], todayLabel: string): string {
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
    <td valign="middle" style="vertical-align:middle;padding-right:6px;">${pill(CORAL.pillBg, CORAL.text, "No feedback", 9, "1px 7px")}</td>
    <td valign="middle" style="vertical-align:middle;padding-right:14px;">${pill(AMBER.pillBg, AMBER.text, "Awaiting", 9, "1px 7px")}</td>
    <td valign="middle" style="vertical-align:middle;padding-right:6px;">${pill(RED.pillBg, RED.text, "Stale", 9, "1px 6px")}</td>
    <td valign="middle" style="vertical-align:middle;padding-right:14px;font-size:11px;"><span style="color:${SUBTLE};">= 30+ days since meeting</span></td>
    <td valign="middle" style="vertical-align:middle;padding-right:6px;">${pill(TEAL.pillBg, TEAL.text, "In-person", 9, "1px 7px")}</td>
    <td valign="middle" style="vertical-align:middle;padding-right:6px;">${pill(BLUE.pillBg, BLUE.text, "Virtual", 9, "1px 7px")}</td>
    <td valign="middle" style="vertical-align:middle;">${pill(PURPLE.pillBg, PURPLE.text, "Group", 9, "1px 7px")}</td>
  </tr></table>`

  const bodyBlocks = groups.length
    ? groups.map(personBlock).join("\n")
    : `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;"><tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:24px 14px;text-align:center;font-size:13px;color:${SUBTLE};border-top:1px solid #E5E8EC;">No outstanding feedback. Every concluded confirmed meeting has complete feedback.</td></tr></table>`

  return `<div style="font-family:Arial,Helvetica,sans-serif;background-color:#FFFFFF;color:${INK};">
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
    lines.push(`${g.name}  (${g.items.length}${g.stale > 0 ? `, ${g.stale} stale` : ""})`)
    for (const r of g.items) {
      const client = r.client_account_name ?? "No client"
      const status = isAwaiting(r) ? "Awaiting" : "No feedback"
      const mode = r.is_in_person ? "In-person" : "Virtual"
      const grp = r.group_meeting ? " · Group" : ""
      const stale = r.days_since >= STALE_DAYS ? " · STALE" : ""
      lines.push(
        `  ${fmtDate(r.meeting_date)} · ${client} · ${r.institution_name ?? "—"} · ${r.investor_text ?? "—"} · ${mode}${grp} · ${status} · ${r.days_since}d${stale}`,
      )
    }
    lines.push("")
  }
  return lines.join("\n")
}

// Builds the Outlook-safe email HTML for the Live Outreach page from the current
// rows. Same table-based, inline-styled format as the static snapshot we built
// (1080px two-panel cards, plain-text confirmed-meeting counts, no logo). Pure —
// no DOM / React — so it runs identically on the server or in the browser.
//
// Returns a self-contained FRAGMENT (a wrapper <div> that sets the base font),
// NOT a full <html> document, so it can be dropped into an offscreen element and
// copied as rich text, or written to the clipboard as text/html.

import type { LiveOutreachRow, LiveOutreachMeeting } from "@/lib/types"
import { priorityFlagKind, PRIORITY_FLAG_STYLE } from "./priority-flag"

// Layout widths (px). Wider build, matching the approved snapshot.
const LEFT = 380
const RIGHT = 700
const CARD = LEFT + RIGHT // 1080
const CONTAINER = CARD

// Dynamics CRM view of the Live Outreach clients (bcs_event entity list), linked
// from the email header. Stored with &amp; (not raw &) because it drops straight
// into an href attribute in the template below without going through esc().
const CRM_LIVE_OUTREACH_URL =
  "https://clientcrm.crm.dynamics.com/main.aspx?appid=1d8581bf-b4ad-ee11-a569-0022482a4e0c&amp;pagetype=entitylist&amp;etn=bcs_event&amp;viewid=6215cdd6-2fdc-f011-8544-7ced8d175335&amp;viewType=1039"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function esc(s: unknown): string {
  if (s == null) return ""
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
function fmtMcap(b: number | null): string {
  if (b == null || Number.isNaN(b)) return "—"
  if (b >= 1) return `$${b.toFixed(1)}B`
  return `$${Math.round(b * 1000)}M`
}
function fmtYield(v: number | null): string {
  if (v == null || Number.isNaN(v)) return "—"
  return `${Number(v).toFixed(2)}%`
}
function fmtMeetingDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  // UTC parts so the date matches what the page/snapshot shows.
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

// Show only the base ticker, dropping an exchange/country qualifier such as
// "NVCR US", "SGO:FP", or "STVL-LN". Share-class dots (e.g. "BRK.B") are kept.
// Same logic as the Feedback email's baseTicker().
function baseTicker(t: string): string {
  return t.trim().split(/[\s:]/)[0].replace(/-[A-Za-z]{1,4}$/, "")
}

const MODE_STYLE: Record<string, { bg: string; text: string }> = {
  Virtual: { bg: "#EEF2FB", text: "#2D4A8A" },
  Live: { bg: "#E7F5EE", text: "#0E7C56" },
  Hybrid: { bg: "#F3ECFB", text: "#6B3FA0" },
}

// Text colors are set on a <span> (not the wrapping <div>) so they survive the
// browser-copy → Outlook paste; Outlook keeps inline color on span/td text.
function statCell(label: string, value: string, danger?: boolean, title?: string | null): string {
  const valColor = danger ? "#A32D2D" : "#1A2233"
  return `<td width="50%" valign="top" style="padding:3px 0;vertical-align:top;">
    <div style="font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;"><span style="color:#9AA1AD;">${esc(label)}</span></div>
    <div style="font-size:13px;"${title ? ` title="${esc(title)}"` : ""}><span style="color:${valColor};">${esc(value)}</span></div>
  </td>`
}

// Pills render their fill via <td bgcolor> inside a tiny nested table — the only
// Outlook-reliable way to keep a background color (Outlook's Word engine drops
// background-color from inline <span>). NB Outlook squares off border-radius, so
// the badge is a colored rectangle there (color survives, rounded corners don't).
function pill(bg: string, fg: string, label: string, radius: number, padding: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr><td bgcolor="${bg}" style="background-color:${bg};font-size:11px;font-weight:bold;padding:${padding};border-radius:${radius}px;white-space:nowrap;color:${fg};"><span style="color:${fg};">${label}</span></td></tr></table>`
}

// True when the meeting was added to the CRM within the last 24 hours (and not
// in the future). Drives the email's "NEW" recency flag.
const DAY_MS = 24 * 60 * 60 * 1000
function isRecentlyAdded(createdOn: string | null | undefined): boolean {
  if (!createdOn) return false
  const t = Date.parse(createdOn)
  if (Number.isNaN(t)) return false
  const age = Date.now() - t
  return age >= 0 && age <= DAY_MS
}

// Outlook-safe recency flag: a NEW pill for meetings added in the last 24 hours,
// nothing otherwise. Uses the LIGHT-fill / DARK-text pill pattern (not
// white-on-color) so the label stays readable even where Outlook drops the
// <td bgcolor>.
function historyFlagHtml(createdOn: string | null | undefined): string {
  return isRecentlyAdded(createdOn) ? pill("#EEF2FB", "#2D4A8A", "NEW", 10, "1px 6px") : ""
}

// One priority flag per event (High Priority / New Client / none), sharing the
// page's precedence via priorityFlagKind so the email and page never disagree.
// Uses the SAME light-fill / dark-text pill() as the rest of the email.
function priorityPill(row: LiveOutreachRow): string {
  const kind = priorityFlagKind(row)
  if (!kind) return ""
  const s = PRIORITY_FLAG_STYLE[kind]
  return pill(s.bg, s.text, s.label, 10, "3px 9px")
}

function modeTag(mode: LiveOutreachRow["event_mode"]): string {
  if (!mode || !MODE_STYLE[mode]) return ""
  const s = MODE_STYLE[mode]
  return pill(s.bg, s.text, esc(mode), 6, "2px 8px")
}

function openSlots(remaining: number | null, total: number | null) {
  if (remaining == null) return { value: "—", danger: false, title: null as string | null }
  const shown = Math.max(0, remaining)
  return {
    value: total != null ? `${shown} of ${total}` : `${shown}`,
    danger: remaining <= 2,
    title: remaining < 0 ? `Overbooked by ${-remaining}` : null,
  }
}

// Live-meeting location indicator for the email. The 📍 pin is the "live/
// in-person" symbol (a real Unicode glyph — renders in Outlook, unlike icon
// fonts which show as blank boxes), followed by the city when known (just the
// pin when unknown). Outlook drops inline <span> background-color, so this
// degrades gracefully: browsers/Gmail show a light-teal pill; Outlook shows the
// pin + city in dark-teal text. Virtual meetings get nothing.
function liveCityTag(m: LiveOutreachMeeting): string {
  if (!m.is_in_person) return ""
  const text = m.city ? `📍&nbsp;${esc(m.city)}` : "📍"
  return `&nbsp;<span style="display:inline-block;background-color:#E1F0F2;color:#146874;font-size:11px;font-weight:bold;padding:1px 7px;border-radius:9px;white-space:nowrap;">${text}</span>`
}

function meetingsBlock(row: LiveOutreachRow): string {
  const meetings = row.confirmed_meetings ?? []
  const count = row.confirmed_meeting_count ?? 0
  // "Confirmed Meetings" + the count badge, laid out as two table cells so they
  // sit side by side on one line (Outlook-safe). The badge is the SAME pill() as
  // the NEW/count/urgency pills (identical size/padding/radius/centering) — only
  // the fill (dark navy #1A2233) and text (white) differ, to match the website.
  // Dark fill holds because pill() applies it via the <td> bgcolor attribute.
  const header = `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin-bottom:6px;"><tr>
    <td valign="middle" style="vertical-align:middle;padding-right:8px;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;"><span style="color:#5B6472;">Confirmed Meetings</span></td>
    <td valign="middle" style="vertical-align:middle;">${pill("#1A2233", "#FFFFFF", String(count), 9, "1px 7px")}</td>
  </tr></table>`
  if (meetings.length === 0) {
    return header + `<div style="font-size:13px;padding:4px 0;"><span style="color:#9AA1AD;">No confirmed meetings yet.</span></div>`
  }
  const rowsHtml = meetings
    .map((m, i) => {
      const sep = i === meetings.length - 1 ? "" : "border-bottom:1px solid #EFF1F5;"
      const contact = m.contact
        ? ` <span style="color:#9AA1AD;">·</span> <span style="color:#6B7280;">${esc(m.contact)}</span>`
        : ""
      const flag = historyFlagHtml(m.created_on)
      return `<tr>
        <td width="58" valign="top" style="font-size:11px;font-weight:bold;color:#1E2858;padding:4px 8px 4px 0;white-space:nowrap;vertical-align:top;${sep}">${esc(fmtMeetingDate(m.meeting_date))}</td>
        <td width="46" align="center" valign="top" style="width:46px;padding:4px 6px 4px 0;text-align:center;white-space:nowrap;vertical-align:top;${sep}">${flag}</td>
        <td valign="top" style="font-size:13px;color:#1A2233;padding:4px 0;vertical-align:top;${sep}">${esc(m.institution_name ?? "—")}${contact}${liveCityTag(m)}</td>
      </tr>`
    })
    .join("")
  return header + `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;">${rowsHtml}</table>`
}

function card(row: LiveOutreachRow, index: number): string {
  const slots = openSlots(row.slots_remaining, row.of_slots)
  const tickerHtml = row.ticker ? `<span style="color:#1E2858;">${esc(row.ticker)}</span>&nbsp; ` : ""
  const industryHtml = row.industry ? `<div style="font-size:12px;margin-top:2px;"><span style="color:#6B7280;">${esc(row.industry)}</span></div>` : ""
  const flag = priorityPill(row)
  const pillRow = flag ? `<div style="margin-top:7px;">${flag}</div>` : ""
  const datesHtml = row.event_dates
    ? `<span style="font-size:12px;color:#6B7280;">${esc(row.event_dates)}</span>`
    : `<span style="font-size:12px;color:#9AA1AD;">No dates set</span>`
  const mode = modeTag(row.event_mode)

  // Faint full-width hairline ABOVE every card except the first, so consecutive
  // client blocks are clearly separated as you scroll. Drawn as a top border on
  // BOTH panel cells — because they share one border-collapsed row, the borders
  // merge into a single continuous line across the full 1080px (edge to edge).
  // Same border-on-cell technique as the meeting-row / left-panel dividers, so
  // it renders consistently in Outlook.
  const topBorder = index > 0 ? "border-top:1px solid #E5E8EC;" : ""

  // No box border: the two panels read as one clean card, separated only by the
  // subtle right-panel shading (#F7F8FA) — mirroring the live page. Cards are set
  // apart by the 14px gap, which shows the canvas tint behind them (see wrapper).
  return `<table width="${CARD}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin:0 0 14px 0;width:${CARD}px;font-family:Arial,Helvetica,sans-serif;">
    <tr>
      <td width="${LEFT}" valign="top" bgcolor="#FFFFFF" style="width:${LEFT}px;vertical-align:top;background-color:#FFFFFF;padding:16px 18px;${topBorder}">
        <div style="font-size:15px;font-weight:bold;line-height:1.3;">${tickerHtml}<span style="color:#1A2233;">${esc(row.client_account_name ?? row.event_name ?? "—")}</span></div>
        ${industryHtml}
        ${pillRow}
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:12px;border-collapse:collapse;">
          <tr>
            ${statCell("Div Yield", fmtYield(row.div_yield))}
            ${statCell("Mkt Cap", fmtMcap(row.market_cap_b))}
          </tr>
          <tr>
            ${statCell("Client Lead", row.sales_lead_name ?? "—")}
            ${statCell("Open Slots", slots.value, slots.danger, slots.title)}
          </tr>
        </table>
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid #EFF1F5;">
          <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;">
            <tr>
              ${mode ? `<td valign="middle" style="padding-right:8px;vertical-align:middle;">${mode}</td>` : ""}
              <td valign="middle" style="vertical-align:middle;">${datesHtml}</td>
            </tr>
          </table>
        </div>
      </td>
      <td width="${RIGHT}" valign="top" bgcolor="#F7F8FA" style="width:${RIGHT}px;vertical-align:top;background-color:#F7F8FA;padding:16px 18px;${topBorder}">
        ${meetingsBlock(row)}
      </td>
    </tr>
  </table>`
}

// ---- section headings ------------------------------------------------------
// Larger, darker section titles ("Event Summary" / "Event Details") each with a
// dark-grey 1px divider underneath. Built as a table (not a bordered div) so the
// rule survives Outlook: a 1px-high <td bgcolor> is the Outlook-reliable hairline.
function sectionHeading(label: string): string {
  // White background on the table + the title and trailing-spacer cells so no gray
  // band shows behind the heading in Outlook. The 1px divider cell keeps its
  // #6B7280 fill — that cell IS the rule line, so it stays grey.
  return `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#FFFFFF" style="width:${CONTAINER}px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;background-color:#FFFFFF;">
    <tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:16px 0 7px 0;font-size:19px;font-weight:bold;line-height:1.2;"><span style="color:#1A2233;">${esc(label)}</span></td></tr>
    <tr><td bgcolor="#6B7280" height="1" style="background-color:#6B7280;height:1px;line-height:1px;font-size:1px;mso-line-height-rule:exactly;">&nbsp;</td></tr>
    <tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;height:12px;line-height:12px;font-size:12px;">&nbsp;</td></tr>
  </table>`
}

// ---- Event Summary: two columns, filled COLUMN-MAJOR -----------------------
// A compact scan of every event (same sorted/tiered order as the detail cards),
// on a pure-white table with hairline dividers only (no shaded fills). The events
// are split into two halves and read DOWN the left column, then DOWN the right —
// so row i holds left[i] and right[i], with a thin vertical divider between the
// columns. Each event is one condensed line: Ticker · Status flag · Conf · Open ·
// Dates. Outlook-safe: nested tables, inline styles, <td bgcolor> pills, no links.
const SUMMARY_HAIRLINE = "#E7E9EE" // row dividers + vertical column divider
const SUMMARY_HEADER_RULE = "#C7CCD4" // slightly darker rule under the headers

// Per-column sub-column widths (px). All fixed — with white-space:nowrap on every
// cell this guarantees each event stays on exactly one line (the Dates cell also
// ellipsizes). Widths per half sum well under half the 1080px table, so the slack
// distributes harmlessly (extra width never causes a wrap).
const SUM_W = { ticker: 54, status: 92, conf: 40, open: 40, dates: 280 } as const

/** Trim the free-text dates to a single line, ellipsizing what doesn't fit. This
 *  is the hard guard for Outlook (which ignores CSS text-overflow); modern
 *  clients also get the CSS ellipsis on the fixed-width Dates cell. */
function truncateDates(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s
}

/** The five uppercase column headers for one column, with a darker bottom rule. */
function summaryHeaderCells(): string {
  const rule = `border-bottom:2px solid ${SUMMARY_HEADER_RULE};`
  const base = `vertical-align:bottom;padding:0 6px 4px 0;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;${rule}`
  const h = (label: string, w: number, align: "left" | "center", extra = "") =>
    `<td width="${w}" align="${align}" valign="bottom" style="width:${w}px;text-align:${align};${base}${extra}"><span style="color:#9AA1AD;">${label}</span></td>`
  return (
    h("Ticker", SUM_W.ticker, "left") +
    h("Status", SUM_W.status, "left") +
    h("Conf", SUM_W.conf, "center") +
    h("Open", SUM_W.open, "center") +
    h("Dates", SUM_W.dates, "left")
  )
}

/** The five body cells for one event (or blank placeholders when `row` is
 *  undefined — the tail of the shorter, right-hand column). `isLast` drops the
 *  bottom hairline on the final row. Every cell is white-space:nowrap so the event
 *  can never wrap to a second line. */
function summaryBodyCells(row: LiveOutreachRow | undefined, isLast: boolean): string {
  const border = isLast ? "" : `border-bottom:1px solid ${SUMMARY_HAIRLINE};`
  const pad = "padding:4px 6px 4px 0;vertical-align:middle;white-space:nowrap;"
  if (!row) {
    const e = (w: number, align: "left" | "center") =>
      `<td width="${w}" align="${align}" style="width:${w}px;text-align:${align};${pad}${border}">&nbsp;</td>`
    return e(SUM_W.ticker, "left") + e(SUM_W.status, "left") + e(SUM_W.conf, "center") + e(SUM_W.open, "center") + e(SUM_W.dates, "left")
  }
  const rem = row.slots_remaining
  const openNum = rem == null ? "—" : String(Math.max(0, rem))
  // Red/bold when ≤2 (this also covers overbooked, which clamps to 0).
  const openStyle = rem != null && rem <= 2 ? "color:#A32D2D;font-weight:bold;" : "color:#1A2233;"
  const flag = priorityPill(row) || `<span style="color:#C7CCD4;font-size:11px;">—</span>`
  const dates = row.event_dates
    ? `<span style="color:#6B7280;">${esc(truncateDates(row.event_dates, 34))}</span>`
    : `<span style="color:#C7CCD4;">—</span>`
  return (
    `<td width="${SUM_W.ticker}" valign="middle" style="width:${SUM_W.ticker}px;${pad}${border}font-size:13px;font-weight:bold;"><span style="color:#1E2858;">${esc(row.ticker ? baseTicker(row.ticker) : "—")}</span></td>` +
    `<td width="${SUM_W.status}" valign="middle" style="width:${SUM_W.status}px;${pad}${border}">${flag}</td>` +
    `<td width="${SUM_W.conf}" align="center" valign="middle" style="width:${SUM_W.conf}px;text-align:center;${pad}${border}font-size:13px;"><span style="color:#1A2233;">${row.confirmed_meeting_count ?? 0}</span></td>` +
    `<td width="${SUM_W.open}" align="center" valign="middle" style="width:${SUM_W.open}px;text-align:center;${pad}${border}font-size:13px;"><span style="${openStyle}">${openNum}</span></td>` +
    `<td width="${SUM_W.dates}" valign="middle" style="width:${SUM_W.dates}px;max-width:${SUM_W.dates}px;${pad}${border}font-size:13px;overflow:hidden;text-overflow:ellipsis;">${dates}</td>`
  )
}

/** The pure-white, two-column, column-major summary table. */
function summaryGrid(rows: LiveOutreachRow[]): string {
  const half = Math.ceil(rows.length / 2)
  const left = rows.slice(0, half)
  const right = rows.slice(half)
  // 14px spacer · 1px vertical hairline · 14px spacer between the two columns.
  const spacer = `<td width="14" style="width:14px;font-size:0;line-height:0;">&nbsp;</td>`
  const divider = `<td width="1" bgcolor="${SUMMARY_HAIRLINE}" style="width:1px;background-color:${SUMMARY_HAIRLINE};font-size:0;line-height:0;">&nbsp;</td>`
  const mid = `${spacer}${divider}${spacer}`
  const headerRow = `<tr>${summaryHeaderCells()}${mid}${summaryHeaderCells()}</tr>`
  const bodyRows: string[] = []
  for (let i = 0; i < half; i++) {
    const isLast = i === half - 1
    bodyRows.push(`<tr>${summaryBodyCells(left[i], isLast)}${mid}${summaryBodyCells(right[i], isLast)}</tr>`)
  }
  return `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;background-color:#FFFFFF;">${headerRow}${bodyRows.join("")}</table>`
}

/** "Event Summary" heading + the two-column table + a spacer that separates the
 *  summary from the "Event Details" heading below. Empty when there are no events. */
function summarySection(rows: LiveOutreachRow[]): string {
  if (rows.length === 0) return ""
  // ~22px of breathing room so the two sections read as clearly separated. White
  // background so no gray tint shows through in the gap after the summary table.
  const spacer = `<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#FFFFFF" style="width:${CONTAINER}px;border-collapse:collapse;background-color:#FFFFFF;"><tr><td height="22" bgcolor="#FFFFFF" style="height:22px;line-height:22px;font-size:1px;background-color:#FFFFFF;">&nbsp;</td></tr></table>`
  return sectionHeading("Event Summary") + summaryGrid(rows) + spacer
}

/** The rich-HTML fragment for clipboard/email use. `todayLabel` e.g. "June 30, 2026". */
export function buildEmailHtml(rows: LiveOutreachRow[], todayLabel: string): string {
  const totalMeetings = rows.reduce((s, r) => s + (r.confirmed_meeting_count ?? 0), 0)
  const summary = summarySection(rows)
  const detailsHeading = rows.length > 0 ? sectionHeading("Event Details") : ""
  const cards = rows.map(card).join("\n")
  return `<div style="font-family:Arial,Helvetica,sans-serif;background-color:#FFFFFF;color:#1A2233;">
<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
  <tr><td style="padding:0 0 4px 0;">
    <div style="font-size:22px;font-weight:bold;"><span style="color:#1A2233;">Non-Deal Roadshow Update - ${esc(todayLabel)}</span></div>
    <div style="font-size:15px;padding:6px 0 2px 0;"><span style="color:#1A2233;">Please see CRM for <a href="${CRM_LIVE_OUTREACH_URL}" target="_blank" rel="noopener" style="color:#2D4A8A;text-decoration:underline;"><span style="color:#2D4A8A;">Live Outreach</span></a></span></div>
    <div style="font-size:12px;padding:4px 0 8px 0;"><span style="color:#6B7280;">${rows.length} event${rows.length === 1 ? "" : "s"} in active outreach &middot; ${totalMeetings} confirmed meeting${totalMeetings === 1 ? "" : "s"}</span></div>
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr>
      <td valign="middle" style="padding:0 6px 0 0;vertical-align:middle;">${pill("#EEF2FB", "#2D4A8A", "NEW", 10, "1px 6px")}</td>
      <td valign="middle" style="font-size:11px;vertical-align:middle;"><span style="color:#6B7280;">Meeting added to the CRM in the last 24 hours</span></td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="#F4F6F9" style="background-color:#F4F6F9;padding:0 0 2px 0;border-top:1px solid #888888;">
${summary}
${detailsHeading}
${cards}
  </td></tr>
</table>
</div>`
}

/** Plain-text priority flag label, matching priorityPill()/the page. */
function priorityFlagText(row: LiveOutreachRow): string {
  const kind = priorityFlagKind(row)
  if (kind === "high") return "High Priority"
  if (kind === "new") return "New Client"
  return ""
}

/** A minimal text/plain version, used only as the clipboard's plain-text flavor. */
export function buildEmailPlain(rows: LiveOutreachRow[], todayLabel: string): string {
  const lines: string[] = [`Non-Deal Roadshow Update - ${todayLabel}`, ""]

  // One-line-per-event index (mirrors the HTML Event Summary's order/fields:
  // ticker · flag · conf · open · dates).
  if (rows.length > 0) {
    lines.push("EVENT SUMMARY")
    for (const r of rows) {
      const ticker = r.ticker ? baseTicker(r.ticker) : "—"
      const rem = r.slots_remaining
      const open = rem == null ? "—" : String(Math.max(0, rem))
      const parts = [
        priorityFlagText(r),
        `${r.confirmed_meeting_count ?? 0} conf`,
        `${open} open`,
        r.event_dates ? truncateDates(r.event_dates, 30) : "",
      ].filter(Boolean)
      lines.push(`  ${ticker} — ${parts.join(" · ")}`)
    }
    lines.push("", "----------------------------------------", "", "EVENT DETAILS", "")
  }

  for (const r of rows) {
    const head = [r.ticker, r.client_account_name ?? r.event_name].filter(Boolean).join(" ")
    lines.push(head)
    if (r.industry) lines.push(`  ${r.industry}`)
    const meetings = r.confirmed_meetings ?? []
    lines.push(`  Confirmed Meetings (${r.confirmed_meeting_count ?? 0})`)
    for (const m of meetings) {
      const date = fmtMeetingDate(m.meeting_date)
      const tag = isRecentlyAdded(m.created_on) ? "  [NEW]" : ""
      lines.push(`    ${date} · ${m.institution_name ?? "—"}${m.contact ? ` · ${m.contact}` : ""}${tag}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

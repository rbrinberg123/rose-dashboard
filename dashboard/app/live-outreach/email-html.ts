// Builds the Outlook-safe email HTML for the Live Outreach page from the current
// rows. Same table-based, inline-styled format as the static snapshot we built
// (1080px two-panel cards, plain-text confirmed-meeting counts, no logo). Pure —
// no DOM / React — so it runs identically on the server or in the browser.
//
// Returns a self-contained FRAGMENT (a wrapper <div> that sets the base font),
// NOT a full <html> document, so it can be dropped into an offscreen element and
// copied as rich text, or written to the clipboard as text/html.

import type { LiveOutreachRow } from "@/lib/types"

// Layout widths (px). Wider build, matching the approved snapshot.
const LEFT = 380
const RIGHT = 700
const CARD = LEFT + RIGHT // 1080
const CONTAINER = CARD

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

const MODE_STYLE: Record<string, { bg: string; text: string }> = {
  Virtual: { bg: "#EEF2FB", text: "#2D4A8A" },
  Live: { bg: "#E7F5EE", text: "#0E7C56" },
  Hybrid: { bg: "#F3ECFB", text: "#6B3FA0" },
}

function statCell(label: string, value: string, danger?: boolean, title?: string | null): string {
  return `<td width="50%" valign="top" style="padding:3px 0;vertical-align:top;">
    <div style="font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:#9AA1AD;">${esc(label)}</div>
    <div style="font-size:13px;font-weight:bold;color:${danger ? "#A32D2D" : "#1A2233"};"${title ? ` title="${esc(title)}"` : ""}>${esc(value)}</div>
  </td>`
}

function urgencyPill(urgency: LiveOutreachRow["urgency"]): string {
  if (!urgency) return ""
  const high = urgency === "High"
  const bg = high ? "#FDE7E7" : "#F1F3F7"
  const fg = high ? "#A32D2D" : "#5B6472"
  const label = high ? "High Urgency" : "Standard"
  return `<span style="background-color:${bg};color:${fg};font-size:11px;font-weight:bold;padding:3px 9px;border-radius:10px;white-space:nowrap;">${label}</span>`
}

function modeTag(mode: LiveOutreachRow["event_mode"]): string {
  if (!mode || !MODE_STYLE[mode]) return ""
  const s = MODE_STYLE[mode]
  return `<span style="background-color:${s.bg};color:${s.text};font-size:11px;font-weight:bold;padding:2px 8px;border-radius:6px;white-space:nowrap;">${esc(mode)}</span>`
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

function meetingsBlock(row: LiveOutreachRow): string {
  const meetings = row.confirmed_meetings ?? []
  const count = row.confirmed_meeting_count ?? 0
  // Plain-text count in parentheses — renders reliably in Outlook (a styled
  // navy pill rendered as a dark box with a barely-visible number).
  const header = `<div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:#5B6472;margin-bottom:6px;">Confirmed Meetings (${count})</div>`
  if (meetings.length === 0) {
    return header + `<div style="font-size:13px;color:#9AA1AD;padding:4px 0;">No confirmed meetings yet.</div>`
  }
  const rowsHtml = meetings
    .map((m, i) => {
      const sep = i === meetings.length - 1 ? "" : "border-bottom:1px solid #EFF1F5;"
      const contact = m.contact
        ? ` <span style="color:#9AA1AD;">·</span> <span style="color:#6B7280;">${esc(m.contact)}</span>`
        : ""
      return `<tr>
        <td width="58" valign="top" style="font-size:11px;font-weight:bold;color:#1E2858;padding:4px 8px 4px 0;white-space:nowrap;vertical-align:top;${sep}">${esc(fmtMeetingDate(m.meeting_date))}</td>
        <td valign="top" style="font-size:13px;color:#1A2233;padding:4px 0;vertical-align:top;${sep}">${esc(m.institution_name ?? "—")}${contact}</td>
      </tr>`
    })
    .join("")
  return header + `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;">${rowsHtml}</table>`
}

function card(row: LiveOutreachRow): string {
  const slots = openSlots(row.slots_remaining, row.of_slots)
  const tickerHtml = row.ticker ? `<span style="color:#1E2858;">${esc(row.ticker)}</span>&nbsp; ` : ""
  const industryHtml = row.industry ? `<div style="font-size:12px;color:#6B7280;margin-top:2px;">${esc(row.industry)}</div>` : ""
  const pill = urgencyPill(row.urgency)
  const pillRow = pill ? `<div style="margin-top:7px;">${pill}</div>` : ""
  const datesHtml = row.event_dates
    ? `<span style="font-size:12px;color:#6B7280;">${esc(row.event_dates)}</span>`
    : `<span style="font-size:12px;color:#9AA1AD;">No dates set</span>`
  const mode = modeTag(row.event_mode)

  return `<table width="${CARD}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;border:1px solid #E6EAF0;margin:0 0 14px 0;width:${CARD}px;font-family:Arial,Helvetica,sans-serif;">
    <tr>
      <td width="${LEFT}" valign="top" bgcolor="#FFFFFF" style="width:${LEFT}px;vertical-align:top;background-color:#FFFFFF;padding:16px 18px;">
        <div style="font-size:15px;font-weight:bold;color:#1A2233;line-height:1.3;">${tickerHtml}${esc(row.client_account_name ?? row.event_name ?? "—")}</div>
        ${industryHtml}
        ${pillRow}
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:12px;border-collapse:collapse;">
          <tr>
            ${statCell("Div Yield", fmtYield(row.div_yield))}
            ${statCell("Mkt Cap", fmtMcap(row.market_cap_b))}
          </tr>
          <tr>
            ${statCell("Lead", row.sales_lead_name ?? "—")}
            ${statCell("Open Slots", slots.value, slots.danger, slots.title)}
          </tr>
        </table>
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid #EFF1F5;">
          ${mode ? mode + "&nbsp; " : ""}${datesHtml}
        </div>
      </td>
      <td width="${RIGHT}" valign="top" bgcolor="#F7F8FA" style="width:${RIGHT}px;vertical-align:top;background-color:#F7F8FA;padding:16px 18px;">
        ${meetingsBlock(row)}
      </td>
    </tr>
  </table>`
}

/** The rich-HTML fragment for clipboard/email use. `todayLabel` e.g. "June 30, 2026". */
export function buildEmailHtml(rows: LiveOutreachRow[], todayLabel: string): string {
  const totalMeetings = rows.reduce((s, r) => s + (r.confirmed_meeting_count ?? 0), 0)
  const cards = rows.map(card).join("\n")
  return `<div style="font-family:Arial,Helvetica,sans-serif;background-color:#FFFFFF;color:#1A2233;">
<table width="${CONTAINER}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${CONTAINER}px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
  <tr><td style="padding:0 0 4px 0;">
    <div style="font-size:22px;font-weight:bold;color:#1A2233;">Non-Deal Roadshow Update - ${esc(todayLabel)}</div>
    <div style="font-size:12px;color:#6B7280;padding:4px 0 16px 0;">${rows.length} event${rows.length === 1 ? "" : "s"} in active outreach &middot; ${totalMeetings} confirmed meeting${totalMeetings === 1 ? "" : "s"}</div>
  </td></tr>
  <tr><td>
${cards}
  </td></tr>
</table>
</div>`
}

/** A minimal text/plain version, used only as the clipboard's plain-text flavor. */
export function buildEmailPlain(rows: LiveOutreachRow[], todayLabel: string): string {
  const lines: string[] = [`Non-Deal Roadshow Update - ${todayLabel}`, ""]
  for (const r of rows) {
    const head = [r.ticker, r.client_account_name ?? r.event_name].filter(Boolean).join(" ")
    lines.push(head)
    if (r.industry) lines.push(`  ${r.industry}`)
    const meetings = r.confirmed_meetings ?? []
    lines.push(`  Confirmed Meetings (${r.confirmed_meeting_count ?? 0})`)
    for (const m of meetings) {
      const date = fmtMeetingDate(m.meeting_date)
      lines.push(`    ${date} · ${m.institution_name ?? "—"}${m.contact ? ` · ${m.contact}` : ""}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

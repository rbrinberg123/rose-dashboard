import "server-only"

/**
 * Calendar-invite transport for the Events Planner.
 *
 * CalendarSender is the seam — the Invites tab and the send action never know
 * how an invite travels:
 *   - IcsEmailSender (live): emails each person a real calendar invite
 *     (multipart/alternative with a text/calendar METHOD part) FROM the shared
 *     dashboards@roseandco.com mailbox, using the Graph app's existing Mail.Send
 *     permission. Outlook / Gmail show Accept / Decline; replies go to
 *     dashboards@. Graph's sendMail takes the raw MIME (base64) so the calendar
 *     part survives — the JSON sendMail in lib/graph/mail.ts can't carry it.
 *   - GraphCalendarSender (not configured): would create the event in an
 *     organizer's Outlook calendar instead. Needs the Graph app to have
 *     Calendars.ReadWrite (application) and the organizer's mailbox inside the
 *     app's Application Access Policy group. Left as a stub on purpose.
 *
 * DRY RUN — EVENTS_INVITES_DRY_RUN:
 *   "true"  → never send; everything else happens (ICS built, ep_invites
 *             written with dry_run = true, activity logged).
 *   "false" → send for real.
 *   unset   → dry run everywhere EXCEPT production (VERCEL_ENV=production).
 */

import { getGraphAccessToken } from "@/lib/graph"
import { MAIL_SENDER } from "@/lib/graph"
import {
  INVITE_ORGANIZER,
  dualTime,
  formatDay,
  formatTime,
  isoToZoned,
  zoneAbbrev,
  type InviteAttendee,
  type InviteItem,
  type InvitePayload,
} from "./core"
import type { BuilderItinerary, TypeOption } from "./types"

export function isInvitesDryRun(): boolean {
  const v = process.env.EVENTS_INVITES_DRY_RUN?.trim().toLowerCase()
  if (v === "false" || v === "0") return false
  if (v === "true" || v === "1") return true
  return process.env.VERCEL_ENV !== "production"
}

export type InviteMessage = {
  to: { name: string; email: string }
  subject: string
  html: string
  ics: string
  method: "REQUEST" | "CANCEL"
}

export interface CalendarSender {
  readonly provider: "ics_email" | "graph"
  send(m: InviteMessage): Promise<{ providerEventId: string | null }>
}

/* ---- MIME ---------------------------------------------------------------- */

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64")
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n").trimEnd()
const encodeWord = (s: string) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`)
const quoteName = (s: string) => `"${s.replace(/["\\]/g, "")}"`

export function buildInviteMime(m: InviteMessage): string {
  const boundary = `ep_${crypto.randomUUID().replace(/-/g, "")}`
  return [
    `From: ${encodeWord(INVITE_ORGANIZER.name)} <${MAIL_SENDER}>`,
    `To: ${encodeWord(quoteName(m.to.name))} <${m.to.email}>`,
    `Subject: ${encodeWord(m.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(m.html)),
    `--${boundary}`,
    `Content-Type: text/calendar; charset="UTF-8"; method=${m.method}`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(m.ics)),
    `--${boundary}--`,
    "",
  ].join("\r\n")
}

export class IcsEmailSender implements CalendarSender {
  readonly provider = "ics_email" as const
  async send(m: InviteMessage): Promise<{ providerEventId: string | null }> {
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAIL_SENDER)}/sendMail`
    const body = b64(buildInviteMime(m))
    for (let attempt = 0; ; attempt++) {
      const token = await getGraphAccessToken()
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
        body,
      })
      if (res.status === 429 && attempt < 3) {
        const wait = Number(res.headers.get("retry-after")) || 10
        await new Promise((r) => setTimeout(r, wait * 1000))
        continue
      }
      if (!res.ok) throw new Error(`Microsoft Graph returned ${res.status}: ${(await res.text()).slice(0, 300)}`)
      return { providerEventId: null }
    }
  }
}

/** Not configured — see the header. Kept so the transport can change without touching the UI. */
export class GraphCalendarSender implements CalendarSender {
  readonly provider = "graph" as const
  async send(): Promise<{ providerEventId: string | null }> {
    throw new Error(
      "Outlook calendar sending isn't set up. It needs Calendars.ReadWrite on the Graph app and the organizer mailbox in its access policy.",
    )
  }
}

export function getCalendarSender(): CalendarSender {
  return new IcsEmailSender()
}

/* ---- builder data → invite inputs ---------------------------------------- */

export function inviteInputs(itin: BuilderItinerary, meetingTypes: readonly TypeOption[]): {
  items: InviteItem[]
  attendees: InviteAttendee[]
} {
  const mt = new Map(meetingTypes.map((m) => [m.id, m.name]))
  return {
    items: itin.items.map((i) => ({
      id: i.id,
      item_type: i.item_type,
      status: i.status,
      send_invite: i.send_invite,
      title: i.title,
      start_at: i.start_at,
      end_at: i.end_at,
      timezone: i.timezone,
      institution_name: i.institution_name,
      meeting_type_name: i.meeting_type_id ? mt.get(i.meeting_type_id) ?? null : null,
      venue_name: i.venue_name,
      address_line1: i.address_line1,
      address_line2: i.address_line2,
      city: i.city,
      state: i.state,
      postal_code: i.postal_code,
      room_or_floor: i.room_or_floor,
      video_url: i.video_url,
      dial_in: i.dial_in,
      dial_in_passcode: i.dial_in_passcode,
      notes_external: i.notes_external,
      attendee_ids: i.attendee_ids,
      // Only the fields an invite may show — never confirmation numbers.
      travel: i.travel
        ? {
            mode: i.travel.mode,
            to_timezone: i.travel.to_timezone,
            driver_name: i.travel.driver_name,
            driver_phone: i.travel.driver_phone,
            transport_company: i.travel.transport_company,
            carrier: i.travel.carrier,
            flight_or_train_number: i.travel.flight_or_train_number,
            pickup_instructions: i.travel.pickup_instructions,
          }
        : null,
    })),
    attendees: itin.attendees.map((a) => ({
      id: a.id,
      full_name: a.full_name,
      email: a.email,
      phone: a.phone,
      title: a.title,
      company: a.company,
      side: a.side,
      receives_full_itinerary: a.receives_full_itinerary,
    })),
  }
}

/* ---- the email around the invite ---------------------------------------- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export function inviteSubject(p: InvitePayload, item: InviteItem, kind: "new" | "update" | "cancel"): string {
  const when = `${formatDay(isoToZoned(item.start_at, item.timezone).date)}, ${formatTime(item.start_at, item.timezone)} ${zoneAbbrev(item.start_at, item.timezone)}`
  const prefix = kind === "cancel" ? "Cancelled" : kind === "update" ? "Updated invitation" : "Invitation"
  return `${prefix}: ${p.summary} @ ${when}`
}

export function inviteEmailHtml(p: InvitePayload, item: InviteItem, kind: "new" | "update" | "cancel"): string {
  const day = formatDay(isoToZoned(item.start_at, item.timezone).date)
  const endTz = item.travel?.to_timezone && item.travel.to_timezone !== item.timezone ? item.travel.to_timezone : item.timezone
  const when = `${day} · ${dualTime(item.start_at, item.timezone)} – ${formatTime(item.end_at, endTz)} ${zoneAbbrev(item.end_at, endTz)}`
  const lead =
    kind === "cancel"
      ? "This meeting has been cancelled. It will be removed from your calendar."
      : kind === "update"
        ? "This invitation has been updated. Please review the details below."
        : "You're invited. Accept or decline using your calendar's buttons."
  const row = (label: string, value: string) =>
    value
      ? `<tr><td style="padding:4px 12px 4px 0;color:#6B7280;vertical-align:top;white-space:nowrap">${label}</td><td style="padding:4px 0;color:#1A2233">${esc(value).replace(/\n/g, "<br>")}</td></tr>`
      : ""
  return `<!doctype html><html><body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1A2233">
<div style="max-width:560px">
<p style="margin:0 0 12px">${esc(lead)}</p>
<h2 style="margin:0 0 12px;font-size:18px;${kind === "cancel" ? "text-decoration:line-through;" : ""}">${esc(p.summary)}</h2>
<table style="border-collapse:collapse;margin-bottom:16px">${row("When", when)}${row("Where", p.location)}</table>
${p.description ? `<p style="margin:0 0 16px;white-space:normal">${esc(p.description).replace(/\n/g, "<br>")}</p>` : ""}
<p style="margin:0;color:#6B7280;font-size:12px">Sent by Rose &amp; Company. Replies go to ${esc(INVITE_ORGANIZER.email)}.</p>
</div></body></html>`
}

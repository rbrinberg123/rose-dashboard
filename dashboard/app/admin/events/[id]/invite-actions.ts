"use server"

/**
 * Events Planner — calendar invites (Invites tab).
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * Service-role client, so each action gates itself: reading the invite state
 * needs effective super_user; SENDING needs requireCrmWriter (super_user, not
 * in "View as"). The browser only names which (item, person) pairs to send;
 * the server re-reads the itinerary, re-plans, and sends only pairs that are
 * genuinely due — it never trusts the browser's idea of what changed.
 *
 * Invites go out only from a finalized / invites-sent itinerary, are logged to
 * ep_activity_log one line per message, audited, and honour
 * EVENTS_INVITES_DRY_RUN (see lib/events-planner/invites.ts).
 */

import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import { getEffectiveRole } from "@/lib/effective-identity"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { isUuid, requireCrmWriter } from "@/lib/crm-write"
import { buildIcs, invitePayload, planInvites, type InvitePlanRow, type InviteRecord } from "@/lib/events-planner/core"
import { loadBuilderItinerary } from "@/lib/events-planner/load"
import {
  getCalendarSender,
  inviteEmailHtml,
  inviteInputs,
  inviteSubject,
  isInvitesDryRun,
} from "@/lib/events-planner/invites"
import type { ItineraryStatus, TypeOption } from "@/lib/events-planner/types"

export type InviteRecordView = InviteRecord & { last_sent_at: string | null; error_message: string | null }

export type InviteState = {
  live: boolean
  rows: InvitePlanRow[]
  records: InviteRecordView[]
}

async function loadAll(itineraryId: string) {
  const sb = getSupabaseServer()
  const [itin, mt, inv] = await Promise.all([
    loadBuilderItinerary(sb, itineraryId),
    sb.from("ep_meeting_types").select("id, name"),
    sb
      .from("ep_invites")
      .select("item_id, attendee_id, status, sequence, last_payload_hash, dry_run, last_sent_at, error_message, ep_items!inner(itinerary_id)")
      .eq("ep_items.itinerary_id", itineraryId),
  ])
  return { sb, itin, meetingTypes: (mt.data ?? []) as TypeOption[], inv }
}

/** Every (item, person) pair with its invite state and what would be sent. */
export async function loadInviteState(itineraryId: string): Promise<ActionResult<InviteState>> {
  if ((await getEffectiveRole()) !== "super_user") return fail("Not authorised.")
  if (!isUuid(itineraryId)) return fail("Unknown itinerary.")
  const { itin, meetingTypes, inv } = await loadAll(itineraryId)
  if (itin.error) return fail(itin.error)
  if (!itin.data) return fail("That itinerary no longer exists.")
  if (inv.error) return fail(describeError(inv.error))
  const records = ((inv.data ?? []) as unknown as InviteRecordView[]).map(({ ...r }) => {
    delete (r as Record<string, unknown>).ep_items
    return r
  })
  const live = !isInvitesDryRun()
  const { items, attendees } = inviteInputs(itin.data, meetingTypes)
  return ok({ live, records, rows: planInvites({ items, attendees, records, clientName: itin.data.client_name, live }) })
}

export type SendResult = {
  dryRun: boolean
  sent: number
  updated: number
  cancelled: number
  failed: { name: string; item: string; error: string }[]
  status: ItineraryStatus
}

/** Send the chosen invites / updates / cancellations. */
export async function sendInvites(
  itineraryId: string,
  pairs: { itemId: string; attendeeId: string }[],
): Promise<ActionResult<SendResult>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("sending invites")
  if (!gate.ok) return fail(gate.error)
  if (!isUuid(itineraryId)) return fail("Unknown itinerary.")
  if (!pairs?.length) return fail("Nothing selected to send.")

  const { sb, itin, meetingTypes, inv } = await loadAll(itineraryId)
  if (itin.error) return fail(itin.error)
  if (!itin.data) return fail("That itinerary no longer exists.")
  if (inv.error) return fail(describeError(inv.error))
  const data = itin.data
  if (data.status !== "finalized" && data.status !== "invites_sent")
    return fail("Finalise the itinerary before sending invites.")

  const dryRun = isInvitesDryRun()
  const records = (inv.data ?? []) as unknown as InviteRecord[]
  const { items, attendees } = inviteInputs(data, meetingTypes)
  const plan = planInvites({ items, attendees, records, clientName: data.client_name, live: !dryRun })
  const wanted = new Set(pairs.map((p) => `${p.itemId}:${p.attendeeId}`))
  const due = plan.filter((r) => r.action !== "none" && wanted.has(`${r.itemId}:${r.attendeeId}`))
  if (!due.length) return fail("Nothing selected needs sending — it may already be up to date.")

  const sender = getCalendarSender()
  const result: SendResult = { dryRun, sent: 0, updated: 0, cancelled: 0, failed: [], status: data.status }
  const now = new Date()
  const logRows: Record<string, unknown>[] = []

  for (const r of due) {
    const item = items.find((i) => i.id === r.itemId)!
    const person = attendees.find((a) => a.id === r.attendeeId)!
    const kind = r.action as "new" | "update" | "cancel"
    const method = kind === "cancel" ? "CANCEL" : "REQUEST"
    const payload = invitePayload(item, attendees, data.client_name)
    const recipient = { name: person.full_name, email: (person.email ?? "").trim() }
    const ics = buildIcs({ payload, method, sequence: r.sequence, recipient, now })

    let status: "sent" | "updated" | "cancelled" | "failed" = kind === "new" ? "sent" : kind === "update" ? "updated" : "cancelled"
    let error: string | null = null
    if (!dryRun) {
      if (!recipient.email) {
        status = "failed"
        error = "No email address."
      } else {
        try {
          await sender.send({
            to: recipient,
            subject: inviteSubject(payload, item, kind),
            html: inviteEmailHtml(payload, item, kind),
            ics,
            method,
          })
        } catch (e) {
          status = "failed"
          error = (e as Error).message.slice(0, 500)
        }
      }
    }

    // A failed UPDATE / CANCEL keeps the invite's previous status + sequence, so
    // it stays "delivered" and is offered again — the person still holds the
    // old version. Only a failed first send is marked "failed".
    const failed = status === "failed"
    const { error: wErr } = await sb.from("ep_invites").upsert(
      {
        item_id: r.itemId,
        attendee_id: r.attendeeId,
        ical_uid: payload.uid,
        sequence: failed && kind !== "new" ? undefined : r.sequence,
        provider: sender.provider,
        status: failed && kind !== "new" ? undefined : status,
        dry_run: failed && kind !== "new" ? undefined : dryRun,
        last_sent_at: failed ? undefined : now.toISOString(),
        last_payload_hash: failed ? undefined : kind === "cancel" ? r.hash : payload.hash,
        error_message: error,
      },
      { onConflict: "item_id,attendee_id" },
    )
    if (wErr && !error) error = describeError(wErr)

    if (status === "failed" || wErr) result.failed.push({ name: person.full_name, item: item.title, error: error ?? "Could not record the send." })
    else if (kind === "new") result.sent++
    else if (kind === "update") result.updated++
    else result.cancelled++

    logRows.push({
      itinerary_id: itineraryId,
      actor_id: gate.userId,
      actor_name: gate.name,
      action: status === "failed" ? "invite_failed" : kind === "new" ? "invite_sent" : kind === "update" ? "invite_updated" : "invite_cancelled",
      details: { item_id: item.id, item: item.title, attendee: person.full_name, email: recipient.email, sequence: r.sequence, dry_run: dryRun, error },
    })
  }

  if (logRows.length) await sb.from("ep_activity_log").insert(logRows)
  await recordAudit({
    action: "update",
    entity: "ep_invites",
    recordId: itineraryId,
    changes: { dry_run: dryRun, sent: result.sent, updated: result.updated, cancelled: result.cancelled, failed: result.failed.length, messages: logRows.map((l) => l.details) },
    context: `/admin/events/${itineraryId} · Send invites${dryRun ? " (dry run)" : ""}`,
  })

  // Sending moves the itinerary to invites_sent — straight update, not an "edit".
  const anyOk = result.sent + result.updated + result.cancelled > 0
  if (anyOk && data.status !== "invites_sent") {
    await sb.from("ep_itineraries").update({ status: "invites_sent" }).eq("id", itineraryId)
    result.status = "invites_sent"
  }
  revalidatePath(`/admin/events/${itineraryId}`)
  revalidatePath("/admin/events")
  return ok(result)
}

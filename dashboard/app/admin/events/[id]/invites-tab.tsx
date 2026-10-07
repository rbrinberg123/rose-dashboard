"use client"

/**
 * Invites tab — people × items, each cell an invite's state (not sent, sent,
 * update pending, cancel pending, cancelled, failed). The server works out what
 * is due (lib/events-planner/core.ts planInvites); this screen only chooses
 * which of those to send, and NOTHING goes out without the confirmation step:
 * every recipient, item and action listed, outside (non-Rose) addresses
 * highlighted, then an explicit Send.
 */

import * as React from "react"
import { AlertTriangle, CalendarCheck, Download, Loader2, Mail, Send, XCircle } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CARD_CLASS, STATUS_PILL_LIGHT, TEXT_MUTED } from "@/lib/design"
import { formatDay, formatTime, isExternalEmail, isoToZoned, type InvitePlanRow, type InviteState } from "@/lib/events-planner/core"
import { useBuilder } from "./builder-context"
import { loadInviteState, sendInvites, type InviteState as ServerState } from "./invite-actions"

const STATE: Record<InviteState, { label: string; tone: keyof typeof STATUS_PILL_LIGHT }> = {
  ineligible: { label: "—", tone: "neutral" },
  not_sent: { label: "Not sent", tone: "neutral" },
  sent: { label: "Sent", tone: "positive" },
  updated: { label: "Updated", tone: "positive" },
  update_pending: { label: "Update pending", tone: "watch" },
  cancel_pending: { label: "Cancel pending", tone: "watch" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "atRisk" },
}

const ACTION_LABEL = { new: "New invite", update: "Update", cancel: "Cancellation" } as const

const key = (r: { itemId: string; attendeeId: string }) => `${r.itemId}:${r.attendeeId}`

export function InvitesTab() {
  const { itin, readOnly, setStatus } = useBuilder()
  const [state, setState] = React.useState<ServerState | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  const [confirm, setConfirm] = React.useState<InvitePlanRow[] | null>(null)
  const [sending, setSending] = React.useState(false)

  // Re-plan whenever what's on the schedule changes (debounced).
  const planKey = React.useMemo(
    () => JSON.stringify([itin.status, itin.items.map((i) => [i.id, i.start_at, i.end_at, i.status, i.send_invite, i.attendee_ids, i.title, i.notes_external, i.venue_name, i.address_line1, i.video_url]), itin.attendees.map((a) => [a.id, a.email, a.receives_full_itinerary])]),
    [itin.status, itin.items, itin.attendees],
  )
  const reload = React.useCallback(() => {
    loadInviteState(itin.id).then((r) => {
      if (r.ok) {
        setState(r.data)
        setError(null)
      } else setError(r.error)
    })
  }, [itin.id])
  React.useEffect(() => {
    const t = setTimeout(reload, 400)
    return () => clearTimeout(t)
  }, [reload, planKey])

  const canSend = itin.status === "finalized" || itin.status === "invites_sent"
  const rows = state?.rows ?? []
  const byKey = new Map(rows.map((r) => [key(r), r]))
  const due = rows.filter((r) => r.action !== "none")
  const updates = due.filter((r) => r.action === "update")
  const cancels = due.filter((r) => r.action === "cancel")
  const news = due.filter((r) => r.action === "new")

  // Columns: every item someone could be invited to, plus any with invite history.
  const itemIds = new Set(rows.filter((r) => r.state !== "ineligible" || r.dryRun).map((r) => r.itemId))
  const items = itin.items.filter((i) => itemIds.has(i.id) || (i.send_invite && i.status !== "cancelled" && i.attendee_ids.length))
  const people = itin.attendees.filter((a) => rows.some((r) => r.attendeeId === a.id && r.state !== "ineligible") || items.some((i) => i.attendee_ids.includes(a.id)))
  const dayOf = (dayId: string) => itin.days.find((d) => d.id === dayId)
  const lastSent = (r: InvitePlanRow) => state?.records.find((x) => x.item_id === r.itemId && x.attendee_id === r.attendeeId)

  function openConfirm(list: InvitePlanRow[]) {
    if (!list.length) return toast("Nothing to send for that.")
    setConfirm(list)
  }

  async function onSend() {
    if (!confirm) return
    setSending(true)
    const r = await sendInvites(itin.id, confirm.map((x) => ({ itemId: x.itemId, attendeeId: x.attendeeId })))
    setSending(false)
    if (!r.ok) return toast.error("Nothing sent", { description: r.error })
    const d = r.data
    const parts = [d.sent && `${d.sent} new`, d.updated && `${d.updated} updated`, d.cancelled && `${d.cancelled} cancelled`].filter(Boolean).join(" · ")
    if (d.failed.length)
      toast.error(`${d.failed.length} failed`, { description: d.failed.slice(0, 3).map((f) => `${f.name} — ${f.item}: ${f.error}`).join("\n") })
    if (parts) toast.success(d.dryRun ? `Dry run — nothing emailed (${parts})` : `Sent: ${parts}`)
    setStatus(d.status)
    setConfirm(null)
    setPicked(new Set())
    reload()
  }

  if (error) return <div className={`${CARD_CLASS} p-4 text-sm text-destructive`}>{error}</div>
  if (!state)
    return (
      <div className={`${CARD_CLASS} flex items-center gap-2 p-6 text-sm text-muted-foreground`}>
        <Loader2 className="size-4 animate-spin" /> Working out who gets what…
      </div>
    )

  const tone = (t: keyof typeof STATUS_PILL_LIGHT) => STATUS_PILL_LIGHT[t]

  return (
    <div className="space-y-3">
      {!state.live && (
        <div className="rounded-lg px-4 py-2.5 text-sm" style={{ background: tone("new").bg, color: tone("new").text }}>
          <b>Dry run.</b> Invites are built and recorded but nothing is emailed. Set <code>EVENTS_INVITES_DRY_RUN=false</code> to send for real.
        </div>
      )}
      {!canSend && (
        <div className="rounded-lg px-4 py-2.5 text-sm" style={{ background: tone("watch").bg, color: tone("watch").text }}>
          Finalise the itinerary before sending invites{itin.status === "in_review" ? " — it changed since it was last finalised" : ""}.
        </div>
      )}
      {updates.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm" style={{ background: tone("watch").bg, color: tone("watch").text }}>
          <AlertTriangle className="size-4" />
          {updates.length} invite{updates.length === 1 ? " has" : "s have"} changes since {updates.length === 1 ? "it was" : "they were"} sent.
        </div>
      )}

      <div className={`${CARD_CLASS} p-4`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <div className="text-sm font-semibold">Calendar invites</div>
            <div className="text-xs" style={{ color: TEXT_MUTED }}>
              From dashboards@roseandco.com · each person gets only their own items · travel goes only to the travelling party
            </div>
          </div>
          {!readOnly && (
            <>
              <Button size="sm" variant="outline" disabled={!canSend || !picked.size} onClick={() => openConfirm(due.filter((r) => picked.has(key(r))))}>
                <Send className="size-4" /> Send selected ({picked.size})
              </Button>
              <Button size="sm" variant="outline" disabled={!canSend || !news.length} onClick={() => openConfirm(news)}>
                <Mail className="size-4" /> Send all pending ({news.length})
              </Button>
              <Button size="sm" variant="outline" disabled={!canSend || !updates.length} onClick={() => openConfirm(updates)}>
                <CalendarCheck className="size-4" /> Send updates ({updates.length})
              </Button>
              <Button size="sm" variant="outline" disabled={!canSend || !cancels.length} onClick={() => openConfirm(cancels)}>
                <XCircle className="size-4" /> Cancel invites for cancelled items ({cancels.length})
              </Button>
            </>
          )}
        </div>

        {!items.length || !people.length ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            No one to invite yet. Put attendees on items (Attendees tab) and keep “Send calendar invite” on.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-48 bg-white px-2 py-1 text-left font-medium">Attendee</th>
                  {items.map((i) => {
                    const d = dayOf(i.day_id)
                    return (
                      <th key={i.id} className="w-28 min-w-28 border-l border-border px-1.5 py-1 text-left align-bottom font-normal">
                        <div className="text-[10px]" style={{ color: TEXT_MUTED }}>
                          {d ? formatDay(d.date) : formatDay(isoToZoned(i.start_at, i.timezone).date)} · {formatTime(i.start_at, i.timezone)}
                        </div>
                        <div className={`line-clamp-2 font-medium ${i.status === "cancelled" ? "line-through" : ""}`} title={i.title}>
                          {i.title}
                        </div>
                        <a href={`/admin/events/${itin.id}/ics?item=${i.id}`} className="inline-flex items-center gap-0.5 text-[10px] underline" style={{ color: TEXT_MUTED }}>
                          <Download className="size-3" /> .ics
                        </a>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {people.map((a) => (
                  <tr key={a.id}>
                    <td className="sticky left-0 z-10 border-t border-border bg-white px-2 py-1.5">
                      <div className="font-medium">{a.full_name}</div>
                      <div className="text-[10px]" style={{ color: a.email ? TEXT_MUTED : tone("watch").text }}>
                        {a.email ?? "No email"}
                      </div>
                    </td>
                    {items.map((i) => {
                      const r = byKey.get(`${i.id}:${a.id}`)
                      if (!r || r.state === "ineligible")
                        return (
                          <td key={i.id} className="border-l border-t border-border text-center" title={r?.reason ?? "Not on this item"} style={{ color: TEXT_MUTED }}>
                            —
                          </td>
                        )
                      const s = STATE[r.state]
                      const sent = lastSent(r)
                      return (
                        <td key={i.id} className="border-l border-t border-border px-1.5 py-1">
                          <div className="flex items-center gap-1">
                            {r.action !== "none" && !readOnly && (
                              <Checkbox
                                checked={picked.has(key(r))}
                                onCheckedChange={(c) =>
                                  setPicked((p) => {
                                    const n = new Set(p)
                                    if (c === true) n.add(key(r))
                                    else n.delete(key(r))
                                    return n
                                  })
                                }
                                aria-label={`Select ${a.full_name} for ${i.title}`}
                              />
                            )}
                            <span
                              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ background: tone(s.tone).bg, color: tone(s.tone).text }}
                              title={
                                [sent?.last_sent_at ? `Last sent ${new Date(sent.last_sent_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET` : null, sent?.error_message, r.reason]
                                  .filter(Boolean)
                                  .join(" · ") || undefined
                              }
                            >
                              {s.label}
                              {r.dryRun && r.state !== "not_sent" ? " (dry)" : ""}
                            </span>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmSend rows={confirm} sending={sending} live={state.live} onCancel={() => setConfirm(null)} onSend={onSend} />
    </div>
  )
}

function ConfirmSend({
  rows,
  sending,
  live,
  onCancel,
  onSend,
}: {
  rows: InvitePlanRow[] | null
  sending: boolean
  live: boolean
  onCancel: () => void
  onSend: () => void
}) {
  const { itin } = useBuilder()
  if (!rows) return null
  const people = new Map(itin.attendees.map((a) => [a.id, a]))
  const items = new Map(itin.items.map((i) => [i.id, i]))
  const byPerson = new Map<string, InvitePlanRow[]>()
  for (const r of rows) byPerson.set(r.attendeeId, [...(byPerson.get(r.attendeeId) ?? []), r])
  const external = [...byPerson.keys()].filter((id) => isExternalEmail(people.get(id)?.email)).length

  return (
    <Dialog open onOpenChange={(o) => !o && !sending && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {live ? "Send" : "Dry run:"} {rows.length} calendar message{rows.length === 1 ? "" : "s"} to {byPerson.size} {byPerson.size === 1 ? "person" : "people"}?
          </DialogTitle>
          <DialogDescription>
            {live ? "These go out now from dashboards@roseandco.com." : "Dry run — everything is recorded, nothing is emailed."}
            {external > 0 ? ` ${external} recipient${external === 1 ? " is" : "s are"} outside Rose & Company (highlighted).` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
          {[...byPerson.entries()].map(([pid, list]) => {
            const p = people.get(pid)
            const ext = isExternalEmail(p?.email)
            return (
              <div key={pid} className="px-3 py-2 text-sm" style={ext ? { background: STATUS_PILL_LIGHT.watch.bg } : undefined}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p?.full_name}</span>
                  <span className="text-xs text-muted-foreground">{p?.email}</span>
                  {ext && (
                    <span className="rounded-full px-1.5 text-[10px] font-medium" style={{ color: STATUS_PILL_LIGHT.watch.text, border: `1px solid ${STATUS_PILL_LIGHT.watch.text}` }}>
                      External
                    </span>
                  )}
                </div>
                <ul className="mt-1 grid gap-0.5 text-xs">
                  {list.map((r) => {
                    const i = items.get(r.itemId)
                    return (
                      <li key={r.itemId} className="flex gap-2">
                        <span className="w-24 shrink-0 font-medium">{ACTION_LABEL[r.action as keyof typeof ACTION_LABEL]}</span>
                        <span className="truncate">
                          {i ? `${formatDay(isoToZoned(i.start_at, i.timezone).date)} ${formatTime(i.start_at, i.timezone)} · ${i.title}` : r.itemId}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={onSend} disabled={sending}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} {live ? "Send now" : "Run dry run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

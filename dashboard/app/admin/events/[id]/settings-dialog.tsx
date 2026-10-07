"use client"

/** Itinerary settings: title, type, client name, meeting length, notes, confidential. */

import * as React from "react"
import { Loader2, Settings2 } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useBuilder } from "./builder-context"
import { updateItinerarySettings } from "./builder-actions"

const SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"

export function SettingsButton() {
  const { itin, eventTypes, readOnly, mutate, setItin } = useBuilder()
  const [open, setOpen] = React.useState(false)
  const [f, setF] = React.useState(() => ({
    title: itin.title,
    subtitle: itin.subtitle ?? "",
    eventTypeId: itin.event_type_id,
    clientNameOverride: itin.client_name_override ?? "",
    defaultMeetingMinutes: itin.default_meeting_minutes,
    internalNotes: itin.internal_notes ?? "",
    clientNotes: itin.client_notes ?? "",
    confidential: itin.confidential,
    bufferCarMinutes: itin.buffer_car_minutes,
    bufferWalkMinutes: itin.buffer_walk_minutes,
    airportLeadMinutes: itin.airport_lead_minutes,
  }))
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function openDialog() {
    setF({
      title: itin.title,
      subtitle: itin.subtitle ?? "",
      eventTypeId: itin.event_type_id,
      clientNameOverride: itin.client_name_override ?? "",
      defaultMeetingMinutes: itin.default_meeting_minutes,
      internalNotes: itin.internal_notes ?? "",
      clientNotes: itin.client_notes ?? "",
      confidential: itin.confidential,
      bufferCarMinutes: itin.buffer_car_minutes,
      bufferWalkMinutes: itin.buffer_walk_minutes,
      airportLeadMinutes: itin.airport_lead_minutes,
    })
    setError(null)
    setOpen(true)
  }

  async function onSave() {
    setPending(true)
    const r = await mutate(null, () => updateItinerarySettings(itin.id, f), () =>
      setItin((s) => ({
        ...s,
        title: f.title.trim(),
        subtitle: f.subtitle.trim() || null,
        event_type_id: f.eventTypeId,
        client_name_override: f.clientNameOverride.trim() || null,
        client_name: f.clientNameOverride.trim() || s.client_name,
        default_meeting_minutes: Math.round(f.defaultMeetingMinutes),
        internal_notes: f.internalNotes.trim() || null,
        client_notes: f.clientNotes.trim() || null,
        confidential: f.confidential,
        buffer_car_minutes: Math.round(f.bufferCarMinutes),
        buffer_walk_minutes: Math.round(f.bufferWalkMinutes),
        airport_lead_minutes: Math.round(f.airportLeadMinutes),
      })),
    )
    setPending(false)
    if (!r.ok) return setError(r.error)
    toast.success("Settings saved")
    setOpen(false)
  }

  if (readOnly) return null
  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        <Settings2 className="size-4" /> Settings
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Itinerary settings</DialogTitle>
            <DialogDescription>Dates are changed by adding or removing days on the Schedule tab.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1">
            <div className="grid gap-1.5">
              <Label htmlFor="st-title">Title</Label>
              <Input id="st-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="st-sub">Subtitle</Label>
              <Input id="st-sub" value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="st-type">Event type</Label>
                <select
                  id="st-type"
                  value={f.eventTypeId ?? ""}
                  onChange={(e) => setF({ ...f, eventTypeId: e.target.value || null })}
                  className={SELECT_CLASS}
                >
                  <option value="">—</option>
                  {eventTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="st-min">Standard meeting length (min)</Label>
                <Input
                  id="st-min"
                  type="number"
                  min={5}
                  max={600}
                  step={5}
                  value={f.defaultMeetingMinutes}
                  onChange={(e) => setF({ ...f, defaultMeetingMinutes: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Default travel buffers (minutes)</Label>
              <div className="grid grid-cols-3 gap-3">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  After a car / taxi
                  <Input type="number" min={0} max={240} value={f.bufferCarMinutes} onChange={(e) => setF({ ...f, bufferCarMinutes: Number(e.target.value) })} />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  After a walk (lobby check-in)
                  <Input type="number" min={0} max={240} value={f.bufferWalkMinutes} onChange={(e) => setF({ ...f, bufferWalkMinutes: Number(e.target.value) })} />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  At the airport before a flight
                  <Input type="number" min={0} max={480} value={f.airportLeadMinutes} onChange={(e) => setF({ ...f, airportLeadMinutes: Number(e.target.value) })} />
                </label>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="st-client">Client name as printed (optional)</Label>
              <Input
                id="st-client"
                value={f.clientNameOverride}
                placeholder={itin.client_name ?? ""}
                onChange={(e) => setF({ ...f, clientNameOverride: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="st-cn">Client notes — printed in the PDF</Label>
              <Textarea id="st-cn" rows={2} value={f.clientNotes} onChange={(e) => setF({ ...f, clientNotes: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="st-in">Internal notes — never shown outside Rose</Label>
              <Textarea id="st-in" rows={2} value={f.internalNotes} onChange={(e) => setF({ ...f, internalNotes: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={f.confidential} onCheckedChange={(c) => setF({ ...f, confidential: c === true })} />
              Mark the PDF “Confidential”
            </label>
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

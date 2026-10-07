"use client"

/**
 * Add a day, or edit one (city, time zone, title, notes) / remove it. Changing
 * a day's time zone keeps its blocks at the same clock times (see updateDay).
 */

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
import { TIMEZONE_OPTIONS, formatDay } from "@/lib/events-planner/core"
import type { BuilderDay } from "@/lib/events-planner/types"
import { useBuilder } from "./builder-context"
import { addDay, deleteDay, updateDay } from "./builder-actions"

const SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"

/** City name → its usual zone, so typing "Chicago" picks Central. */
const CITY_ZONES: Record<string, string> = {
  "new york": "America/New_York", nyc: "America/New_York", boston: "America/New_York", philadelphia: "America/New_York",
  washington: "America/New_York", baltimore: "America/New_York", atlanta: "America/New_York", miami: "America/New_York",
  charlotte: "America/New_York", stamford: "America/New_York", greenwich: "America/New_York", toronto: "America/Toronto",
  montreal: "America/Toronto", chicago: "America/Chicago", minneapolis: "America/Chicago", dallas: "America/Chicago",
  houston: "America/Chicago", austin: "America/Chicago", "kansas city": "America/Chicago", milwaukee: "America/Chicago",
  denver: "America/Denver", "salt lake city": "America/Denver", phoenix: "America/Phoenix", "los angeles": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles", seattle: "America/Los_Angeles", portland: "America/Los_Angeles",
  "san diego": "America/Los_Angeles", london: "Europe/London", edinburgh: "Europe/London", paris: "Europe/Paris",
  frankfurt: "Europe/Paris", amsterdam: "Europe/Paris", milan: "Europe/Paris", madrid: "Europe/Paris",
  zurich: "Europe/Zurich", geneva: "Europe/Zurich", dubai: "Asia/Dubai", singapore: "Asia/Singapore",
  "hong kong": "Asia/Hong_Kong", tokyo: "Asia/Tokyo", sydney: "Australia/Sydney", melbourne: "Australia/Sydney",
}

export type DayDialogTarget = { kind: "add"; date: string; timezone: string } | { kind: "edit"; day: BuilderDay } | null

export function DayDialog({ target, onClose, onSelect }: { target: DayDialogTarget; onClose: () => void; onSelect: (dayId: string) => void }) {
  const { itin, mutate, upsertDay, upsertItems, upsertBlocks, removeDay } = useBuilder()
  const initial = target?.kind === "edit" ? target.day : null
  const [date, setDate] = React.useState(target?.kind === "add" ? target.date : initial?.date ?? "")
  const [city, setCity] = React.useState(initial?.city ?? "")
  const [tz, setTz] = React.useState(target?.kind === "add" ? target.timezone : initial?.timezone ?? "America/New_York")
  const [tzTouched, setTzTouched] = React.useState(false)
  const [title, setTitle] = React.useState(initial?.day_title ?? "")
  const [notes, setNotes] = React.useState(initial?.day_notes ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [confirmRemove, setConfirmRemove] = React.useState(false)

  const itemCount = initial ? itin.items.filter((i) => i.day_id === initial.id).length : 0

  function onCity(v: string) {
    setCity(v)
    const z = CITY_ZONES[v.trim().toLowerCase()]
    if (z && !tzTouched) setTz(z)
  }

  async function onSave() {
    setError(null)
    setPending(true)
    if (target?.kind === "add") {
      const r = await mutate(null, () => addDay(itin.id, { date, city, timezone: tz, dayTitle: title, dayNotes: notes }), (d) => {
        upsertDay(d.day)
        onSelect(d.day.id)
      })
      setPending(false)
      if (!r.ok) return setError(r.error)
    } else if (initial) {
      const r = await mutate(null, () => updateDay(initial.id, { city, timezone: tz, dayTitle: title, dayNotes: notes }), (d) => {
        upsertDay(d.day)
        if (d.items.length) upsertItems(d.items)
        if (d.blocks.length) upsertBlocks(d.blocks)
      })
      setPending(false)
      if (!r.ok) return setError(r.error)
      if (initial.timezone !== tz && r.data.items.length)
        toast.success(`Day moved to ${TIMEZONE_OPTIONS.find((z) => z.value === tz)?.label ?? tz}`, {
          description: `${r.data.items.length} ${r.data.items.length === 1 ? "block keeps its" : "blocks keep their"} clock time.`,
        })
    }
    onClose()
  }

  async function onRemove() {
    if (!initial) return
    setPending(true)
    const r = await mutate((s) => s, () => deleteDay(initial.id), () => removeDay(initial.id))
    setPending(false)
    if (r.ok) {
      toast.success("Day removed")
      onClose()
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{target?.kind === "add" ? "Add a day" : `Edit ${initial ? formatDay(initial.date) : "day"}`}</DialogTitle>
          <DialogDescription>
            Times on this day are entered in its city&apos;s time zone; Eastern is shown alongside.
          </DialogDescription>
        </DialogHeader>
        {confirmRemove ? (
          <div className="grid gap-3 text-sm">
            <div>
              Remove {initial ? formatDay(initial.date) : "this day"}
              {itemCount ? ` and its ${itemCount} ${itemCount === 1 ? "item" : "items"}` : ""}? This can&apos;t be undone.
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmRemove(false)} disabled={pending}>
                Keep it
              </Button>
              <Button variant="destructive" onClick={onRemove} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null} Remove day
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-3">
            {target?.kind === "add" && (
              <div className="grid gap-1.5">
                <Label htmlFor="dd-date">Date</Label>
                <Input id="dd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="dd-city">City</Label>
                <Input id="dd-city" value={city} onChange={(e) => onCity(e.target.value)} placeholder="e.g. Chicago" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dd-tz">Time zone</Label>
                <select
                  id="dd-tz"
                  value={tz}
                  onChange={(e) => {
                    setTz(e.target.value)
                    setTzTouched(true)
                  }}
                  className={SELECT_CLASS}
                >
                  {TIMEZONE_OPTIONS.map((z) => (
                    <option key={z.value} value={z.value}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {initial && initial.timezone !== tz && itemCount > 0 && (
              <div className="text-xs text-muted-foreground">
                The {itemCount} {itemCount === 1 ? "block" : "blocks"} on this day keep their clock times in the new zone.
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="dd-title">Day title</Label>
              <Input id="dd-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Boston" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dd-notes">Day notes</Label>
              <Textarea id="dd-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error && <div className="text-sm text-destructive">{error}</div>}
            <DialogFooter className="items-center">
              {initial && itin.days.length > 1 && (
                <Button variant="ghost" className="mr-auto text-destructive" onClick={() => setConfirmRemove(true)} disabled={pending}>
                  Remove day
                </Button>
              )}
              <Button variant="ghost" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={onSave} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null} {target?.kind === "add" ? "Add day" : "Save"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
